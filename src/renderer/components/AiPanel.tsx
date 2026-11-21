import { useEffect, useRef, useState } from 'react'
import type { AppConfig, TabSnapshot } from '../../shared/types'
import { isAllowedWebUrl } from '../../shared/url'
import { Sparkles, X } from './Icons'

interface AiPanelProps {
  config: AppConfig | null
  activeTab: TabSnapshot | null
  onClose: () => void
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const QUICK_PROMPTS = [
  'Summarize this page',
  'What is this page about?',
  'Extract the key facts and links',
]

export function AiPanel({ config, activeTab, onClose }: AiPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [includePage, setIncludePage] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeRequest = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const canUsePage = Boolean(activeTab && isAllowedWebUrl(activeTab.url))
  const ai = config?.ai

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const unsubscribe = window.anemo.onAiEvent((event) => {
      if (event.requestId !== activeRequest.current) return

      if (event.type === 'token') {
        setMessages((previous) => {
          const next = [...previous]
          const last = next[next.length - 1]
          if (last && last.role === 'assistant') {
            next[next.length - 1] = { role: 'assistant', content: last.content + event.text }
          }
          return next
        })
      } else if (event.type === 'done') {
        setPending(false)
        activeRequest.current = null
      } else {
        setError(event.message)
        setPending(false)
        activeRequest.current = null
      }
    })

    return () => {
      unsubscribe()
      if (activeRequest.current) {
        window.anemo.cancelAi(activeRequest.current)
        activeRequest.current = null
      }
    }
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages, pending])

  const stop = () => {
    if (activeRequest.current) {
      window.anemo.cancelAi(activeRequest.current)
      activeRequest.current = null
    }
    setPending(false)
  }

  const send = async (override?: string) => {
    const prompt = (override ?? input).trim()
    if (!prompt || pending) return

    setInput('')
    setError(null)
    setPending(true)
    setMessages((previous) => [
      ...previous,
      { role: 'user', content: prompt },
      { role: 'assistant', content: '' },
    ])

    try {
      const requestId = await window.anemo.askAi({
        prompt,
        includePage: includePage && canUsePage,
      })
      activeRequest.current = requestId
    } catch (cause) {
      setPending(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="flex h-full w-full max-w-[440px] flex-col border-l border-white/10 bg-[#0b1017] shadow-2xl shadow-black/60"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-300/10 text-sky-200">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <div className="text-[12.5px] font-medium text-slate-100">Local AI</div>
            <div className="text-[10px] text-slate-500">
              {ai ? `${ai.provider} · ${ai.model}` : 'Reading configuration…'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-white/5 hover:text-slate-200"
            title="Close AI panel"
          >
            <X />
          </button>
        </div>

        {ai && !ai.enabled && (
          <div className="mx-3 mt-3 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-[10.5px] leading-relaxed text-amber-200/90">
            Local AI is disabled. Set <span className="font-mono">ai.enabled</span> to true in{' '}
            <span className="font-mono">~/.anemo/config.json</span>.
          </div>
        )}

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {messages.length === 0 && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="text-[12px] leading-relaxed text-slate-300">
                Ask about the page you are reading. Requests go only to your configured local
                endpoint — nothing is sent to Anemo.
              </p>
              <div className="mt-3 flex flex-col gap-1.5">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void send(prompt)}
                    disabled={pending}
                    className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5 text-left text-[11px] text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-200 disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => {
            const isLast = index === messages.length - 1
            const empty = message.role === 'assistant' && message.content.length === 0
            if (empty && !(isLast && pending)) return null
            return (
              <div
                key={`${message.role}-${index}`}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[92%] whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-[11.5px] leading-relaxed ${
                    message.role === 'user'
                      ? 'bg-sky-300/[0.10] text-slate-100 ring-1 ring-inset ring-sky-300/20'
                      : 'bg-white/[0.04] text-slate-300'
                  }`}
                >
                  {empty && isLast && pending ? (
                    <span className="inline-flex gap-1 py-1">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:300ms]" />
                    </span>
                  ) : (
                    message.content
                  )}
                </div>
              </div>
            )
          })}

          {error && (
            <div className="rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-[10.5px] leading-relaxed text-rose-200/90">
              {error}
            </div>
          )}
        </div>

        <div className="border-t border-white/[0.06] p-3">
          <label className="mb-2 flex items-center gap-2 text-[10px] text-slate-500">
            <input
              type="checkbox"
              checked={includePage && canUsePage}
              onChange={(event) => setIncludePage(event.target.checked)}
              disabled={!canUsePage}
              className="h-3 w-3 accent-sky-300"
            />
            Include current page content
            {!canUsePage && <span className="text-slate-600">(open a web page first)</span>}
          </label>

          <div className="flex items-end gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 focus-within:border-sky-300/30">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  onClose()
                } else if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
              }}
              rows={2}
              placeholder="Ask about this page…"
              spellCheck={false}
              className="max-h-32 min-h-[38px] flex-1 resize-none bg-transparent text-[11.5px] leading-relaxed text-slate-200 outline-none placeholder:text-slate-600"
            />
            {pending ? (
              <button
                type="button"
                onClick={stop}
                className="rounded-lg bg-white/[0.08] px-2.5 py-1.5 text-[10px] text-slate-300 hover:bg-white/[0.12]"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void send()}
                disabled={!input.trim()}
                className="rounded-lg bg-sky-300/90 px-2.5 py-1.5 text-[10px] font-medium text-[#06202b] transition hover:bg-sky-200 disabled:opacity-40"
              >
                Send
              </button>
            )}
          </div>

          <p className="mt-2 text-[9px] leading-relaxed text-slate-600">
            Enter sends · Shift+Enter adds a line. Configure endpoint in ~/.anemo/config.json.
          </p>
        </div>
      </div>
    </div>
  )
}
