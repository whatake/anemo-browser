import { useEffect, useRef, useState } from 'react'
import type {
  AppConfig,
  Bookmark,
  BrowserState,
  ShortcutAction,
  TabSnapshot,
} from '../shared/types'
import { isAllowedWebUrl } from '../shared/url'
import { AiPanel } from './components/AiPanel'
import { CommandPalette } from './components/CommandPalette'
import { MediaPanel } from './components/MediaPanel'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import type { PaletteAction } from './lib/palette'

const WORKSPACE_COLORS = ['#7dd3fc', '#6ee7b7', '#c4b5fd', '#fcd34d', '#fda4af', '#93c5fd']
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
const mod = isMac ? '⌘' : 'Ctrl'

export default function App() {
  const [state, setState] = useState<BrowserState | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('anemo:sidebar') === 'collapsed',
  )
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [mediaOpen, setMediaOpen] = useState(false)
  const [focusSignal, setFocusSignal] = useState(0)
  const [toast, setToast] = useState<string | null>(null)

  const stateRef = useRef<BrowserState | null>(null)
  stateRef.current = state
  const contentRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<number | null>(null)

  useEffect(() => {
    localStorage.setItem('anemo:sidebar', sidebarCollapsed ? 'collapsed' : 'expanded')
  }, [sidebarCollapsed])

  useEffect(() => {
    let disposed = false
    void window.anemo.getState().then((next) => {
      if (!disposed) setState(next)
    })
    void window.anemo.getConfig().then((next) => {
      if (!disposed) setConfig(next)
    })

    const offState = window.anemo.onStateChanged(setState)
    const offConfig = window.anemo.onConfigChanged(setConfig)
    return () => {
      disposed = true
      offState()
      offConfig()
    }
  }, [])

  const notify = (message: string) => {
    setToast(message)
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3200)
  }

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    }
  }, [])

  // The chrome UI measures the space its page view should occupy. The main
  // process positions the WebContentsView from this rectangle.
  useEffect(() => {
    const element = contentRef.current
    if (!element) return

    const send = () => {
      const rect = element.getBoundingClientRect()
      window.anemo.setContentBounds({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      })
    }

    send()
    const frame = window.requestAnimationFrame(send)
    const observer = new ResizeObserver(send)
    observer.observe(element)
    window.addEventListener('resize', send)

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', send)
    }
  }, [state === null])

  useEffect(() => {
    window.anemo.setOverlay(paletteOpen || aiOpen || mediaOpen)
  }, [paletteOpen, aiOpen, mediaOpen])

  const closeOverlays = () => {
    setPaletteOpen(false)
    setAiOpen(false)
    setMediaOpen(false)
  }

  const leaveChromeless = () => {
    if (stateRef.current?.chromeless) void window.anemo.setChromeless(false)
  }

  const focusOmnibox = () => {
    closeOverlays()
    leaveChromeless()
    setFocusSignal((value) => value + 1)
  }

  const openPalette = () => {
    leaveChromeless()
    setAiOpen(false)
    setMediaOpen(false)
    setPaletteOpen(true)
  }

  const openAi = () => {
    leaveChromeless()
    setPaletteOpen(false)
    setMediaOpen(false)
    setAiOpen(true)
  }

  const toggleAi = () => {
    if (aiOpen) {
      setAiOpen(false)
      return
    }
    openAi()
  }

  const openMedia = () => {
    if (!stateRef.current?.activeTabId) return
    leaveChromeless()
    setPaletteOpen(false)
    setAiOpen(false)
    setMediaOpen(true)
  }

  const createTab = (parentId: string | null = null) => {
    closeOverlays()
    leaveChromeless()
    void window.anemo
      .createTab({ url: 'about:blank', parentId, activate: true, focusPage: false })
      .then(() => setFocusSignal((value) => value + 1))
      .catch((cause: unknown) =>
        notify(cause instanceof Error ? cause.message : 'Could not open a tab'),
      )
  }

  const selectTab = (tabId: string) => {
    closeOverlays()
    leaveChromeless()
    void window.anemo.activateTab(tabId)
  }

  const closeTab = (tabId: string) => {
    void window.anemo.closeTab(tabId).catch((cause: unknown) =>
      notify(cause instanceof Error ? cause.message : 'Could not close the tab'),
    )
  }

  const switchWorkspace = (workspaceId: number) => {
    closeOverlays()
    void window.anemo.switchWorkspace(workspaceId)
  }

  const createWorkspace = () => {
    const nextNumber = (stateRef.current?.workspaces.length ?? 0) + 1
    const color = WORKSPACE_COLORS[(nextNumber - 1) % WORKSPACE_COLORS.length] ?? '#7dd3fc'
    void window.anemo
      .createWorkspace({ name: `Space ${nextNumber}`, color })
      .then((workspace) => window.anemo.switchWorkspace(workspace.id))
      .then(() => notify(`Workspace “Space ${nextNumber}” ready`))
      .catch((cause: unknown) =>
        notify(cause instanceof Error ? cause.message : 'Could not create a workspace'),
      )
  }

  const navigate = (value: string) => {
    const tabId = stateRef.current?.activeTabId
    if (!tabId) return
    void window.anemo
      .navigate(tabId, value)
      .catch((cause: unknown) =>
        notify(cause instanceof Error ? cause.message : 'Navigation failed'),
      )
  }

  const backup = () => {
    const tabId = stateRef.current?.activeTabId
    if (tabId) void window.anemo.goBack(tabId)
  }

  const forward = () => {
    const tabId = stateRef.current?.activeTabId
    if (tabId) void window.anemo.goForward(tabId)
  }

  const reload = () => {
    const tabId = stateRef.current?.activeTabId
    if (tabId) void window.anemo.reload(tabId)
  }

  const toggleBookmark = () => {
    const current = stateRef.current
    const tab = current?.tabs.find((item) => item.id === current.activeTabId)
    if (!tab) return
    if (!isAllowedWebUrl(tab.url)) {
      notify('Only http(s) pages can be bookmarked')
      return
    }
    void window.anemo
      .toggleBookmark({ url: tab.url, title: tab.title, favicon: tab.favicon })
      .then((added) => notify(added ? 'Bookmark added' : 'Bookmark removed'))
      .catch((cause: unknown) =>
        notify(cause instanceof Error ? cause.message : 'Bookmark failed'),
      )
  }

  const openBookmark = (bookmark: Bookmark) => {
    closeOverlays()
    const parentId = stateRef.current?.activeTabId ?? null
    void window.anemo.createTab({
      url: bookmark.url,
      parentId,
      activate: true,
      focusPage: true,
    })
  }

  const hibernateInactive = async () => {
    try {
      const count = await window.anemo.hibernateInactiveTabs()
      notify(
        count === 0
          ? 'No inactive live tabs to hibernate'
          : `${count} tab${count === 1 ? '' : 's'} hibernated`,
      )
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Hibernation failed')
    }
  }

  const exportMarkdown = async () => {
    const result = await window.anemo.exportPageMarkdown()
    notify(result.saved ? 'Page exported as Markdown' : 'Export cancelled')
  }

  const toggleChromeless = () => {
    closeOverlays()
    void window.anemo.setChromeless(!(stateRef.current?.chromeless ?? false))
  }

  const runAction = (action: ShortcutAction) => {
    switch (action) {
      case 'palette':
        openPalette()
        break
      case 'focus-omnibox':
        focusOmnibox()
        break
      case 'new-tab':
        createTab(null)
        break
      case 'close-tab': {
        const tabId = stateRef.current?.activeTabId
        if (tabId) closeTab(tabId)
        break
      }
      case 'reload':
        reload()
        break
      case 'back':
        backup()
        break
      case 'forward':
        forward()
        break
      case 'toggle-sidebar':
        setSidebarCollapsed((value) => !value)
        break
      case 'toggle-ai':
        toggleAi()
        break
      case 'hibernate-inactive':
        void hibernateInactive()
        break
      case 'export-markdown':
        void exportMarkdown()
        break
      case 'toggle-chromeless':
        toggleChromeless()
        break
      default:
        break
    }
  }

  const handlersRef = useRef({ runAction, closeOverlays })
  handlersRef.current = { runAction, closeOverlays }

  useEffect(() => {
    return window.anemo.onShortcut((action) => handlersRef.current.runAction(action))
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (modifier && key === 'k') {
        event.preventDefault()
        handlersRef.current.runAction('palette')
      } else if (modifier && key === 'l') {
        event.preventDefault()
        handlersRef.current.runAction('focus-omnibox')
      } else if (modifier && key === 't') {
        event.preventDefault()
        handlersRef.current.runAction('new-tab')
      } else if (modifier && key === 'w') {
        event.preventDefault()
        handlersRef.current.runAction('close-tab')
      } else if (modifier && key === 'b') {
        event.preventDefault()
        handlersRef.current.runAction('toggle-sidebar')
      } else if (modifier && key === 'j') {
        event.preventDefault()
        handlersRef.current.runAction('toggle-ai')
      } else if (modifier && event.shiftKey && key === 'f') {
        event.preventDefault()
        handlersRef.current.runAction('toggle-chromeless')
      } else if (event.key === 'Escape') {
        handlersRef.current.closeOverlays()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const activeTab: TabSnapshot | null =
    state?.tabs.find((tab) => tab.id === state.activeTabId) ?? null

  const bookmarked = Boolean(
    activeTab && state?.bookmarks.some((bookmark) => bookmark.url === activeTab.url),
  )

  const actions: PaletteAction[] = [
    {
      id: 'new-tab',
      label: 'New Tab',
      keywords: 'create open blank',
      hint: `${mod}+T`,
      run: () => createTab(null),
    },
    {
      id: 'new-child-tab',
      label: 'New Child Tab',
      keywords: 'nested branch tree under current',
      run: () => createTab(stateRef.current?.activeTabId ?? null),
    },
    {
      id: 'close-tab',
      label: 'Close Current Tab',
      keywords: 'dismiss remove',
      hint: `${mod}+W`,
      run: () => {
        const tabId = stateRef.current?.activeTabId
        if (tabId) closeTab(tabId)
      },
    },
    {
      id: 'hibernate-inactive',
      label: 'Hibernate Inactive Tabs',
      keywords: 'sleep memory suspend unload',
      hint: `${mod}+Shift+H`,
      run: () => void hibernateInactive(),
    },
    {
      id: 'toggle-chromeless',
      label: 'Toggle Chromeless Mode',
      keywords: 'fullscreen immersive hide chrome zen',
      hint: `${mod}+Shift+F`,
      run: () => toggleChromeless(),
    },
    {
      id: 'export-markdown',
      label: 'Export Page as Markdown',
      keywords: 'save download convert md',
      hint: `${mod}+E`,
      run: () => void exportMarkdown(),
    },
    {
      id: 'bookmark-page',
      label: bookmarked ? 'Remove Current Bookmark' : 'Bookmark Current Page',
      keywords: 'star save favourite favorite',
      run: () => toggleBookmark(),
    },
    {
      id: 'copy-url',
      label: 'Copy Current URL',
      keywords: 'clipboard link address',
      run: () => {
        const tab = activeTab
        if (!tab) return
        void window.anemo.copyText(tab.url)
        notify('URL copied')
      },
    },
    {
      id: 'reload',
      label: 'Reload Current Page',
      keywords: 'refresh',
      hint: `${mod}+R`,
      run: () => reload(),
    },
    {
      id: 'toggle-ai',
      label: 'Toggle Local AI Assistant',
      keywords: 'ask summarize chat ollama',
      hint: `${mod}+J`,
      run: () => toggleAi(),
    },
    {
      id: 'toggle-sidebar',
      label: 'Toggle Tab Sidebar',
      keywords: 'collapse expand tree',
      hint: `${mod}+B`,
      run: () => setSidebarCollapsed((value) => !value),
    },
    {
      id: 'new-workspace',
      label: 'New Isolated Workspace',
      keywords: 'space session partition profile',
      run: () => createWorkspace(),
    },
    {
      id: 'open-media',
      label: 'Show Sniffed Media Streams',
      keywords: 'hls dash video audio streams',
      run: () => openMedia(),
    },
  ]

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center bg-[#070a0d]">
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <span className="h-3 w-3 animate-spin rounded-full border border-sky-300/30 border-t-sky-300" />
          Starting Anemo
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-[#070a0d] text-slate-200">
      <div className="flex min-h-0 flex-1">
        {!state.chromeless && (
          <Sidebar
            state={state}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
            onSelectTab={selectTab}
            onCloseTab={closeTab}
            onCreateTab={(parentId) => createTab(parentId)}
            onCreateWorkspace={createWorkspace}
            onSwitchWorkspace={switchWorkspace}
            onOpenPalette={openPalette}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {!state.chromeless && (
            <TopBar
              state={state}
              activeTab={activeTab}
              focusSignal={focusSignal}
              aiOpen={aiOpen}
              onNavigate={navigate}
              onBack={backup}
              onForward={forward}
              onReload={reload}
              onToggleBookmark={toggleBookmark}
              onOpenMedia={openMedia}
              onToggleAi={toggleAi}
              onToggleChromeless={toggleChromeless}
              onOpenPalette={openPalette}
            />
          )}

          <div ref={contentRef} className="relative min-h-0 flex-1 bg-[#0b0f14]" />
        </div>
      </div>

      {paletteOpen && (
        <CommandPalette
          state={state}
          actions={actions}
          onClose={() => setPaletteOpen(false)}
          onSelectTab={selectTab}
          onOpenBookmark={openBookmark}
          onSwitchWorkspace={switchWorkspace}
        />
      )}

      {aiOpen && (
        <AiPanel config={config} activeTab={activeTab} onClose={() => setAiOpen(false)} />
      )}

      {mediaOpen && activeTab && (
        <MediaPanel
          tabId={activeTab.id}
          onClose={() => setMediaOpen(false)}
          onOpen={(url) => {
            setMediaOpen(false)
            void window.anemo.createTab({
              url,
              parentId: activeTab.id,
              activate: true,
              focusPage: true,
            })
          }}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-white/10 bg-[#0d131b] px-4 py-2 text-[11px] text-slate-300 shadow-xl shadow-black/40">
          {toast}
        </div>
      )}

    </div>
  )
}
