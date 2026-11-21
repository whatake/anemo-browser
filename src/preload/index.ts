import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type AnemoApi } from '../shared/ipc'
import type {
  AiAskInput,
  AiStreamEvent,
  AppConfig,
  BrowserState,
  CreateWorkspaceInput,
  DeepPartial,
  NewTabInput,
  Rect,
  SaveBookmarkInput,
  ShortcutAction,
} from '../shared/types'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

const api: AnemoApi = {
  getState: () => ipcRenderer.invoke(IPC.stateGet) as Promise<BrowserState>,
  getConfig: () => ipcRenderer.invoke(IPC.configGet) as Promise<AppConfig>,
  updateConfig: (patch: DeepPartial<AppConfig>) =>
    ipcRenderer.invoke(IPC.configUpdate, patch) as Promise<AppConfig>,

  createTab: (input: NewTabInput) => ipcRenderer.invoke(IPC.tabCreate, input),
  closeTab: (tabId: string) => ipcRenderer.invoke(IPC.tabClose, tabId),
  activateTab: (tabId: string) => ipcRenderer.invoke(IPC.tabActivate, tabId),
  navigate: (tabId: string, input: string) => ipcRenderer.invoke(IPC.tabNavigate, tabId, input),
  goBack: (tabId: string) => ipcRenderer.invoke(IPC.tabBack, tabId),
  goForward: (tabId: string) => ipcRenderer.invoke(IPC.tabForward, tabId),
  reload: (tabId: string, ignoreCache = false) =>
    ipcRenderer.invoke(IPC.tabReload, tabId, ignoreCache),
  hibernateTab: (tabId: string) => ipcRenderer.invoke(IPC.tabHibernate, tabId),
  hibernateInactiveTabs: () => ipcRenderer.invoke(IPC.tabsHibernateInactive),

  createWorkspace: (input: CreateWorkspaceInput) => ipcRenderer.invoke(IPC.workspaceCreate, input),
  switchWorkspace: (workspaceId: number) => ipcRenderer.invoke(IPC.workspaceSwitch, workspaceId),

  getMediaItems: (tabId: string) => ipcRenderer.invoke(IPC.mediaList, tabId),
  toggleBookmark: (input: SaveBookmarkInput) => ipcRenderer.invoke(IPC.bookmarkToggle, input),
  removeBookmark: (id: string) => ipcRenderer.invoke(IPC.bookmarkRemove, id),
  copyText: (text: string) => ipcRenderer.invoke(IPC.clipboardWrite, text),
  exportPageMarkdown: () => ipcRenderer.invoke(IPC.exportMarkdown),

  setContentBounds: (bounds: Rect) => ipcRenderer.send(IPC.viewSetBounds, bounds),
  setOverlay: (visible: boolean) => ipcRenderer.send(IPC.viewSetOverlay, visible),
  setChromeless: (enabled: boolean) => ipcRenderer.send(IPC.viewSetChromeless, enabled),

  askAi: (input: AiAskInput) => ipcRenderer.invoke(IPC.aiAsk, input) as Promise<string>,
  cancelAi: (requestId: string) => ipcRenderer.send(IPC.aiCancel, requestId),

  onStateChanged: (listener) => subscribe<BrowserState>(IPC.stateChanged, listener),
  onConfigChanged: (listener) => subscribe<AppConfig>(IPC.configChanged, listener),
  onShortcut: (listener) => subscribe<ShortcutAction>(IPC.shortcut, listener),
  onAiEvent: (listener) => subscribe<AiStreamEvent>(IPC.aiEvent, listener),
}

contextBridge.exposeInMainWorld('anemo', api)
