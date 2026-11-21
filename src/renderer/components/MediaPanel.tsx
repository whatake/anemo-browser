import { useEffect, useState } from 'react'
import type { MediaItem } from '../../shared/types'
import { Copy, Film, Play, X } from './Icons'

interface MediaPanelProps {
  tabId: string
  onClose: () => void
  onOpen: (url: string) => void
}

const KIND_LABEL: Record<MediaItem['kind'], string> = {
  hls: 'HLS',
  dash: 'DASH',
  video: 'VIDEO',
  audio: 'AUDIO',
}

export function MediaPanel({ tabId, onClose, onOpen }: MediaPanelProps) {
  const [items, setItems] = useState<MediaItem[] | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => {
      void window.anemo.getMediaItems(tabId).then((next) => {
        if (alive) setItems(next)
      })
    }
    load()
    const timer = window.setInterval(load, 2500)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [tabId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = (url: string) => {
    void window.anemo.copyText(url)
    setCopied(url)
    window.setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#0b1017] shadow-2xl shadow-black/60">
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
          <Film className="h-4 w-4 text-sky-300" />
          <div className="flex-1">
            <div className="text-[12.5px] font-medium text-slate-100">Media sniffer</div>
            <div className="text-[10px] text-slate-500">
              Streams observed from this tab's network traffic. Passive only.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-white/5 hover:text-slate-200"
            title="Close"
          >
            <X />
          </button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {items === null && (
            <div className="px-3 py-8 text-center text-xs text-slate-500">Scanning network…</div>
          )}
          {items !== null && items.length === 0 && (
            <div className="px-3 py-8 text-center text-xs leading-relaxed text-slate-500">
              No HLS, DASH, video or audio streams detected yet.
              <br />
              Play a video on the page and it will appear here.
            </div>
          )}
          {items?.map((item) => (
            <div
              key={item.url}
              className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.04]"
            >
              <span className="w-12 shrink-0 rounded border border-sky-300/20 bg-sky-300/[0.07] px-1 py-0.5 text-center text-[8px] font-semibold tracking-wider text-sky-200">
                {KIND_LABEL[item.kind]}
              </span>
              <span className="min-w-0 flex-1 break-all text-[10.5px] leading-relaxed text-slate-400">
                {item.url}
              </span>
              <button
                type="button"
                onClick={() => copy(item.url)}
                title="Copy URL"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-white/5 hover:text-slate-200"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onOpen(item.url)}
                title="Open stream in a child tab"
                className="flex h-7 items-center gap-1 rounded-md bg-white/[0.05] px-2 text-[10px] text-slate-300 hover:bg-white/[0.09]"
              >
                <Play className="h-3 w-3" />
                Open
              </button>
              {copied === item.url && (
                <span className="shrink-0 text-[9px] text-emerald-300">copied</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
