import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from '../src/main/storage/Database'

const directory = mkdtempSync(join(tmpdir(), 'anemo-db-'))
const file = join(directory, 'anemo.db')

try {
  const db = new Database(file)

  const workspace = db.createWorkspace({ name: 'Personal', color: '#7dd3fc' })
  assert.equal(workspace.partition, `persist:workspace_${workspace.id}`)
  assert.equal(db.listWorkspaces().length, 1)

  const parent = db.createTab({
    workspaceId: workspace.id,
    parentId: null,
    url: 'https://example.com',
    title: 'Example',
    isHibernated: false,
  })
  const child = db.createTab({
    workspaceId: workspace.id,
    parentId: parent.id,
    url: 'https://example.com/child',
    title: 'Child',
    isHibernated: false,
  })
  const sibling = db.createTab({
    workspaceId: workspace.id,
    parentId: null,
    url: 'https://example.org',
    title: 'Sibling',
    isHibernated: true,
  })

  assert.deepEqual(
    new Set(db.descendantIds(parent.id)),
    new Set([parent.id, child.id]),
  )
  assert.equal(db.getTab(child.id)?.parentId, parent.id)
  assert.equal(db.getTab(child.id)?.position, 0)
  assert.equal(db.getTab(sibling.id)?.position, 1)

  const serialized = JSON.stringify({
    url: 'https://example.com/child',
    title: 'Child',
    favicon: null,
    scrollY: 120,
    savedAt: Date.now(),
  })
  db.setHibernated(child.id, serialized, {
    url: 'https://example.com/child',
    title: 'Child',
    favicon: null,
  })
  const childAfter = db.getTab(child.id)
  assert.equal(childAfter?.isHibernated, true)
  assert.equal(db.getSerializedState(child.id), serialized)

  db.recordVisit({
    url: 'https://example.com',
    title: 'Example',
    favicon: null,
    workspaceId: workspace.id,
  })
  db.recordVisit({
    url: 'https://example.com',
    title: 'Example v2',
    favicon: 'https://example.com/favicon.ico',
    workspaceId: workspace.id,
  })
  db.recordVisit({
    url: 'about:blank',
    title: 'Ignored',
    favicon: null,
    workspaceId: workspace.id,
  })
  const history = db.listHistory()
  assert.equal(history.length, 1)
  assert.equal(history[0]?.visitCount, 2)
  assert.equal(history[0]?.title, 'Example v2')

  const bookmark = db.addBookmark({
    url: 'https://example.com',
    title: 'Example',
    favicon: null,
  })
  assert.equal(db.listBookmarks().length, 1)
  assert.equal(db.findBookmarkByUrl('https://example.com')?.id, bookmark.id)
  db.removeBookmark(bookmark.id)
  assert.equal(db.listBookmarks().length, 0)

  db.setMeta('active_workspace_id', String(workspace.id))
  db.setMeta('active_tab_Personal', child.id)
  db.close()

  const reopened = new Database(file)
  assert.equal(reopened.listWorkspaces().length, 1)
  assert.equal(reopened.listTabs().length, 3)
  assert.equal(reopened.getMeta('active_workspace_id'), String(workspace.id))
  assert.equal(reopened.getSerializedState(child.id), serialized)

  // Foreign key cascade: deleting the parent removes the child row.
  reopened.deleteTab(parent.id)
  assert.deepEqual(
    reopened.listTabs().map((tab) => tab.id),
    [sibling.id],
  )
  reopened.close()

  console.log('database smoke test passed')
} finally {
  rmSync(directory, { recursive: true, force: true })
}
