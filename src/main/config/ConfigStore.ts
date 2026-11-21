import { mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { AiProvider, AppConfig, DeepPartial } from '../../shared/types'

export const DEFAULT_CONFIG: AppConfig = {
  searchEngine: 'https://duckduckgo.com/?q={query}',
  autoHibernateMinutes: 30,
  ai: {
    enabled: true,
    provider: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'llama3.2',
    apiKey: '',
    webhookUrl: '',
  },
  privacy: {
    blockAdsAndTrackers: true,
    sendGlobalPrivacyControl: true,
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function readProvider(value: unknown, fallback: AiProvider): AiProvider {
  return value === 'ollama' || value === 'openai' ? value : fallback
}

function readUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.trim() === '') return fallback
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallback
    return value.trim()
  } catch {
    return fallback
  }
}

/** Validates the file on disk and applies defaults for anything malformed. */
export function sanitizeConfig(raw: unknown): AppConfig {
  const base: AppConfig = structuredClone(DEFAULT_CONFIG)
  if (!isRecord(raw)) return base

  const searchEngine = readString(raw.searchEngine, base.searchEngine)
  base.searchEngine = searchEngine.includes('{query}') ? searchEngine : base.searchEngine

  if (typeof raw.autoHibernateMinutes === 'number' && Number.isFinite(raw.autoHibernateMinutes)) {
    base.autoHibernateMinutes = Math.min(
      1440,
      Math.max(0, Math.round(raw.autoHibernateMinutes)),
    )
  }

  if (isRecord(raw.ai)) {
    base.ai = {
      enabled: readBoolean(raw.ai.enabled, base.ai.enabled),
      provider: readProvider(raw.ai.provider, base.ai.provider),
      baseUrl: readUrl(raw.ai.baseUrl, base.ai.baseUrl),
      model: readString(raw.ai.model, base.ai.model).trim() || base.ai.model,
      apiKey: readString(raw.ai.apiKey, base.ai.apiKey),
      webhookUrl:
        typeof raw.ai.webhookUrl === 'string' && raw.ai.webhookUrl.trim() === ''
          ? ''
          : readUrl(raw.ai.webhookUrl, base.ai.webhookUrl),
    }
  }

  if (isRecord(raw.privacy)) {
    base.privacy = {
      blockAdsAndTrackers: readBoolean(
        raw.privacy.blockAdsAndTrackers,
        base.privacy.blockAdsAndTrackers,
      ),
      sendGlobalPrivacyControl: readBoolean(
        raw.privacy.sendGlobalPrivacyControl,
        base.privacy.sendGlobalPrivacyControl,
      ),
    }
  }

  return base
}

function applyPatch<T extends object>(base: T, patch: unknown): T {
  if (!isRecord(patch)) return base
  const next: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch)) {
    const current = next[key]
    if (isRecord(current) && isRecord(value)) {
      next[key] = applyPatch(current, value)
    } else if (value !== undefined) {
      next[key] = value
    }
  }
  return next as T
}

/**
 * Reads `~/.anemo/config.json`, watches it for external edits and writes
 * updates atomically. The in-memory copy is always the sanitized form.
 */
export class ConfigStore {
  private config: AppConfig
  private watcher: FSWatcher | null = null
  private readonly listeners = new Set<(config: AppConfig) => void>()
  private suppressWatchUntil = 0
  private reloadTimer: NodeJS.Timeout | null = null

  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true })
    this.config = this.load()
    this.write(this.config)
  }

  get(): AppConfig {
    return this.config
  }

  update(patch: DeepPartial<AppConfig>): AppConfig {
    const merged = sanitizeConfig(applyPatch(structuredClone(this.config), patch))
    this.config = merged
    this.write(merged)
    this.suppressWatchUntil = Date.now() + 500
    this.emit()
    return merged
  }

  onChange(listener: (config: AppConfig) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  watch(): void {
    if (this.watcher) return
    const directory = dirname(this.filePath)
    const target = basename(this.filePath)

    this.watcher = watch(directory, (_event, filename) => {
      if (filename && filename.toString() !== target) return
      if (Date.now() < this.suppressWatchUntil) return
      if (this.reloadTimer) clearTimeout(this.reloadTimer)
      this.reloadTimer = setTimeout(() => this.reloadFromDisk(), 180)
    })
  }

  private reloadFromDisk(): void {
    this.reloadTimer = null
    const next = this.load()
    if (JSON.stringify(next) === JSON.stringify(this.config)) return
    this.config = next
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.config)
  }

  private load(): AppConfig {
    try {
      const text = readFileSync(this.filePath, 'utf8')
      return sanitizeConfig(JSON.parse(text))
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      if (!missing) {
        console.error('[config] could not parse config.json, using defaults:', error)
      }
      return structuredClone(DEFAULT_CONFIG)
    }
  }

  private write(config: AppConfig): void {
    try {
      writeFileSync(this.filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    } catch (error) {
      console.error('[config] failed to write config.json:', error)
    }
  }

  dispose(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer)
    this.reloadTimer = null
    this.watcher?.close()
    this.watcher = null
    this.listeners.clear()
  }
}
