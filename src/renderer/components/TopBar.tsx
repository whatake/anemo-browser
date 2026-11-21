import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { BrowserState, TabSnapshot } from '../../shared/types'
import { isAllowedWebUrl } from '../../shared/url'
import {
  ArrowLeft,
  ArrowRight,
  Expand,
  Film,
  Reload,
  Shield,
  Sparkles,
  Star,
} from './Icons'

interface TopBarProps {
  state: BrowserState
  activeTab: TabSnapshot | null
  focusSignal: number
  aiOpen: boolean
  onNavigate: (value: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onToggleBookmark: () => void
  onOpenMedia: () => void
  onToggleAi: () => void
  onToggleChromeless: () => void
  onOpenPalette: () => void
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

function ToolbarButton({
  children,
  onClick,
  disabled,
  active,
  title,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  active?: boolean
  title: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition ${
        active
          ? 'bg-sky-300/10 text-sky-200'
          : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-100'
      } disabled:pointer-events-none disabled:opacity-30`}
    >
      {children}
    </button>
  )
}

export function TopBar({
  state,
  activeTab,
  focusSignal,
  aiOpen,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onToggleBookmark,
  onOpenMedia,
  onToggleAi,
  onToggleChromeless,
  onOpenPalette,
}: TopBarProps) {
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const activeUrl = activeTab?.url === 'about:blank' ? '' : activeTab?.url ?? ''
  const bookmarked = activeTab
    ? state.bookmarks.some((bookmark) => bookmark.url === activeTab.url)
    : false
  const canBookmark = Boolean(activeTab && isAllowedWebUrl(activeTab.url))
  const mediaCount = activeTab?.mediaCount ?? 0

  useEffect(() => {
    if (!focused) setDraft(activeUrl)
  }, [activeUrl, activeTab?.id, focused])

  useEffect(() => {
    if (focusSignal <= 0) return
    const input = inputRef.current
    input?.focus()
    input?.select()
  }, [focusSignal])

  const submit = () => {
    const value = draft.trim()
    if (!value || !activeTab) return
    onNavigate(value)
    inputRef.current?.blur()
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-white/[0.06] bg-[#090d12] px-2.5">
      <ToolbarButton onClick={onBack} disabled={!activeTab?.canGoBack} title="Back (Alt+←)">
        <ArrowLeft />
      </ToolbarButton>
      <ToolbarButton
        onClick={onForward}
        disabled={!activeTab?.canGoForward}
        title="Forward (Alt+→)"
      >
        <ArrowRight />
      </ToolbarButton>
      <ToolbarButton onClick={onReload} disabled={!activeTab} title="Reload (Ctrl+R)">
        <Reload className={activeTab?.isLoading ? 'animate-spin text-sky-300' : ''} />
      </ToolbarButton>

      <div className="mx-1 flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.04] px-3 transition focus-within:border-sky-300/40 focus-within:bg-white/[0.06]">
        <span title="Tracker blocking active" className="shrink-0">
          <Shield className="h-3.5 w-3.5 text-emerald-300/80" />
        </span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(activeUrl)
              inputRef.current?.blur()
            }
          }}
          placeholder="Search DuckDuckGo or enter address"
          spellCheck={false}
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] text-slate-200 outline-none placeholder:text-slate-500"
        />
        {activeTab?.isLoading && (
          <span className="h-3 w-3 shrink-0 animate-spin rounded-full border border-sky-300/30 border-t-sky-300" />
        )}
        <button
          type="button"
          onClick={onOpenPalette}
          title="Command palette"
          className="hidden shrink-0 rounded border border-white/10 bg-white/[0.03] px-1 py-0.5 text-[9px] text-slate-500 hover:text-slate-300 sm:block"
        >
          {isMac ? '⌘' : 'Ctrl'}K
        </button>
      </div>

      {mediaCount > 0 && (
        <button
          type="button"
          onClick={onOpenMedia}
          title={`${mediaCount} media stream(s) detected on this page`}
          className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-sky-300/20 bg-sky-300/[0.07] px-2 text-[11px] text-sky-200 transition hover:bg-sky-300/[0.12]"
        >
          <Film className="h-3.5 w-3.5" />
          <span className="tabular-nums">{mediaCount}</span>
        </button>
      )}

      <ToolbarButton
        onClick={onToggleBookmark}
        disabled={!canBookmark}
        active={bookmarked}
        title={bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
      >
        <Star className={bookmarked ? 'fill-amber-300 text-amber-300' : ''} />
      </ToolbarButton>

      <ToolbarButton onClick={onToggleAi} active={aiOpen} title="Local AI (Ctrl+J)">
        <Sparkles />
      </ToolbarButton>

      <ToolbarButton onClick={onToggleChromeless} title="Chromeless mode (Ctrl+Shift+F)">
        <Expand />
      </ToolbarButton>
    </header>
  )
}
