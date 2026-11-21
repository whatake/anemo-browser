import type {
  AiAskInput,
  AiStreamEvent,
  AppConfig,
  BrowserState,
  CreateWorkspaceInput,
  DeepPartial,
  ExportResult,
  MediaItem,
  NewTabInput,
  Rect,
  SaveBookmarkInput,
  ShortcutAction,
  Tab,
  Workspace,
} from './types'

export const IPC = {
  stateGet: 'anemo:state:get',
  stateChanged: 'anemo:state:changed',
  configGet: 'anemo:config:get',
  configUpdate: 'anemo:config:update',
  configChanged: 'anemo:config:changed',
  tabCreate: 'anemo:tab:create',
  tabClose: 'anemo:tab:close',
  tabActivate: 'anemo:tab:activate',
  tabNavigate: 'anemo:tab:navigate',
  tabBack: 'anemo:tab:back',
  tabForward: 'anemo:tab:forward',
  tabReload: 'anemo:tab:reload',
  tabHibernate: 'anemo:tab:hibernate',
  tabsHibernateInactive: 'anemo:tabs:hibernate-inactive',
  workspaceCreate: 'anemo:workspace:create',
  workspaceSwitch: 'anemo:workspace:switch',
  mediaList: 'anemo:media:list',
  bookmarkToggle: 'anemo:bookmark:toggle',
  bookmarkRemove: 'anemo:bookmark:remove',
  viewSetBounds: 'anemo:view:bounds',
  viewSetOverlay: 'anemo:view:overlay',
  viewSetChromeless: 'anemo:view:chromeless',
  exportMarkdown: 'anemo:export:markdown',
  clipboardWrite: 'anemo:clipboard:write',
  aiAsk: 'anemo:ai:ask',
  aiCancel: 'anemo:ai:cancel',
  aiEvent: 'anemo:ai:event',
  shortcut: 'anemo:shortcut',
} as const

/**
 * The only surface exposed to the React renderer through the preload bridge.
 * Every method is validated again in the main process; the renderer is treated
 * as untrusted because it executes markup that ships with the app.
 */
export interface AnemoApi {
  getState(): Promise<BrowserState>
  getConfig(): Promise<AppConfig>
  updateConfig(patch: DeepPartial<AppConfig>): Promise<AppConfig>

  createTab(input: NewTabInput): Promise<Tab>
  closeTab(tabId: string): Promise<void>
  activateTab(tabId: string): Promise<void>
  navigate(tabId: string, input: string): Promise<void>
  goBack(tabId: string): Promise<void>
  goForward(tabId: string): Promise<void>
  reload(tabId: string, ignoreCache?: boolean): Promise<void>
  hibernateTab(tabId: string): Promise<void>
  hibernateInactiveTabs(): Promise<number>

  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>
  switchWorkspace(workspaceId: number): Promise<void>

  getMediaItems(tabId: string): Promise<MediaItem[]>
  toggleBookmark(input: SaveBookmarkInput): Promise<boolean>
  removeBookmark(id: string): Promise<void>
  copyText(text: string): Promise<void>
  exportPageMarkdown(): Promise<ExportResult>

  setContentBounds(bounds: Rect): void
  setOverlay(visible: boolean): void
  setChromeless(enabled: boolean): void

  askAi(input: AiAskInput): Promise<string>
  cancelAi(requestId: string): void

  onStateChanged(listener: (state: BrowserState) => void): () => void
  onConfigChanged(listener: (config: AppConfig) => void): () => void
  onShortcut(listener: (action: ShortcutAction) => void): () => void
  onAiEvent(listener: (event: AiStreamEvent) => void): () => void
}

