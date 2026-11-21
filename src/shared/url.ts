const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'about:'])

export function isAllowedWebUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return ALLOWED_SCHEMES.has(parsed.protocol)
  } catch {
    return false
  }
}

function looksLikeHost(value: string): boolean {
  if (/^localhost(:\d{1,5})?(\/.*)?$/i.test(value)) return true
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?(\/.*)?$/.test(value)) return true
  if (/^\[[0-9a-f:]+\](:\d{1,5})?(\/.*)?$/i.test(value)) return true
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?(\/.*)?$/i.test(
    value,
  )
}

/**
 * Turns omnibox input into a loadable URL. Anything that is not an explicit
 * http(s)/about URL and does not look like a host becomes a search query.
 */
export function toNavigationUrl(input: string, searchTemplate: string): string {
  const raw = input.trim()
  if (!raw) return 'about:blank'

  if (/^https?:\/\//i.test(raw) || /^about:blank$/i.test(raw)) return raw

  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return searchTemplate.replace('{query}', encodeURIComponent(raw))
  }

  if (looksLikeHost(raw)) {
    const isLocal = /^(localhost|127\.|\[::1\])/i.test(raw)
    return `${isLocal ? 'http' : 'https'}://${raw}`
  }

  return searchTemplate.replace('{query}', encodeURIComponent(raw))
}

/** URLs that an embedded page may open in a new tab. */
export function sanitizeTabUrl(value: string): string | null {
  if (!value) return 'about:blank'
  if (/^about:blank$/i.test(value.trim())) return 'about:blank'
  if (!/^https?:\/\//i.test(value.trim())) return null
  return isAllowedWebUrl(value.trim()) ? value.trim() : null
}

export function displayUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'about:') return url
    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function safeTitle(title: string, url: string): string {
  if (url === 'about:blank' || !url) return 'New Tab'
  const trimmed = title.trim()
  if (trimmed && trimmed !== 'about:blank') return trimmed.slice(0, 512)
  return hostOf(url)
}
