import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { session as electronSession, type Session } from 'electron'
import type { AppConfig, MediaItem, MediaKind } from '../../shared/types'

type MediaListener = (webContentsId: number) => void

const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock'])
const MAX_MEDIA_ITEMS_PER_TAB = 60

function headerValue(
  headers: Record<string, string[]> | undefined,
  name: string,
): string {
  if (!headers) return ''
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) {
      const first = value[0]
      return typeof first === 'string' ? first.toLowerCase() : ''
    }
  }
  return ''
}

function classifyMedia(url: string, contentType: string): MediaKind | null {
  const [pathname] = url.split('?')
  const path = (pathname ?? '').toLowerCase()

  if (path.endsWith('.m3u8') || contentType.includes('mpegurl')) return 'hls'
  if (path.endsWith('.mpd') || contentType.includes('dash+xml')) return 'dash'
  if (contentType.startsWith('audio/')) return 'audio'
  if (contentType.startsWith('video/')) return 'video'
  if (/\.(mp4|webm|mov|mkv)$/.test(path)) return 'video'
  if (/\.(mp3|m4a|aac|ogg|flac)$/.test(path)) return 'audio'
  return null
}

/**
 * Owns per-workspace sessions. Each partition gets the Ghostery ad/tracker
 * blocker, privacy request headers and a passive media URL sniffer. Listeners
 * are installed exactly once per partition because Electron allows a single
 * webRequest listener per event per session.
 */
export class PrivacyEngine {
  private blocker: ElectronBlocker | null = null
  private readonly sessions = new Map<string, Session>()
  private readonly blockedPartitions = new Set<string>()
  private readonly mediaByWebContents = new Map<number, MediaItem[]>()
  private readonly mediaListeners = new Set<MediaListener>()

  constructor(private readonly getConfig: () => AppConfig) {}

  async init(): Promise<void> {
    try {
      this.blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch)
      console.log('[privacy] ad/tracker lists loaded')
    } catch (error) {
      console.error('[privacy] could not load ad/tracker lists; continuing without blocking', error)
    }
  }

  ensureSession(partition: string): Session {
    const existing = this.sessions.get(partition)
    if (existing) return existing

    const workspaceSession = electronSession.fromPartition(partition)
    this.configureSession(workspaceSession, partition)
    this.sessions.set(partition, workspaceSession)
    return workspaceSession
  }

  private configureSession(workspaceSession: Session, partition: string): void {
    const config = this.getConfig()

    if (config.privacy.blockAdsAndTrackers && this.blocker) {
      try {
        this.blocker.enableBlockingInSession(workspaceSession)
        this.blockedPartitions.add(partition)
      } catch (error) {
        console.error('[privacy] failed to attach blocker', error)
      }
    }

    workspaceSession.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission))
    })
    workspaceSession.setPermissionCheckHandler((_contents, permission) =>
      ALLOWED_PERMISSIONS.has(permission),
    )

    workspaceSession.webRequest.onBeforeSendHeaders(
      { urls: ['*://*/*'] },
      (details, callback) => {
        const headers = details.requestHeaders
        if (this.getConfig().privacy.sendGlobalPrivacyControl) {
          headers['DNT'] = '1'
          headers['Sec-GPC'] = '1'
          delete headers['X-Client-Data']
          delete headers['x-client-data']
        }
        callback({ requestHeaders: headers })
      },
    )

    workspaceSession.webRequest.onResponseStarted({ urls: ['*://*/*'] }, (details) => {
      const webContentsId = details.webContentsId
      if (!webContentsId) return

      const contentType = headerValue(details.responseHeaders, 'content-type')
      const kind = classifyMedia(details.url, contentType)
      if (!kind) return

      const items = this.mediaByWebContents.get(webContentsId) ?? []
      if (items.some((item) => item.url === details.url)) return
      if (items.length >= MAX_MEDIA_ITEMS_PER_TAB) return

      items.push({ url: details.url, kind, contentType, foundAt: Date.now() })
      this.mediaByWebContents.set(webContentsId, items)
      for (const listener of this.mediaListeners) listener(webContentsId)
    })
  }

  /** Re-applies the adblock toggle after a config file edit. */
  syncPrivacyConfig(): void {
    if (!this.blocker) return
    const enabled = this.getConfig().privacy.blockAdsAndTrackers
    for (const [partition, workspaceSession] of this.sessions) {
      try {
        if (enabled && !this.blockedPartitions.has(partition)) {
          this.blocker.enableBlockingInSession(workspaceSession)
          this.blockedPartitions.add(partition)
        } else if (!enabled && this.blockedPartitions.has(partition)) {
          this.blocker.disableBlockingInSession(workspaceSession)
          this.blockedPartitions.delete(partition)
        }
      } catch (error) {
        console.error('[privacy] failed to sync blocker state', error)
      }
    }
  }

  mediaFor(webContentsId: number): MediaItem[] {
    return [...(this.mediaByWebContents.get(webContentsId) ?? [])]
  }

  mediaCount(webContentsId: number): number {
    return this.mediaByWebContents.get(webContentsId)?.length ?? 0
  }

  forgetWebContents(webContentsId: number): void {
    this.mediaByWebContents.delete(webContentsId)
  }

  onMediaChanged(listener: MediaListener): () => void {
    this.mediaListeners.add(listener)
    return () => this.mediaListeners.delete(listener)
  }
}
