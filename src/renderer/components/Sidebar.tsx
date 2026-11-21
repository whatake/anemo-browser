import { useMemo, useState } from 'react'
import type { BrowserState, TabSnapshot } from '../../shared/types'
import { displayUrl } from '../../shared/url'
import {
  ChevronDown,
  ChevronRight,
  Command,
  Film,
  Moon,
  PanelLeft,
  Plus,
  SidebarExpand,
  Wind,
  X,
} from './Icons'

interface SidebarProps {
  state: BrowserState
  collapsed: boolean
  onToggleCollapsed: () => void
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onCreateTab: (parentId: string | null) => void
  onCreateWorkspace: () => void
  onSwitchWorkspace: (workspaceId: number) => void
  onOpenPalette: () => void
}

interface TabNode {
  tab: TabSnapshot
  children: TabNode[]
}

function buildTree(tabs: TabSnapshot[], workspaceId: number): TabNode[] {
  const nodes = new Map<string, TabNode>()
  for (const tab of tabs) {
    if (tab.workspaceId === workspaceId) nodes.set(tab.id, { tab, children: [] })
  }

  const roots: TabNode[] = []
  for (const node of nodes.values()) {
    const parent = node.tab.parentId ? nodes.get(node.tab.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const sort = (list: TabNode[]) => {
    list.sort((a, b) => a.tab.position - b.tab.position)
    for (const node of list) sort(node.children)
  }
  sort(roots)
  return roots
}

function Favicon({ tab, size = 14 }: { tab: TabSnapshot; size?: number }) {
  const [failedFor, setFailedFor] = useState<string | null>(null)
  const favicon = tab.favicon

  if (favicon && failedFor !== favicon) {
    return (
      <img
        src={favicon}
        width={size}
        height={size}
        alt=""
        referrerPolicy="no-referrer"
        className="shrink-0 rounded-[3px]"
        onError={() => setFailedFor(favicon)}
      />
    )
  }

  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[3px] bg-white/10 text-[8px] font-semibold text-slate-300"
      style={{ width: size, height: size }}
    >
      {(tab.title || 'A').slice(0, 1).toUpperCase()}
    </span>
  )
}

interface TabRowProps {
  node: TabNode
  depth: number
  activeTabId: string | null
  collapsedIds: Set<string>
  onToggleCollapse: (tabId: string) => void
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onCreateTab: (parentId: string) => void
}

function TabRow({
  node,
  depth,
  activeTabId,
  collapsedIds,
  onToggleCollapse,
  onSelectTab,
  onCloseTab,
  onCreateTab,
}: TabRowProps) {
  const tab = node.tab
  const hasChildren = node.children.length > 0
  const collapsed = collapsedIds.has(tab.id)
  const active = tab.id === activeTabId

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelectTab(tab.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelectTab(tab.id)
          }
        }}
        className={`group flex h-8 cursor-default items-center gap-1.5 rounded-md pr-1 text-slate-400 outline-none transition-colors ${
          active
            ? 'bg-white/[0.07] text-slate-100 shadow-[inset_2px_0_0_0_#7dd3fc]'
            : 'hover:bg-white/[0.04] hover:text-slate-200'
        }`}
        style={{ paddingLeft: 6 + depth * 14 }}
        title={tab.url}
      >
        <button
          type="button"
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-500 hover:text-slate-200 ${
            hasChildren ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          onClick={(event) => {
            event.stopPropagation()
            onToggleCollapse(tab.id)
          }}
          title={collapsed ? 'Expand children' : 'Collapse children'}
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>

        <Favicon tab={tab} />

        <span className={`min-w-0 flex-1 truncate text-[12px] ${
          tab.isHibernated && !active ? 'text-slate-400/80' : ''
        }`}>
          {tab.title || displayUrl(tab.url)}
        </span>

        {tab.mediaCount > 0 && (
          <span title={`${tab.mediaCount} media stream(s) detected`} className="shrink-0">
            <Film className="h-3 w-3 text-sky-300/80" />
          </span>
        )}
        {tab.isHibernated && (
          <span title="Hibernated — restored when selected" className="shrink-0">
            <Moon className="h-3 w-3 text-slate-500" />
          </span>
        )}

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-slate-100"
            onClick={(event) => {
              event.stopPropagation()
              onCreateTab(tab.id)
            }}
            title="New child tab"
          >
            <Plus className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-slate-100"
            onClick={(event) => {
              event.stopPropagation()
              onCloseTab(tab.id)
            }}
            title="Close tab"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {hasChildren && !collapsed && (
        <div>
          {node.children.map((child) => (
            <TabRow
              key={child.tab.id}
              node={child}
              depth={depth + 1}
              activeTabId={activeTabId}
              collapsedIds={collapsedIds}
              onToggleCollapse={onToggleCollapse}
              onSelectTab={onSelectTab}
              onCloseTab={onCloseTab}
              onCreateTab={onCreateTab}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

export function Sidebar({
  state,
  collapsed,
  onToggleCollapsed,
  onSelectTab,
  onCloseTab,
  onCreateTab,
  onCreateWorkspace,
  onSwitchWorkspace,
  onOpenPalette,
}: SidebarProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
  const activeWorkspace =
    state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ??
    state.workspaces[0] ??
    null
  const tree = useMemo(
    () => buildTree(state.tabs, state.activeWorkspaceId),
    [state.tabs, state.activeWorkspaceId],
  )
  const workspaceTabs = useMemo(
    () => state.tabs.filter((tab) => tab.workspaceId === state.activeWorkspaceId),
    [state.tabs, state.activeWorkspaceId],
  )

  const toggleCollapse = (tabId: string) => {
    setCollapsedIds((previous) => {
      const next = new Set(previous)
      if (next.has(tabId)) next.delete(tabId)
      else next.add(tabId)
      return next
    })
  }

  if (collapsed) {
    return (
      <aside className="flex w-14 shrink-0 flex-col items-center border-r border-white/[0.06] bg-[#090d12] py-2">
        <button
          type="button"
          onClick={onOpenPalette}
          title="Anemo — open command palette"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-300 to-emerald-300 text-[#061018]"
        >
          <Wind className="h-4 w-4" />
        </button>

        <div className="mt-3 flex flex-col items-center gap-1.5">
          {state.workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              onClick={() => onSwitchWorkspace(workspace.id)}
              title={workspace.name}
              className={`flex h-6 w-6 items-center justify-center rounded-full transition ${
                workspace.id === state.activeWorkspaceId
                  ? 'bg-white/10 ring-1 ring-white/20'
                  : 'hover:bg-white/5'
              }`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: workspace.color }}
              />
            </button>
          ))}
        </div>

        <div className="my-2 h-px w-6 bg-white/[0.07]" />

        <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto px-1">
          {workspaceTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              title={`${tab.title || displayUrl(tab.url)}${tab.isHibernated ? ' (hibernated)' : ''}`}
              className={`flex h-8 w-8 items-center justify-center rounded-md transition ${
                tab.id === state.activeTabId
                  ? 'bg-white/[0.08] ring-1 ring-sky-300/30'
                  : 'hover:bg-white/[0.05]'
              } ${tab.isHibernated ? 'opacity-60' : ''}`}
            >
              <Favicon tab={tab} size={16} />
            </button>
          ))}
        </div>

        <div className="flex flex-col items-center gap-1 pt-2">
          <button
            type="button"
            onClick={() => onCreateTab(null)}
            title="New tab"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-slate-100"
          >
            <Plus />
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            title="Expand sidebar (Ctrl+B)"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-slate-100"
          >
            <SidebarExpand />
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="flex w-[296px] shrink-0 flex-col border-r border-white/[0.06] bg-[#090d12]">
      <div className="flex h-12 items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-sky-300 to-emerald-300 text-[#061018]">
            <Wind className="h-3.5 w-3.5" />
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-wide text-slate-100">Anemo</div>
            <div className="text-[9px] uppercase tracking-[0.16em] text-slate-500">
              {activeWorkspace?.name ?? 'Workspace'}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          title="Collapse sidebar (Ctrl+B)"
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-white/5 hover:text-slate-200"
        >
          <PanelLeft />
        </button>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto px-2.5 pb-2 pt-1">
        {state.workspaces.map((workspace) => {
          const count = state.tabs.filter((tab) => tab.workspaceId === workspace.id).length
          const active = workspace.id === state.activeWorkspaceId
          return (
            <button
              key={workspace.id}
              type="button"
              onClick={() => onSwitchWorkspace(workspace.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition ${
                active
                  ? 'bg-white/[0.09] text-slate-100 ring-1 ring-white/10'
                  : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
              }`}
              title={`${workspace.name} — ${workspace.partition}`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: workspace.color }}
              />
              <span className="max-w-[92px] truncate">{workspace.name}</span>
              <span className="text-[9px] tabular-nums text-slate-500">{count}</span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={onCreateWorkspace}
          title="New isolated workspace"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-white/5 hover:text-slate-200"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      <div className="mx-2.5 h-px bg-white/[0.05]" />

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {tree.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] leading-relaxed text-slate-500">
            No tabs in this workspace.
            <br />
            Press {isMac ? '⌘' : 'Ctrl'}+T to start.
          </div>
        ) : (
          tree.map((node) => (
            <TabRow
              key={node.tab.id}
              node={node}
              depth={0}
              activeTabId={state.activeTabId}
              collapsedIds={collapsedIds}
              onToggleCollapse={toggleCollapse}
              onSelectTab={onSelectTab}
              onCloseTab={onCloseTab}
              onCreateTab={onCreateTab}
            />
          ))
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-white/[0.06] p-2">
        <button
          type="button"
          onClick={onOpenPalette}
          className="flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] text-slate-400 transition hover:bg-white/[0.05] hover:text-slate-200"
        >
          <Command className="h-3.5 w-3.5" />
          <span>Command</span>
          <kbd className="ml-auto rounded border border-white/10 bg-white/[0.04] px-1 py-0.5 text-[9px] text-slate-500">
            {isMac ? '⌘' : 'Ctrl'}K
          </kbd>
        </button>
        <button
          type="button"
          onClick={() => onCreateTab(null)}
          title="New tab (Ctrl+T)"
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/5 hover:text-slate-100"
        >
          <Plus />
        </button>
      </div>
    </aside>
  )
}
