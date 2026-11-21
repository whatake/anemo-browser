import { writeFile } from 'node:fs/promises'
import { dialog, WebContentsView } from 'electron'
import type { BaseWindow, WebContents } from 'electron'
import type {
  BrowserState,
  ExportResult,
  MediaItem,
  NewTabInput,
  Rect,
  ShortcutAction,
  Tab,
  TabSnapshot,
} from '../../shared/types'
import { IPC } from '../../shared/ipc'
import { safeTitle, sanitizeTabUrl, toNavigationUrl } from '../../shared/url'
import type { ConfigStore } from '../config/ConfigStore'
import { htmlToMarkdown, markdownFileName } from '../export/markdown'
import type { PrivacyEngine } from '../network/PrivacyEngine'
import type { Database } from '../storage/Database'

export interface TabManagerDeps {
  window: BaseWindow
  chrome: WebContents
  db: Database
  privacy: PrivacyEngine
  config: ConfigStore
}

interface SerializedTabState {
  url: string
  title: string
  favicon: string | null
  scrollY: number
  savedAt: number
}

interface KeyInput {
  type: string
  key: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

interface AiPageContext {
  title: string
  url: string
  text: string
}

const SIDEBAR_WIDTH = 296
const TOP_BAR_HEIGHT = 96

function parseSerialized(raw: string | null): SerializedTabState | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SerializedTabState>
    if (typeof parsed.url !== 'string') return null
    return {
      url: parsed.url,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      favicon: typeof parsed.favicon === 'string' ? parsed.favicon : null,
      scrollY: typeof parsed.scrollY === 'number' && Number.isFinite(parsed.scrollY) ? parsed.scrollY : 0,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
    }
  } catch {
    return null
  }
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out')), milliseconds)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * Owns the tree of tabs and their live WebContentsViews.
 *
 * Only one view is visible at a time. Views are created on demand when a tab is
 * selected and destroyed when it is hibernated, while the tab's URL, title,
 * favicon, scroll position and tree position remain in SQLite. Each workspace
 * is bound to its own `persist:workspace_<id>` session.
 */
export class TabManager {
  private readonly window: BaseWindow
  private readonly chrome: WebContents
  private readonly db: Database
  private readonly privacy: PrivacyEngine
  private readonly config: ConfigStore

  private readonly live = new Map<string, WebContentsView>()
  private readonly activeByWorkspace = new Map<number, string>()
  private readonly stateListeners = new Set<(state: BrowserState) => void>()

  private activeWorkspaceId = 0
  private contentBounds: Rect
  private overlayVisible = false
  private chromeless = false
  private broadcastTimer: NodeJS.Timeout | null = null
  private autoHibernateTimer: NodeJS.Timeout | null = null
  private shuttingDown = false

  constructor(deps: TabManagerDeps) {
    this.window = deps.window
    this.chrome = deps.chrome
    this.db = deps.db
    this.privacy = deps.privacy
    this.config = deps.config

    const { width, height } = this.window.getContentBounds()
    this.contentBounds = {
      x: SIDEBAR_WIDTH,
      y: TOP_BAR_HEIGHT,
      width: Math.max(0, width - SIDEBAR_WIDTH),
      height: Math.max(0, height - TOP_BAR_HEIGHT),
    }

    this.window.on('resize', () => this.applyBoundsToViews())
    this.privacy.onMediaChanged((webContentsId) => {
      for (const view of this.live.values()) {
        if (view.webContents.id === webContentsId) {
          this.scheduleBroadcast()
          return
        }
      }
    })
  }

  async init(): Promise<void> {
    let workspaces = this.db.listWorkspaces()
    if (workspaces.length === 0) {
      this.db.createWorkspace({ name: 'Personal' })
      workspaces = this.db.listWorkspaces()
    }

    const savedWorkspaceId = Number(this.db.getMeta('active_workspace_id') ?? '')
    const preferred = workspaces.find((workspace) => workspace.id === savedWorkspaceId) ?? workspaces[0]
    if (!preferred) throw new Error('Anemo could not initialise a workspace')
    this.activeWorkspaceId = preferred.id

    // No page process survives a restart: every tab starts hibernated and the
    // active one is woken below.
    this.db.hibernateAllTabs()

    for (const workspace of workspaces) {
      const savedTabId = this.db.getMeta(`active_tab_${workspace.id}`)
      const tabs = this.db.listTabs(workspace.id)
      const candidate = tabs.find((tab) => tab.id === savedTabId) ?? tabs[0]
      if (candidate) this.activeByWorkspace.set(workspace.id, candidate.id)
    }

    let targetId = this.activeByWorkspace.get(this.activeWorkspaceId)
    if (!targetId) {
      const created = await this.createTab({
        workspaceId: this.activeWorkspaceId,
        url: 'about:blank',
        activate: false,
        focusPage: false,
      })
      targetId = created.id
    }

    this.db.setMeta('active_workspace_id', String(this.activeWorkspaceId))
    this.activateTab(targetId, false)

    this.autoHibernateTimer = setInterval(() => {
      void this.autoHibernate()
    }, 60_000)
  }

  onStateChanged(listener: (state: BrowserState) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  notifyChange(): void {
    this.scheduleBroadcast()
  }

  getState(): BrowserState {
    const activeTabId = this.activeByWorkspace.get(this.activeWorkspaceId) ?? null
    const tabs: TabSnapshot[] = this.db.listTabs().map((tab) => {
      const wc = this.live.get(tab.id)?.webContents
      const alive = Boolean(wc && !wc.isDestroyed())
      let canGoBack = false
      let canGoForward = false
      let isLoading = false
      let isAudible = false
      let mediaCount = 0
      if (wc && alive) {
        try {
          canGoBack = wc.navigationHistory.canGoBack()
          canGoForward = wc.navigationHistory.canGoForward()
          isLoading = wc.isLoading()
          isAudible = wc.isCurrentlyAudible()
          mediaCount = this.privacy.mediaCount(wc.id)
        } catch {
          // The page process can disappear between checks; treat it as gone.
        }
      }
      return {
        ...tab,
        isHibernated: !alive,
        isActive: tab.id === activeTabId,
        canGoBack,
        canGoForward,
        isLoading,
        isAudible,
        mediaCount,
      }
    })

    return {
      workspaces: this.db.listWorkspaces(),
      tabs,
      bookmarks: this.db.listBookmarks(),
      activeWorkspaceId: this.activeWorkspaceId,
      activeTabId,
      chromeless: this.chromeless,
    }
  }

  // ---------------------------------------------------------------------------
  // Tab lifecycle
  // ---------------------------------------------------------------------------

  async createTab(input: NewTabInput): Promise<Tab> {
    const requestedParent = input.parentId ? this.db.getTab(input.parentId) : null
    const workspaceId = requestedParent?.workspaceId ?? input.workspaceId ?? this.activeWorkspaceId
    const workspace = this.db.getWorkspace(workspaceId)
    if (!workspace) throw new Error('Cannot create a tab in an unknown workspace')

    const parentId =
      requestedParent && requestedParent.workspaceId === workspaceId ? requestedParent.id : null

    const requested = input.url?.trim() ?? ''
    const url = requested ? (sanitizeTabUrl(requested) ?? 'about:blank') : 'about:blank'
    const title = url === 'about:blank' ? 'New Tab' : safeTitle('', url)

    const tab = this.db.createTab({
      workspaceId,
      parentId,
      url,
      title,
      isHibernated: true,
    })

    if (input.activate !== false) {
      this.activateTab(tab.id, input.focusPage !== false)
    } else {
      this.scheduleBroadcast()
    }
    return tab
  }

  async closeTab(tabId: string): Promise<void> {
    const tab = this.db.getTab(tabId)
    if (!tab) return

    for (const id of this.db.descendantIds(tabId)) this.destroyView(id)
    this.db.deleteTab(tabId)

    if (this.activeByWorkspace.get(tab.workspaceId) === tabId) {
      const remaining = this.db.listTabs(tab.workspaceId)
      const fallback = this.fallbackFor(tab, remaining)
      if (fallback) {
        this.activeByWorkspace.set(tab.workspaceId, fallback.id)
        if (tab.workspaceId === this.activeWorkspaceId) this.activateTab(fallback.id)
      } else if (tab.workspaceId === this.activeWorkspaceId) {
        const created = await this.createTab({
          workspaceId: tab.workspaceId,
          url: 'about:blank',
          activate: true,
          focusPage: false,
        })
        this.activeByWorkspace.set(tab.workspaceId, created.id)
      } else {
        this.activeByWorkspace.delete(tab.workspaceId)
      }
    }

    if (tab.workspaceId === this.activeWorkspaceId) {
      this.db.setMeta(`active_tab_${tab.workspaceId}`, this.activeByWorkspace.get(tab.workspaceId) ?? '')
    }
    this.scheduleBroadcast()
  }

  activateTab(tabId: string, focusPage = true): void {
    const tab = this.db.getTab(tabId)
    if (!tab || !this.db.getWorkspace(tab.workspaceId)) return

    this.activeWorkspaceId = tab.workspaceId
    this.activeByWorkspace.set(tab.workspaceId, tabId)
    this.db.setMeta('active_workspace_id', String(tab.workspaceId))
    this.db.setMeta(`active_tab_${tab.workspaceId}`, tabId)
    this.db.updateTab(tabId, { lastActiveAt: Date.now() })

    for (const view of this.live.values()) view.setVisible(false)
    this.ensureView(tabId)

    const view = this.live.get(tabId)
    if (view && !this.overlayVisible) {
      view.setVisible(true)
      if (focusPage) view.webContents.focus()
    }

    this.scheduleBroadcast()
  }

  async switchWorkspace(workspaceId: number): Promise<void> {
    const workspace = this.db.getWorkspace(workspaceId)
    if (!workspace) return

    this.activeWorkspaceId = workspaceId
    this.db.setMeta('active_workspace_id', String(workspaceId))
    for (const view of this.live.values()) view.setVisible(false)

    const activeId = this.activeByWorkspace.get(workspaceId)
    let targetTab = (activeId ? this.db.getTab(activeId) : null) ?? this.db.listTabs(workspaceId)[0] ?? null
    if (!targetTab) {
      targetTab = await this.createTab({
        workspaceId,
        url: 'about:blank',
        activate: false,
        focusPage: false,
      })
    }

    this.activeByWorkspace.set(workspaceId, targetTab.id)
    this.activateTab(targetTab.id)
  }

  async navigate(tabId: string, input: string): Promise<void> {
    const tab = this.db.getTab(tabId)
    if (!tab) return

    const url = toNavigationUrl(input, this.config.get().searchEngine)
    if (!/^https?:\/\//i.test(url) && !/^about:blank$/i.test(url)) return

    this.db.updateTab(tabId, {
      url,
      title: url === 'about:blank' ? 'New Tab' : tab.title,
    })

    if (!this.live.has(tabId)) {
      this.ensureView(tabId, url)
      this.scheduleBroadcast()
      return
    }

    const view = this.live.get(tabId)
    if (!view) return
    const loading = view.webContents.loadURL(url).catch((error: unknown) => {
      console.warn('[tabs] navigation failed', url, error)
    })
    // Omnibox submission should hand the keyboard to the page, not leave it
    // trapped in the chrome UI.
    view.webContents.focus()
    await loading
    this.scheduleBroadcast()
  }

  goBack(tabId: string): void {
    const wc = this.liveWebContents(tabId)
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  goForward(tabId: string): void {
    const wc = this.liveWebContents(tabId)
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  }

  async reload(tabId: string, ignoreCache = false): Promise<void> {
    const view = this.live.get(tabId)
    if (!view) {
      this.ensureView(tabId)
      this.scheduleBroadcast()
      return
    }
    if (ignoreCache) view.webContents.reloadIgnoringCache()
    else view.webContents.reload()
  }

  async hibernateTab(tabId: string): Promise<void> {
    const tab = this.db.getTab(tabId)
    if (!tab) return

    const view = this.live.get(tabId)
    if (view) {
      if (view.webContents.isCurrentlyAudible()) return
      const serialized = await this.captureSerialized(tab, view.webContents)
      this.destroyView(tabId)
      this.db.setHibernated(tabId, JSON.stringify(serialized), {
        url: serialized.url,
        title: serialized.title,
        favicon: serialized.favicon,
      })
    } else {
      this.db.setHibernated(tabId, this.db.getSerializedState(tabId))
    }

    if (this.activeByWorkspace.get(tab.workspaceId) === tabId) {
      const remaining = this.db.listTabs(tab.workspaceId).filter((item) => item.id !== tabId)
      const fallback = this.fallbackFor(tab, remaining)
      if (fallback) {
        this.activeByWorkspace.set(tab.workspaceId, fallback.id)
        if (tab.workspaceId === this.activeWorkspaceId) this.activateTab(fallback.id)
      } else if (tab.workspaceId === this.activeWorkspaceId) {
        await this.createTab({
          workspaceId: tab.workspaceId,
          url: 'about:blank',
          activate: true,
          focusPage: false,
        })
      }
    }

    this.scheduleBroadcast()
  }

  async hibernateInactiveTabs(): Promise<number> {
    const activeIds = new Set(this.activeByWorkspace.values())
    let count = 0
    for (const tabId of [...this.live.keys()]) {
      if (activeIds.has(tabId)) continue
      const view = this.live.get(tabId)
      if (!view || view.webContents.isCurrentlyAudible()) continue
      await this.hibernateTab(tabId)
      count += 1
    }
    return count
  }

  private async autoHibernate(): Promise<void> {
    if (this.shuttingDown) return
    const minutes = this.config.get().autoHibernateMinutes
    if (minutes <= 0) return

    const cutoff = Date.now() - minutes * 60_000
    const activeIds = new Set(this.activeByWorkspace.values())
    for (const [tabId, view] of [...this.live]) {
      if (activeIds.has(tabId)) continue
      if (view.webContents.isCurrentlyAudible()) continue
      const tab = this.db.getTab(tabId)
      if (!tab || tab.lastActiveAt >= cutoff) continue
      await this.hibernateTab(tabId)
    }
  }

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  private ensureView(tabId: string, overrideUrl?: string): void {
    if (this.live.has(tabId)) return
    const tab = this.db.getTab(tabId)
    if (!tab) return
    const workspace = this.db.getWorkspace(tab.workspaceId)
    if (!workspace) return

    const serialized = parseSerialized(this.db.getSerializedState(tabId))
    const url = overrideUrl ?? serialized?.url ?? tab.url
    const workspaceSession = this.privacy.ensureSession(workspace.partition)

    const view = new WebContentsView({
      webPreferences: {
        session: workspaceSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        spellcheck: true,
        devTools: process.env.NODE_ENV !== 'production',
      },
    })
    view.setBackgroundColor('#0b0f14')
    view.setBounds(this.contentBounds)
    view.setVisible(false)
    this.window.contentView.addChildView(view)
    this.live.set(tabId, view)

    this.db.updateTab(tabId, { isHibernated: false, serializedState: null })
    this.wireView(tabId, view)

    const wc = view.webContents
    if (serialized && serialized.scrollY > 0) {
      wc.once('did-finish-load', () => {
        if (wc.isDestroyed()) return
        const y = Math.max(0, Math.round(serialized.scrollY))
        void wc.executeJavaScript(`window.scrollTo(0, ${y})`, true).catch(() => undefined)
      })
    }

    // Do not await: showing a newly selected tab must never wait for the network.
    void wc.loadURL(url).catch((error: unknown) => {
      console.warn('[tabs] could not load', url, error)
    })
  }

  private wireView(tabId: string, view: WebContentsView): void {
    const wc = view.webContents

    wc.setWindowOpenHandler(({ url, disposition }) => {
      const safe = sanitizeTabUrl(url)
      if (safe && safe !== 'about:blank') {
        void this.createTab({
          parentId: tabId,
          url: safe,
          activate: disposition !== 'background-tab',
        })
      }
      return { action: 'deny' }
    })

    wc.on('will-attach-webview', (event) => event.preventDefault())
    wc.on('will-navigate', (event, url) => {
      if (!/^https?:\/\//i.test(url) && !/^about:blank$/i.test(url)) event.preventDefault()
    })
    wc.on('did-start-loading', () => this.scheduleBroadcast())
    wc.on('did-stop-loading', () => {
      if (wc.isDestroyed()) return
      const url = wc.getURL()
      if (/^https?:\/\//i.test(url)) {
        const tab = this.db.getTab(tabId)
        if (tab) {
          const title = safeTitle(wc.getTitle(), url)
          this.db.updateTab(tabId, { title })
          this.db.recordVisit({ url, title, favicon: tab.favicon, workspaceId: tab.workspaceId })
        }
      }
      this.scheduleBroadcast()
    })
    wc.on('did-navigate', (_event, url) => this.handleNavigation(tabId, url, false))
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) this.handleNavigation(tabId, url, true)
    })
    wc.on('page-title-updated', (_event, title) => {
      if (wc.isDestroyed()) return
      const current = this.db.getTab(tabId)
      if (!current) return
      this.db.updateTab(tabId, { title: safeTitle(title, wc.getURL() || current.url) })
      this.scheduleBroadcast()
    })
    wc.on('page-favicon-updated', (_event, favicons) => {
      const favicon = favicons[0]
      if (!favicon) return
      this.db.updateTab(tabId, { favicon })
      this.scheduleBroadcast()
    })
    wc.on('before-input-event', (event, input) => {
      this.handleKey(event, input as KeyInput)
    })
    wc.on('media-started-playing', () => this.scheduleBroadcast())
    wc.on('media-paused', () => this.scheduleBroadcast())
    wc.on('render-process-gone', (_event, details) => {
      console.error('[tabs] renderer gone', tabId, details.reason)
      this.destroyView(tabId)
      this.db.setHibernated(tabId, this.db.getSerializedState(tabId))
      this.scheduleBroadcast()
    })
    wc.on('destroyed', () => {
      if (this.live.get(tabId)?.webContents === wc) this.live.delete(tabId)
      this.privacy.forgetWebContents(wc.id)
    })
  }

  private handleNavigation(tabId: string, url: string, recordVisit: boolean): void {
    const tab = this.db.getTab(tabId)
    const wc = this.liveWebContents(tabId)
    if (!tab || !wc) return

    const title = safeTitle(wc.getTitle(), url)
    this.db.updateTab(tabId, { url, title })
    if (recordVisit && /^https?:\/\//i.test(url)) {
      this.db.recordVisit({ url, title, favicon: tab.favicon, workspaceId: tab.workspaceId })
    }
    this.scheduleBroadcast()
  }

  private handleKey(event: { preventDefault: () => void }, input: KeyInput): void {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    const modifier = process.platform === 'darwin' ? input.meta : input.control

    let action: ShortcutAction | null = null

    if (modifier) {
      switch (key) {
        case 'k':
          action = 'palette'
          break
        case 'l':
          action = 'focus-omnibox'
          break
        case 't':
          action = 'new-tab'
          break
        case 'w':
          action = 'close-tab'
          break
        case 'r':
          action = 'reload'
          break
        case 'b':
          action = 'toggle-sidebar'
          break
        case 'j':
          action = 'toggle-ai'
          break
        case 'e':
          action = 'export-markdown'
          break
        case 'h':
          if (input.shift) action = 'hibernate-inactive'
          break
        case 'f':
          if (input.shift) action = 'toggle-chromeless'
          break
        default:
          break
      }
    }

    if (!action && input.alt) {
      if (key === 'arrowleft') action = 'back'
      else if (key === 'arrowright') action = 'forward'
    }

    if (!action) return
    event.preventDefault()
    this.chrome.focus()
    this.chrome.send(IPC.shortcut, action)
  }

  private destroyView(tabId: string): void {
    const view = this.live.get(tabId)
    if (!view) return
    this.live.delete(tabId)
    const webContentsId = view.webContents.id
    try {
      this.window.contentView.removeChildView(view)
    } catch {
      // Already detached by the window teardown.
    }
    try {
      if (!view.webContents.isDestroyed()) view.webContents.close()
    } catch {
      // Nothing to close.
    }
    this.privacy.forgetWebContents(webContentsId)
  }

  private liveWebContents(tabId: string): WebContents | null {
    const view = this.live.get(tabId)
    if (!view || view.webContents.isDestroyed()) return null
    return view.webContents
  }

  private fallbackFor(tab: Tab, remaining: Tab[]): Tab | null {
    const siblings = remaining.filter((item) => item.parentId === tab.parentId)
    const after =
      siblings.find((item) => item.position > tab.position) ?? siblings[siblings.length - 1]
    if (after) return after

    if (tab.parentId) {
      const parent = remaining.find((item) => item.id === tab.parentId)
      if (parent) return parent
    }
    return remaining[remaining.length - 1] ?? null
  }

  private async captureSerialized(tab: Tab, wc: WebContents): Promise<SerializedTabState> {
    let scrollY = 0
    try {
      const value = await withTimeout(wc.executeJavaScript('window.scrollY', true), 1200)
      if (typeof value === 'number' && Number.isFinite(value)) scrollY = Math.max(0, value)
    } catch {
      // Slow or unresponsive page: persist the tab without scroll restoration.
    }

    const url = wc.getURL() || tab.url
    const latest = this.db.getTab(tab.id)
    return {
      url,
      title: safeTitle(wc.getTitle(), url),
      favicon: latest?.favicon ?? tab.favicon,
      scrollY,
      savedAt: Date.now(),
    }
  }

  // ---------------------------------------------------------------------------
  // Layout / renderer integration
  // ---------------------------------------------------------------------------

  setContentBounds(bounds: Rect): void {
    const clean = (value: number) => (Number.isFinite(value) ? Math.round(value) : 0)
    this.contentBounds = {
      x: Math.max(0, clean(bounds.x)),
      y: Math.max(0, clean(bounds.y)),
      width: Math.max(0, clean(bounds.width)),
      height: Math.max(0, clean(bounds.height)),
    }
    this.applyBoundsToViews()
  }

  private applyBoundsToViews(): void {
    for (const view of this.live.values()) view.setBounds(this.contentBounds)
  }

  setOverlay(visible: boolean): void {
    this.overlayVisible = visible
    const activeTabId = this.activeByWorkspace.get(this.activeWorkspaceId)
    for (const [tabId, view] of this.live) {
      view.setVisible(!visible && tabId === activeTabId)
    }

    // The chrome UI owns focus while a palette/drawer is open. When it closes,
    // focus stays in the shell so the omnibox remains keyboard-addressable;
    // clicking the page or selecting a tab gives focus back to the page.
    if (visible) this.chrome.focus()
  }

  setChromeless(enabled: boolean): void {
    this.chromeless = enabled
    this.scheduleBroadcast()
  }

  getMediaItems(tabId: string): MediaItem[] {
    const wc = this.liveWebContents(tabId)
    return wc ? this.privacy.mediaFor(wc.id) : []
  }

  async readActivePageText(): Promise<AiPageContext | null> {
    const tabId = this.activeByWorkspace.get(this.activeWorkspaceId)
    const wc = tabId ? this.liveWebContents(tabId) : null
    if (!wc) return null

    try {
      const result = (await wc.executeJavaScript(
        `(() => {
          const preferred = ['article', 'main', '[role="main"]'];
          let root = document.body;
          for (const selector of preferred) {
            const element = document.querySelector(selector);
            if (element && element.innerText && element.innerText.length > 400) { root = element; break; }
          }
          const text = (root && root.innerText ? root.innerText : '')
            .replace(/\\n{3,}/g, '\\n\\n')
            .trim()
            .slice(0, 16000);
          return { title: document.title, url: location.href, text };
        })()`,
        true,
      )) as unknown

      if (
        typeof result === 'object' &&
        result !== null &&
        typeof (result as AiPageContext).text === 'string'
      ) {
        const page = result as AiPageContext
        return { title: page.title, url: page.url, text: page.text }
      }
      return null
    } catch (error) {
      console.warn('[tabs] could not read page text', error)
      return null
    }
  }

  async exportActivePageAsMarkdown(): Promise<ExportResult> {
    const tabId = this.activeByWorkspace.get(this.activeWorkspaceId)
    const wc = tabId ? this.liveWebContents(tabId) : null
    if (!wc) return { saved: false }

    try {
      const page = (await wc.executeJavaScript(
        `({ title: document.title, html: document.documentElement.outerHTML })`,
        true,
      )) as { title?: string; html?: string }

      const title = (page.title || safeTitle(wc.getTitle(), wc.getURL())).trim()
      const markdown = `# ${title}\n\n> Source: ${wc.getURL()}\n\n${htmlToMarkdown(page.html ?? '')}\n`
      const result = await dialog.showSaveDialog(this.window, {
        title: 'Export page as Markdown',
        defaultPath: markdownFileName(title),
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      })
      if (result.canceled || !result.filePath) return { saved: false }

      await writeFile(result.filePath, markdown, 'utf8')
      return { saved: true, path: result.filePath }
    } catch (error) {
      console.error('[tabs] markdown export failed', error)
      return { saved: false }
    }
  }

  private scheduleBroadcast(): void {
    if (this.broadcastTimer) return
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null
      const state = this.getState()
      for (const listener of this.stateListeners) listener(state)
    }, 24)
  }

  dispose(): void {
    this.shuttingDown = true
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer)
    if (this.autoHibernateTimer) clearInterval(this.autoHibernateTimer)
    this.broadcastTimer = null
    this.autoHibernateTimer = null
    this.stateListeners.clear()
  }
}
