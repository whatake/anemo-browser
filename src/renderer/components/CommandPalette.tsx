import { useEffect, useRef, useState } from 'react'
import type { Bookmark, BrowserState } from '../../shared/types'
import { displayUrl } from '../../shared/url'
import { bestScore } from '../lib/fuzzy'
import type { PaletteAction } from '../lib/palette'
import { Command, Film, Globe, Search, Star, Wind } from './Icons'

interface CommandPaletteProps {
  state: BrowserState
  actions: PaletteAction[]
  onClose: () => void
  onSelectTab: (tabId: string) => void
  onOpenBookmark: (bookmark: Bookmark) => void
  onSwitchWorkspace: (workspaceId: number) => void
}

type EntryKind = 'action' | 'tab' | 'bookmark' | 'workspace'

interface Entry {
  id: string
  kind: EntryKind
  title: string
  subtitle: string
  hint?: string
  haystack: string[]
  run: () => void | Promise<void>
}

const KIND_LABEL: Record<EntryKind, string> = {
  action: 'ACTION',
  tab: 'TAB',
  bookmark: 'BOOKMARK',
  workspace: 'SPACE',
}

function KindIcon({ kind }: { kind: EntryKind }) {
  const className = 'h-3.5 w-3.5'
  switch (kind) {
    case 'action':
      return <Command className={className} />
    case 'tab':
      return <Film className={className} />
    case 'bookmark':
      return <Star className={className} />
    case 'workspace':
      return <Wind className={className} />
  }
}

export function CommandPalette({
  state,
  actions,
  onClose,
  onSelectTab,
  onOpenBookmark,
  onSwitchWorkspace,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const workspaceName = (workspaceId: number) =>
    state.workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? 'Workspace'

  const entries: Entry[] = []

  for (const action of actions) {
    entries.push({
      id: `action:${action.id}`,
      kind: 'action',
      title: action.label,
      subtitle: action.keywords ?? 'Browser action',
      hint: action.hint,
      haystack: [action.label, action.keywords ?? '', action.id],
      run: action.run,
    })
  }

  for (const tab of state.tabs) {
    entries.push({
      id: `tab:${tab.id}`,
      kind: 'tab',
      title: tab.title || displayUrl(tab.url),
      subtitle: `${tab.isHibernated ? 'Hibernated' : 'Open'} · ${workspaceName(
        tab.workspaceId,
      )} · ${displayUrl(tab.url)}`,
      haystack: [
        tab.title,
        tab.url,
        workspaceName(tab.workspaceId),
        tab.isHibernated ? 'hibernated' : 'open',
      ],
      run: () => onSelectTab(tab.id),
    })
  }

  for (const bookmark of state.bookmarks) {
    entries.push({
      id: `bookmark:${bookmark.id}`,
      kind: 'bookmark',
      title: bookmark.title || displayUrl(bookmark.url),
      subtitle: displayUrl(bookmark.url),
      haystack: [bookmark.title, bookmark.url, 'bookmark'],
      run: () => onOpenBookmark(bookmark),
    })
  }

  for (const workspace of state.workspaces) {
    entries.push({
      id: `workspace:${workspace.id}`,
      kind: 'workspace',
      title: workspace.name,
      subtitle: `${workspace.partition} · isolated session`,
      haystack: [workspace.name, 'workspace', 'switch space'],
      run: () => onSwitchWorkspace(workspace.id),
    })
  }

  const ranked = entries
    .map((entry) => {
      const score = query.trim() ? bestScore(query, entry.haystack) : 1
      return score === null ? null : { entry, score }
    })
    .filter((item): item is { entry: Entry; score: number } => item !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40)
    .map((item) => item.entry)

  useEffect(() => {
    setSelected(0)
  }, [query])

  useEffect(() => {
    document.getElementById(`anemo-palette-${selected}`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const runEntry = (entry: Entry | undefined) => {
    if (!entry) return
    onClose()
    void entry.run()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[10vh] backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#0b1017] shadow-2xl shadow-black/60">
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-slate-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSelected((current) => Math.min(ranked.length - 1, current + 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setSelected((current) => Math.max(0, current - 1))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                runEntry(ranked[selected])
              } else if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
              }
            }}
            placeholder="Search tabs, bookmarks, workspaces or run a command…"
            spellCheck={false}
            className="h-6 flex-1 bg-transparent text-[14px] text-slate-100 outline-none placeholder:text-slate-500"
          />
          <kbd className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[9px] text-slate-500">
            ESC
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-1.5">
          {ranked.length === 0 && (
            <div className="px-4 py-10 text-center text-xs text-slate-500">
              Nothing matches “{query}”.
            </div>
          )}

          {ranked.map((entry, index) => (
            <button
              type="button"
              key={entry.id}
              id={`anemo-palette-${index}`}
              onClick={() => runEntry(entry)}
              onMouseEnter={() => setSelected(index)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                index === selected
                  ? 'bg-sky-300/[0.09] ring-1 ring-inset ring-sky-300/25'
                  : 'hover:bg-white/[0.04]'
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                  index === selected
                    ? 'bg-sky-300/15 text-sky-200'
                    : 'bg-white/[0.05] text-slate-400'
                }`}
              >
                <KindIcon kind={entry.kind} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-slate-100">{entry.title}</span>
                <span className="block truncate text-[10.5px] text-slate-500">{entry.subtitle}</span>
              </span>
              {entry.hint ? (
                <kbd className="shrink-0 rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[9px] text-slate-500">
                  {entry.hint}
                </kbd>
              ) : (
                <span className="shrink-0 text-[8px] font-semibold tracking-[0.14em] text-slate-600">
                  {KIND_LABEL[entry.kind]}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4 border-t border-white/[0.06] px-4 py-2 text-[9.5px] text-slate-600">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span className="ml-auto flex items-center gap-1">
            <Globe className="h-3 w-3" />
            local · private
          </span>
        </div>
      </div>
    </div>
  )
}
