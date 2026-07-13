/** API client for chat-service. Base path respects Vite `base` (/chat/). */

const TOKEN_KEY = 'chat_token'

/** API root: with base `/chat/` → `/chat/api` (works behind 8090 proxy). */
export function apiBase(): string {
  const base = import.meta.env.BASE_URL || '/'
  // BASE_URL is like `/chat/` — join to `/chat/api`
  return `${base.replace(/\/?$/, '/') }api`
}

let memoryToken: string | null = null

export function getToken(): string | null {
  if (memoryToken) return memoryToken
  try {
    const fromStorage = localStorage.getItem(TOKEN_KEY)
    if (fromStorage) {
      memoryToken = fromStorage
      return fromStorage
    }
  } catch {
    /* ignore */
  }
  return null
}

export function setToken(token: string | null): void {
  memoryToken = token
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

export function clearToken(): void {
  setToken(null)
}

function authHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (!headers.has('Content-Type') && !(extra instanceof Headers && extra.has('Content-Type'))) {
    // only set default later for JSON bodies
  }
  return headers
}

export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let detail: unknown
  let message = res.statusText || `HTTP ${res.status}`
  try {
    const body = await res.json()
    detail = body
    if (typeof body?.detail === 'string') message = body.detail
    else if (Array.isArray(body?.detail)) message = JSON.stringify(body.detail)
    else if (body?.error) message = String(body.error)
  } catch {
    /* ignore */
  }
  return new ApiError(res.status, message, detail)
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith('http') ? path : `${apiBase()}${path.startsWith('/') ? path : `/${path}`}`
  const headers = authHeaders(init.headers)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(url, { ...init, headers })
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

export type SessionSummary = {
  id: string
  title: string
  cwd: string
  model: string
  sdk_session_id?: string | null
  created_at: string
  updated_at: string
  status: string
  pinned?: boolean
  messages?: Message[]
  tasks?: AgentTask[]
}

export type ToolCard = {
  id: string
  name: string
  input_summary?: string
  output_summary?: string
  ok?: boolean
}

export type AgentTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'deleted'
  | string

export type AgentTask = {
  id: string
  subject?: string
  description?: string | null
  activeForm?: string | null
  status?: AgentTaskStatus
  metadata?: Record<string, unknown> | null
  created_at?: string
  updated_at?: string
  source_tool_use_id?: string
  provisional?: boolean
}

export type Message = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  tools?: ToolCard[]
  created_at?: string
}

export type ModelItem = {
  id: string
  display_name: string
}

export type ModelsResponse = {
  object: string
  data: ModelItem[]
  default: string
  stale: boolean
}

export async function login(token: string): Promise<void> {
  const previous = getToken()
  setToken(token)
  try {
    // Probe auth via sessions; also hit login for cookie (optional path=/chat)
    try {
      await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ token }),
      })
    } catch {
      // Cookie login may fail on direct 8091 without /chat path; bearer still works
    }
    await apiFetch<SessionSummary[]>('/sessions')
  } catch (err) {
    setToken(previous)
    throw err
  }
}

export async function listSessions(): Promise<SessionSummary[]> {
  return apiFetch<SessionSummary[]>('/sessions')
}

export async function getSession(id: string): Promise<SessionSummary> {
  return apiFetch<SessionSummary>(`/sessions/${id}`)
}

export async function createSession(body: {
  cwd: string
  title?: string
  model?: string
}): Promise<SessionSummary> {
  return apiFetch<SessionSummary>('/sessions', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function deleteSession(id: string): Promise<void> {
  await apiFetch(`/sessions/${id}`, { method: 'DELETE' })
}

export async function patchSession(
  id: string,
  body: { title?: string; cwd?: string; model?: string; pinned?: boolean },
): Promise<SessionSummary> {
  return apiFetch<SessionSummary>(`/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export async function listModels(): Promise<ModelsResponse> {
  return apiFetch<ModelsResponse>('/models')
}

export async function recentCwds(): Promise<string[]> {
  return apiFetch<string[]>('/cwd/recent')
}

export async function stopSession(id: string): Promise<void> {
  await apiFetch(`/sessions/${id}/stop`, { method: 'POST' })
}

export type SseHandler = (event: string, data: Record<string, unknown>) => void

/**
 * POST messages and parse SSE via fetch ReadableStream (Bearer auth).
 * Returns AbortController for cancel; also call stopSession for server interrupt.
 */
export async function streamMessage(
  sessionId: string,
  content: string,
  onEvent: SseHandler,
  signal?: AbortSignal,
): Promise<void> {
  const url = `${apiBase()}/sessions/${sessionId}/messages`
  const headers = authHeaders({
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  })
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ content }),
    signal,
  })
  if (!res.ok) throw await parseError(res)
  if (!res.body) throw new Error('No response body for SSE stream')

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let eventName = 'message'
  let dataLines: string[] = []

  const flush = () => {
    if (dataLines.length === 0 && !eventName) {
      eventName = 'message'
      return
    }
    const raw = dataLines.join('\n')
    dataLines = []
    const name = eventName || 'message'
    eventName = 'message'
    if (!raw) return
    let data: Record<string, unknown> = {}
    try {
      data = JSON.parse(raw) as Record<string, unknown>
    } catch {
      data = { raw }
    }
    onEvent(name, data)
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      let line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (line === '') {
        flush()
        continue
      }
      if (line.startsWith(':')) continue // comment / ping
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim()
        continue
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
        continue
      }
    }
  }
  if (buffer.trim()) {
    // trailing incomplete — ignore
  }
  flush()
}
