import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import type { Bookmark, HistoryEntry, Tab, Workspace } from '../../shared/types'

type SqliteDatabase = InstanceType<typeof BetterSqlite3>

export interface NewTabRecord {
  id?: string
  workspaceId: number
  parentId: string | null
  url: string
  title: string
  favicon?: string | null
  isHibernated: boolean
  serializedState?: string | null
  position?: number
}

export interface TabPatch {
  url?: string
  title?: string
  favicon?: string | null
  isHibernated?: boolean
  serializedState?: string | null
  position?: number
  lastActiveAt?: number
  parentId?: string | null
}

interface WorkspaceRow {
  id: number
  name: string
  color: string
  partition: string
  position: number
  created_at: number
}

interface TabRow {
  id: string
  workspace_id: number
  parent_id: string | null
  url: string
  title: string
  favicon: string | null
  is_hibernated: number
  serialized_state: string | null
  position: number
  created_at: number
  last_active_at: number
}

interface HistoryRow {
  id: number
  url: string
  title: string
  favicon: string | null
  workspace_id: number | null
  visited_at: number
  visit_count: number
}

interface BookmarkRow {
  id: string
  url: string
  title: string
  favicon: string | null
  created_at: number
}

const MIGRATIONS: ReadonlyArray<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE workspaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#7dd3fc',
        partition TEXT NOT NULL UNIQUE,
        position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE tabs (
        id TEXT PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES tabs(id) ON DELETE CASCADE,
        url TEXT NOT NULL DEFAULT 'about:blank',
        title TEXT NOT NULL DEFAULT 'New Tab',
        favicon TEXT,
        is_hibernated INTEGER NOT NULL DEFAULT 0,
        serialized_state TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL
      );

      CREATE INDEX idx_tabs_workspace_tree ON tabs(workspace_id, parent_id, position);
      CREATE INDEX idx_tabs_parent ON tabs(parent_id);

      CREATE TABLE history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        favicon TEXT,
        workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,
        visited_at INTEGER NOT NULL,
        visit_count INTEGER NOT NULL DEFAULT 1
      );
      CREATE UNIQUE INDEX idx_history_url ON history(url);
      CREATE INDEX idx_history_visited ON history(visited_at DESC);

      CREATE TABLE bookmarks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT '',
        favicon TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
]

function mapWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    partition: row.partition,
    position: row.position,
    createdAt: row.created_at,
  }
}

function mapTab(row: TabRow): Tab {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    parentId: row.parent_id,
    url: row.url,
    title: row.title,
    favicon: row.favicon,
    isHibernated: row.is_hibernated === 1,
    position: row.position,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  }
}

function mapHistory(row: HistoryRow): HistoryEntry {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    favicon: row.favicon,
    workspaceId: row.workspace_id,
    visitedAt: row.visited_at,
    visitCount: row.visit_count,
  }
}

function mapBookmark(row: BookmarkRow): Bookmark {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    favicon: row.favicon,
    createdAt: row.created_at,
  }
}

/**
 * SQLite-backed store for workspaces, the tab tree, history, bookmarks and
 * serialized hibernated tab state. Migrations are applied through
 * `PRAGMA user_version`, so the file can be upgraded in place.
 */
export class Database {
  private readonly db: SqliteDatabase

  constructor(filePath: string) {
    if (filePath !== ':memory:') {
      mkdirSync(dirname(filePath), { recursive: true })
    }
    this.db = new BetterSqlite3(filePath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    this.migrate()
  }

  private migrate(): void {
    const current = this.db.pragma('user_version', { simple: true }) as number
    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue
      const apply = this.db.transaction(() => {
        this.db.exec(migration.sql)
        this.db.pragma(`user_version = ${migration.version}`)
      })
      apply()
    }
  }

  close(): void {
    this.db.close()
  }

  // ---------------------------------------------------------------------------
  // Workspaces
  // ---------------------------------------------------------------------------

  listWorkspaces(): Workspace[] {
    const rows = this.db
      .prepare('SELECT * FROM workspaces ORDER BY position ASC, id ASC')
      .all() as WorkspaceRow[]
    return rows.map(mapWorkspace)
  }

  getWorkspace(id: number): Workspace | null {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as
      | WorkspaceRow
      | undefined
    return row ? mapWorkspace(row) : null
  }

  createWorkspace(input: { name?: string; color?: string } = {}): Workspace {
    const now = Date.now()
    const next = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM workspaces')
      .get() as { next: number }

    const insert = this.db.prepare(
      'INSERT INTO workspaces (name, color, partition, position, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    const updatePartition = this.db.prepare('UPDATE workspaces SET partition = ? WHERE id = ?')

    const id = this.db.transaction(() => {
      const result = insert.run(
        input.name?.trim() || 'New Workspace',
        input.color ?? '#7dd3fc',
        '',
        next.next,
        now,
      )
      const workspaceId = Number(result.lastInsertRowid)
      updatePartition.run(`persist:workspace_${workspaceId}`, workspaceId)
      return workspaceId
    })()

    const workspace = this.getWorkspace(id)
    if (!workspace) throw new Error(`Failed to create workspace ${id}`)
    return workspace
  }

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------

  listTabs(workspaceId?: number): Tab[] {
    const rows = (
      workspaceId === undefined
        ? this.db.prepare('SELECT * FROM tabs ORDER BY position ASC, created_at ASC').all()
        : this.db
            .prepare(
              'SELECT * FROM tabs WHERE workspace_id = ? ORDER BY position ASC, created_at ASC',
            )
            .all(workspaceId)
    ) as TabRow[]
    return rows.map(mapTab)
  }

  getTab(id: string): Tab | null {
    const row = this.db.prepare('SELECT * FROM tabs WHERE id = ?').get(id) as TabRow | undefined
    return row ? mapTab(row) : null
  }

  getSerializedState(id: string): string | null {
    const row = this.db.prepare('SELECT serialized_state FROM tabs WHERE id = ?').get(id) as
      | { serialized_state: string | null }
      | undefined
    return row?.serialized_state ?? null
  }

  createTab(input: NewTabRecord): Tab {
    const id = input.id ?? randomUUID()
    const now = Date.now()
    const position = input.position ?? this.nextTabPosition(input.workspaceId, input.parentId)

    this.db
      .prepare(
        `INSERT INTO tabs
         (id, workspace_id, parent_id, url, title, favicon, is_hibernated, serialized_state, position, created_at, last_active_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.parentId,
        input.url,
        input.title,
        input.favicon ?? null,
        input.isHibernated ? 1 : 0,
        input.serializedState ?? null,
        position,
        now,
        now,
      )

    const tab = this.getTab(id)
    if (!tab) throw new Error(`Failed to create tab ${id}`)
    return tab
  }

  private nextTabPosition(workspaceId: number, parentId: string | null): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(position), -1) + 1 AS next
         FROM tabs WHERE workspace_id = ? AND parent_id IS ?`,
      )
      .get(workspaceId, parentId) as { next: number }
    return row.next
  }

  updateTab(id: string, patch: TabPatch): void {
    const columns: Record<string, string> = {
      url: 'url',
      title: 'title',
      favicon: 'favicon',
      isHibernated: 'is_hibernated',
      serializedState: 'serialized_state',
      position: 'position',
      lastActiveAt: 'last_active_at',
      parentId: 'parent_id',
    }

    const assignments: string[] = []
    const values: Array<string | number | null> = []
    for (const key of Object.keys(patch) as Array<keyof TabPatch>) {
      const value = patch[key]
      if (value === undefined) continue
      const column = columns[key]
      if (!column) continue
      assignments.push(`${column} = ?`)
      values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value)
    }
    if (assignments.length === 0) return

    this.db
      .prepare(`UPDATE tabs SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values, id)
  }

  setHibernated(
    id: string,
    serializedState: string | null,
    snapshot?: { url: string; title: string; favicon: string | null },
  ): void {
    this.db
      .prepare(
        `UPDATE tabs
         SET is_hibernated = 1, serialized_state = ?, url = COALESCE(?, url),
             title = COALESCE(?, title), favicon = COALESCE(?, favicon)
         WHERE id = ?`,
      )
      .run(
        serializedState,
        snapshot?.url ?? null,
        snapshot?.title ?? null,
        snapshot?.favicon ?? null,
        id,
      )
  }

  deleteTab(id: string): void {
    this.db.prepare('DELETE FROM tabs WHERE id = ?').run(id)
  }

  /** The tab itself plus every descendant, used to tear down child views. */
  descendantIds(id: string): string[] {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE tree(id) AS (
           SELECT id FROM tabs WHERE id = ?
           UNION ALL
           SELECT t.id FROM tabs t JOIN tree ON t.parent_id = tree.id
         )
         SELECT id FROM tree`,
      )
      .all(id) as Array<{ id: string }>
    return rows.map((row) => row.id)
  }

  hibernateAllTabs(): void {
    this.db.prepare('UPDATE tabs SET is_hibernated = 1').run()
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  recordVisit(input: {
    url: string
    title: string
    favicon: string | null
    workspaceId: number | null
  }): void {
    if (!/^https?:\/\//i.test(input.url)) return
    this.db
      .prepare(
        `INSERT INTO history (url, title, favicon, workspace_id, visited_at, visit_count)
         VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT(url) DO UPDATE SET
           title = excluded.title,
           favicon = COALESCE(excluded.favicon, history.favicon),
           workspace_id = excluded.workspace_id,
           visited_at = excluded.visited_at,
           visit_count = history.visit_count + 1`,
      )
      .run(input.url, input.title, input.favicon, input.workspaceId, Date.now())
  }

  listHistory(limit = 200): HistoryEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM history ORDER BY visited_at DESC LIMIT ?')
      .all(limit) as HistoryRow[]
    return rows.map(mapHistory)
  }

  searchHistory(query: string, limit = 50): HistoryEntry[] {
    const like = `%${query.replace(/[%_]/g, '')}%`
    const rows = this.db
      .prepare(
        `SELECT * FROM history
         WHERE title LIKE ? OR url LIKE ?
         ORDER BY visited_at DESC LIMIT ?`,
      )
      .all(like, like, limit) as HistoryRow[]
    return rows.map(mapHistory)
  }

  // ---------------------------------------------------------------------------
  // Bookmarks
  // ---------------------------------------------------------------------------

  listBookmarks(): Bookmark[] {
    const rows = this.db
      .prepare('SELECT * FROM bookmarks ORDER BY created_at DESC')
      .all() as BookmarkRow[]
    return rows.map(mapBookmark)
  }

  findBookmarkByUrl(url: string): Bookmark | null {
    const row = this.db.prepare('SELECT * FROM bookmarks WHERE url = ?').get(url) as
      | BookmarkRow
      | undefined
    return row ? mapBookmark(row) : null
  }

  addBookmark(input: { url: string; title: string; favicon: string | null }): Bookmark {
    const existing = this.findBookmarkByUrl(input.url)
    if (existing) {
      this.db
        .prepare('UPDATE bookmarks SET title = ?, favicon = COALESCE(?, favicon) WHERE id = ?')
        .run(input.title, input.favicon, existing.id)
      return this.findBookmarkByUrl(input.url) ?? existing
    }

    const id = randomUUID()
    this.db
      .prepare(
        'INSERT INTO bookmarks (id, url, title, favicon, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, input.url, input.title, input.favicon, Date.now())

    return {
      id,
      url: input.url,
      title: input.title,
      favicon: input.favicon,
      createdAt: Date.now(),
    }
  }

  removeBookmark(id: string): void {
    this.db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id)
  }

  // ---------------------------------------------------------------------------
  // Metadata (active workspace/tab, future migrations)
  // ---------------------------------------------------------------------------

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value)
  }
}
