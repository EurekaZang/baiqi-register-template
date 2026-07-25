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
  previewable: boolean
}

function isPreviewable(language: string, code: string): boolean {
  const lang = language.toLowerCase()
  if (['html', 'htm', 'svg'].includes(lang)) return true
  if (['jsx', 'tsx', 'react'].includes(lang)) return true
  // bare HTML document heuristic
  if (lang === 'text' || lang === '') {
    const head = code.slice(0, 200).toLowerCase()
    if (head.includes('<html') || head.includes('<!doctype html') || head.includes('<svg')) {
      return true
    }
  }
  return false
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
      previewable: isPreviewable(language || 'text', code),
    })
  }
  return arts
}

export function buildPreviewHtml(artifact: Artifact): string {
  const lang = artifact.language.toLowerCase()
  const code = artifact.code
  if (['html', 'htm'].includes(lang) || code.trim().toLowerCase().startsWith('<!doctype')) {
    return code
  }
  if (lang === 'svg' || code.trim().startsWith('<svg')) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:16px;background:#fff;}</style></head><body>${code}</body></html>`
  }
  if (['jsx', 'tsx', 'react'].includes(lang)) {
    // Lightweight static preview: show source in a framed document with a note.
    // Avoid executing arbitrary JS for safety.
    const escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#f5f5f5;color:#111}
    .banner{padding:10px 14px;background:#e8e8e8;border-bottom:1px solid #c7c7c7;font-size:12px;color:#333}
    pre{margin:0;padding:16px;overflow:auto;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre}
  </style>
</head>
<body>
  <div class="banner">React/JSX preview is sandboxed as source view (no runtime eval).</div>
  <pre>${escaped}</pre>
</body>
</html>`
  }
  const escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#111;color:#e8e8e8;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace}pre{margin:0;padding:16px;white-space:pre-wrap}</style></head><body><pre>${escaped}</pre></body></html>`
}

export function groupSessionsByDay<T extends { updated_at?: string; created_at?: string; pinned?: boolean }>(
  sessions: T[],
): { label: string; items: T[] }[] {
  const pinned = sessions.filter((s) => !!s.pinned)
  const rest = sessions.filter((s) => !s.pinned)

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

  for (const s of rest) {
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

  const groups: { label: string; items: T[] }[] = []
  if (pinned.length) groups.push({ label: 'Pinned', items: pinned })
  for (const [label, items] of Object.entries(buckets)) {
    if (items.length) groups.push({ label, items })
  }
  return groups
}
