import { randomUUID } from 'node:crypto'
import { clipboard, ipcMain } from 'electron'
import type { AiAskInput, AppConfig, DeepPartial, NewTabInput, Rect, SaveBookmarkInput } from '../shared/types'
import { IPC } from '../shared/ipc'
import { isAllowedWebUrl } from '../shared/url'
import type { ChatMessage, LocalBridge } from './ai/LocalBridge'
import type { ConfigStore } from './config/ConfigStore'
import type { PrivacyEngine } from './network/PrivacyEngine'
import type { Database } from './storage/Database'
import type { TabManager } from './tabs/TabManager'

export interface IpcContext {
  db: Database
  config: ConfigStore
  tabs: TabManager
  privacy: PrivacyEngine
  ai: LocalBridge
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function tabIdOf(value: unknown): string {
  return requireString(value, 'tabId')
}

/**
 * All renderer→main calls funnel through this module. The preload bridge only
 * exposes the methods below; every payload is re-validated here.
 */
export function registerIpc(context: IpcContext): void {
  const { db, config, tabs, ai } = context

  ipcMain.handle(IPC.stateGet, () => tabs.getState())
  ipcMain.handle(IPC.configGet, () => config.get())
  ipcMain.handle(IPC.configUpdate, (_event, patch: unknown) => {
    if (!isRecord(patch)) throw new Error('Config patch must be an object')
    const updated = config.update(patch as DeepPartial<AppConfig>)
    tabs.notifyChange()
    return updated
  })

  ipcMain.handle(IPC.tabCreate, async (_event, raw: unknown) => {
    const input: NewTabInput = isRecord(raw)
      ? {
          workspaceId: typeof raw.workspaceId === 'number' ? raw.workspaceId : undefined,
          parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
          url: optionalString(raw.url),
          activate: typeof raw.activate === 'boolean' ? raw.activate : true,
          focusPage: typeof raw.focusPage === 'boolean' ? raw.focusPage : true,
        }
      : {}
    return tabs.createTab(input)
  })

  ipcMain.handle(IPC.tabClose, (_event, tabId: unknown) => tabs.closeTab(tabIdOf(tabId)))
  ipcMain.handle(IPC.tabActivate, (_event, tabId: unknown) => {
    tabs.activateTab(tabIdOf(tabId))
  })
  ipcMain.handle(IPC.tabNavigate, (_event, tabId: unknown, input: unknown) => {
    return tabs.navigate(tabIdOf(tabId), requireString(input, 'url'))
  })
  ipcMain.handle(IPC.tabBack, (_event, tabId: unknown) => tabs.goBack(tabIdOf(tabId)))
  ipcMain.handle(IPC.tabForward, (_event, tabId: unknown) => tabs.goForward(tabIdOf(tabId)))
  ipcMain.handle(IPC.tabReload, (_event, tabId: unknown, ignoreCache: unknown) =>
    tabs.reload(tabIdOf(tabId), ignoreCache === true),
  )
  ipcMain.handle(IPC.tabHibernate, (_event, tabId: unknown) => tabs.hibernateTab(tabIdOf(tabId)))
  ipcMain.handle(IPC.tabsHibernateInactive, () => tabs.hibernateInactiveTabs())

  ipcMain.handle(IPC.workspaceCreate, (_event, raw: unknown) => {
    if (!isRecord(raw)) return db.createWorkspace()
    return db.createWorkspace({
      name: optionalString(raw.name),
      color: optionalString(raw.color),
    })
  })
  ipcMain.handle(IPC.workspaceSwitch, (_event, workspaceId: unknown) => {
    if (typeof workspaceId !== 'number') throw new Error('workspaceId must be a number')
    return tabs.switchWorkspace(workspaceId)
  })

  ipcMain.handle(IPC.mediaList, (_event, tabId: unknown) => tabs.getMediaItems(tabIdOf(tabId)))

  ipcMain.handle(IPC.bookmarkToggle, (_event, raw: unknown) => {
    if (!isRecord(raw)) throw new Error('Bookmark payload must be an object')
    const url = requireString(raw.url, 'url')
    const input: SaveBookmarkInput = {
      url,
      title: typeof raw.title === 'string' ? raw.title.slice(0, 512) : url,
      favicon: typeof raw.favicon === 'string' ? raw.favicon : null,
    }
    if (!isAllowedWebUrl(input.url)) throw new Error('Only http(s) pages can be bookmarked')

    const existing = db.findBookmarkByUrl(input.url)
    if (existing) {
      db.removeBookmark(existing.id)
      tabs.notifyChange()
      return false
    }
    db.addBookmark({ url: input.url, title: input.title, favicon: input.favicon })
    tabs.notifyChange()
    return true
  })

  ipcMain.handle(IPC.bookmarkRemove, (_event, bookmarkId: unknown) => {
    db.removeBookmark(requireString(bookmarkId, 'bookmarkId'))
    tabs.notifyChange()
  })

  ipcMain.handle(IPC.clipboardWrite, (_event, text: unknown) => {
    clipboard.writeText(String(text ?? '').slice(0, 200_000))
  })

  ipcMain.handle(IPC.exportMarkdown, () => tabs.exportActivePageAsMarkdown())

  ipcMain.on(IPC.viewSetBounds, (_event, raw: unknown) => {
    if (!isRecord(raw)) return
    const bounds: Rect = {
      x: typeof raw.x === 'number' ? raw.x : 0,
      y: typeof raw.y === 'number' ? raw.y : 0,
      width: typeof raw.width === 'number' ? raw.width : 0,
      height: typeof raw.height === 'number' ? raw.height : 0,
    }
    tabs.setContentBounds(bounds)
  })
  ipcMain.on(IPC.viewSetOverlay, (_event, visible: unknown) => {
    tabs.setOverlay(visible === true)
  })
  ipcMain.on(IPC.viewSetChromeless, (_event, enabled: unknown) => {
    tabs.setChromeless(enabled === true)
  })

  const controllers = new Map<string, AbortController>()

  ipcMain.handle(IPC.aiAsk, (event, raw: unknown) => {
    if (!isRecord(raw)) throw new Error('AI payload must be an object')
    const prompt = requireString(raw.prompt, 'prompt').slice(0, 8000)
    const includePage = raw.includePage === true
    const requestId = randomUUID()
    const controller = new AbortController()
    controllers.set(requestId, controller)
    const sender = event.sender

    const send = (payload: unknown) => {
      if (!sender.isDestroyed()) sender.send(IPC.aiEvent, payload)
    }

    void (async () => {
      try {
        const settings = config.get().ai
        if (!settings.enabled) {
          throw new Error('Local AI is disabled. Set ai.enabled to true in ~/.anemo/config.json.')
        }

        const page = includePage ? await tabs.readActivePageText() : null
        const messages: ChatMessage[] = [
          {
            role: 'system',
            content:
              'You are Anemo, a concise assistant built into a privacy-first browser. ' +
              'Answer using only the supplied page content and the conversation. Say when the page does not contain the answer.',
          },
        ]
        if (page) {
          messages.push({
            role: 'user',
            content: `Page: ${page.title}\nURL: ${page.url}\n\n${page.text}`,
          })
        }
        messages.push({ role: 'user', content: prompt })

        let full = ''
        for await (const token of ai.streamChat(messages, controller.signal)) {
          full += token
          send({ requestId, type: 'token', text: token })
        }
        send({ requestId, type: 'done' })

        void ai.dispatchWebhook('ai.response', {
          model: settings.model,
          prompt,
          response: full.slice(0, 4000),
          pageUrl: page?.url ?? null,
        })
      } catch (error) {
        if (controller.signal.aborted) {
          send({ requestId, type: 'done' })
        } else {
          const message = error instanceof Error ? error.message : String(error)
          send({ requestId, type: 'error', message })
        }
      } finally {
        controllers.delete(requestId)
      }
    })()

    return requestId
  })

  ipcMain.on(IPC.aiCancel, (_event, requestId: unknown) => {
    if (typeof requestId !== 'string') return
    controllers.get(requestId)?.abort()
  })
}
