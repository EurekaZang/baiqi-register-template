/** Content helpers for reasoning blocks and artifacts (P3). */

export type ParsedSegment =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'code'; language: string; code: string }

const REASONING_BLOCK =
  /```(?:reasoning|think|thought|analysis)\s*\n([\s\S]*?)```/gi
const FENCED_CODE = /```([a-zA-Z0-9_+-]*)\s*\n([\s\S]*?)```/g

/** Pull reasoning fenced blocks out of markdown-ish content. */
export function extractReasoning(content: string): {
  reasoning: string[]
  rest: string
} {
  const reasoning: string[] = []
  const rest = content.replace(REASONING_BLOCK, (_m, body: string) => {
    const t = String(body || '').trim()
    if (t) reasoning.push(t)
    return ''
  })
  // Also support <think>...</think> style if present
  const thinkRe = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi
  const rest2 = rest.replace(thinkRe, (_m, body: string) => {
    const t = String(body || '').trim()
    if (t) reasoning.push(t)
    return ''
  })
  return { reasoning, rest: rest2.trim() }
}

export type Artifact = {
  id: string
  language: string
  code: string
  title: string
}

/** Collect fenced code blocks suitable for artifacts panel. */
export function extractArtifacts(
  content: string,
  messageId: string,
): Artifact[] {
  const arts: Artifact[] = []
  let i = 0
  const re = new RegExp(FENCED_CODE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const language = (m[1] || 'text').toLowerCase()
    if (['reasoning', 'think', 'thought', 'analysis'].includes(language)) {
      continue
    }
    const code = (m[2] || '').replace(/\n$/, '')
    if (!code.trim()) continue
    // Prefer non-trivial blocks for the side panel
    if (code.split('\n').length < 2 && code.length < 80) continue
    i += 1
    arts.push({
      id: `${messageId}-a${i}`,
      language: language || 'text',
      code,
      title: language ? `${language} snippet` : `code ${i}`,
    })
  }
  return arts
}

export function groupSessionsByDay<T extends { updated_at?: string; created_at?: string }>(
  sessions: T[],
): { label: string; items: T[] }[] {
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startYesterday = startToday - 86400000
  const startWeek = startToday - 6 * 86400000

  const buckets: Record<string, T[]> = {
    Today: [],
    Yesterday: [],
    'Previous 7 days': [],
    Earlier: [],
  }

  for (const s of sessions) {
    const raw = s.updated_at || s.created_at || ''
    const t = Date.parse(raw)
    if (Number.isNaN(t)) {
      buckets.Earlier.push(s)
    } else if (t >= startToday) {
      buckets.Today.push(s)
    } else if (t >= startYesterday) {
      buckets.Yesterday.push(s)
    } else if (t >= startWeek) {
      buckets['Previous 7 days'].push(s)
    } else {
      buckets.Earlier.push(s)
    }
  }

  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }))
}
