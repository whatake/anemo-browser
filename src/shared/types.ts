export interface Workspace {
  id: number
  name: string
  color: string
  partition: string
  position: number
  createdAt: number
}

export interface Tab {
  id: string
  workspaceId: number
  parentId: string | null
  url: string
  title: string
  favicon: string | null
  isHibernated: boolean
  position: number
  createdAt: number
  lastActiveAt: number
}

export interface TabSnapshot extends Tab {
  isActive: boolean
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  isAudible: boolean
  mediaCount: number
}

export type MediaKind = 'hls' | 'dash' | 'video' | 'audio'

export interface MediaItem {
  url: string
  kind: MediaKind
  contentType: string
  foundAt: number
}

export interface Bookmark {
  id: string
  url: string
  title: string
  favicon: string | null
  createdAt: number
}

export interface HistoryEntry {
  id: number
  url: string
  title: string
  favicon: string | null
  workspaceId: number | null
  visitedAt: number
  visitCount: number
}

export interface BrowserState {
  workspaces: Workspace[]
  tabs: TabSnapshot[]
  bookmarks: Bookmark[]
  activeWorkspaceId: number
  activeTabId: string | null
  chromeless: boolean
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type AiProvider = 'ollama' | 'openai'

export interface AiConfig {
  enabled: boolean
  provider: AiProvider
  baseUrl: string
  model: string
  apiKey: string
  webhookUrl: string
}

export interface AppConfig {
  searchEngine: string
  autoHibernateMinutes: number
  ai: AiConfig
  privacy: {
    blockAdsAndTrackers: boolean
    sendGlobalPrivacyControl: boolean
  }
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export interface NewTabInput {
  workspaceId?: number
  parentId?: string | null
  url?: string
  activate?: boolean
  /** Whether keyboard focus should move into the page once it is shown. */
  focusPage?: boolean
}

export interface CreateWorkspaceInput {
  name?: string
  color?: string
}

export interface SaveBookmarkInput {
  url: string
  title: string
  favicon: string | null
}

export interface ExportResult {
  saved: boolean
  path?: string
}

export type ShortcutAction =
  | 'palette'
  | 'focus-omnibox'
  | 'new-tab'
  | 'close-tab'
  | 'reload'
  | 'back'
  | 'forward'
  | 'toggle-sidebar'
  | 'toggle-ai'
  | 'hibernate-inactive'
  | 'export-markdown'
  | 'toggle-chromeless'

export type AiStreamEvent =
  | { requestId: string; type: 'token'; text: string }
  | { requestId: string; type: 'done' }
  | { requestId: string; type: 'error'; message: string }

export interface AiAskInput {
  prompt: string
  includePage: boolean
}

export interface AiPageContext {
  title: string
  url: string
  text: string
}
