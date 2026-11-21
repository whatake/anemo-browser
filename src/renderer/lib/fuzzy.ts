/**
 * Tiny subsequence scorer for the command palette. Returns null when the query
 * does not match, otherwise a higher score for earlier, tighter matches.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const needle = query.trim().toLowerCase()
  if (!needle) return 0

  const haystack = target.toLowerCase()
  let score = 0
  let cursor = 0
  let streak = 0

  for (let index = 0; index < needle.length; index += 1) {
    const character = needle[index]
    if (!character) continue

    let found = -1
    for (let scan = cursor; scan < haystack.length; scan += 1) {
      if (haystack[scan] === character) {
        found = scan
        break
      }
    }
    if (found === -1) return null

    score += 12 - Math.min(8, found - cursor)
    if (found === cursor) {
      streak += 1
      score += 4 + streak * 2
    } else {
      streak = 0
    }

    const before = haystack[found - 1] ?? ''
    if (found === 0 || /[\s\-_/.:]/.test(before)) score += 8
    cursor = found + 1
  }

  return score - Math.min(20, Math.floor(haystack.length / 14))
}

export function bestScore(query: string, values: string[]): number | null {
  let best: number | null = null
  for (const value of values) {
    const score = fuzzyScore(query, value)
    if (score === null) continue
    if (best === null || score > best) best = score
  }
  return best
}
