import type { AppConfig } from '../../shared/types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface OllamaChunk {
  message?: { content?: string }
  done?: boolean
  error?: string
}

interface OpenAiChunk {
  choices?: Array<{ delta?: { content?: string } }>
}

async function* readLines(body: ReadableStream<Uint8Array> | null): AsyncGenerator<string> {
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) yield line
        newline = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) yield buffer.trim()
  } finally {
    reader.releaseLock()
  }
}

/**
 * Streaming client for local Ollama or any OpenAI-compatible endpoint, plus a
 * fire-and-forget webhook dispatcher. No telemetry: requests only go to the
 * URL the user configured.
 */
export class LocalBridge {
  constructor(private readonly getConfig: () => AppConfig) {}

  async *streamChat(messages: ChatMessage[], signal: AbortSignal): AsyncGenerator<string> {
    const config = this.getConfig().ai
    if (!config.enabled) {
      throw new Error('Local AI is disabled. Set ai.enabled to true in ~/.anemo/config.json.')
    }
    if (!config.baseUrl) throw new Error('No AI endpoint configured (ai.baseUrl).')
    if (!config.model) throw new Error('No AI model configured (ai.model).')

    const base = config.baseUrl.replace(/\/+$/, '')

    if (config.provider === 'ollama') {
      const response = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: config.model, messages, stream: true }),
        signal,
      })
      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}: ${await this.errorText(response)}`)
      }
      for await (const line of readLines(response.body)) {
        const chunk = JSON.parse(line) as OllamaChunk
        if (chunk.error) throw new Error(chunk.error)
        const token = chunk.message?.content
        if (token) yield token
        if (chunk.done) return
      }
      return
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`

    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: config.model, messages, stream: true }),
      signal,
    })
    if (!response.ok) {
      throw new Error(`AI endpoint returned ${response.status}: ${await this.errorText(response)}`)
    }

    for await (const line of readLines(response.body)) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') return
      const chunk = JSON.parse(data) as OpenAiChunk
      const token = chunk.choices?.[0]?.delta?.content
      if (token) yield token
    }
  }

  private async errorText(response: Response): Promise<string> {
    try {
      return (await response.text()).slice(0, 300)
    } catch {
      return response.statusText
    }
  }

  async dispatchWebhook(event: string, payload: Record<string, unknown>): Promise<void> {
    const url = this.getConfig().ai.webhookUrl.trim()
    if (!url) return

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event, timestamp: Date.now(), payload }),
        signal: controller.signal,
      })
    } catch (error) {
      console.warn('[ai] webhook dispatch failed', error)
    } finally {
      clearTimeout(timer)
    }
  }
}
