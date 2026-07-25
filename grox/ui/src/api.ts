/** API client for Grox desktop agent. Base path respects Vite `base` (`/`). */

const TOKEN_KEY = 'chat_token'
/** Upstream grokcli-2api account session (Bearer for LLM / /v1/me). */
export const SESSION_TOKEN_KEY = 'grox_session_token'
export const BASE_URL_KEY = 'grox_base_url'
export const DEFAULT_GROK_BASE_URL = 'https://kaggleyes.top/grokapi'

export type GroxBridge = {
  /** Origin string, e.g. http://127.0.0.1:17890 — NOT a function. */
  apiBase?: string
  /** Local chat token string, or async getter for older bridges. */
  token?: string | (() => Promise<string | null | undefined>)
  /** Desktop-created workspace used when the user has not selected a cwd yet. */
  defaultCwd?: string
  selectFolder?: () => Promise<string | null>
  openDataDir?: () => void | Promise<void>
  getVersion?: () => Promise<string>
  windowControls?: {
    minimize: () => void
    toggleMaximize: () => Promise<boolean>
    close: () => void
    isMaximized: () => Promise<boolean>
    onMaximizedChange: (callback: (maximized: boolean) => void) => () => void
  }
}

export function getGroxBridge(): GroxBridge | undefined {
  return (window as unknown as { grox?: GroxBridge }).grox
}

/** Return the desktop workspace fallback without overriding a user-selected cwd. */
export function getDefaultCwd(): string {
  const cwd = getGroxBridge()?.defaultCwd
  return typeof cwd === 'string' ? cwd.trim() : ''
}

/** API root: Electron may inject `window.grox.apiBase`; else Vite BASE_URL + `api`. */
export function apiBase(): string {
  const w = getGroxBridge()
  if (w?.apiBase && typeof w.apiBase === 'string') {
    return w.apiBase.replace(/\/?$/, '') + '/api'
  }
  const base = import.meta.env.BASE_URL || '/'
  return `${base.replace(/\/?$/, '/')}api`
}

/** Public grokcli-2api base used for account login and /v1/me. */
export function getGrokBaseUrl(): string {
  try {
    const stored = (localStorage.getItem(BASE_URL_KEY) || '').trim().replace(/\/+$/, '')
    if (stored) return stored
  } catch {
    /* ignore */
  }
  return DEFAULT_GROK_BASE_URL
}

export function setGrokBaseUrl(url: string): void {
  const clean = url.trim().replace(/\/+$/, '') || DEFAULT_GROK_BASE_URL
  try {
    localStorage.setItem(BASE_URL_KEY, clean)
  } catch {
    /* ignore */
  }
}

let memoryToken: string | null = null
let memorySessionToken: string | null = null

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

export function getSessionToken(): string | null {
  if (memorySessionToken) return memorySessionToken
  try {
    const fromStorage = localStorage.getItem(SESSION_TOKEN_KEY)
    if (fromStorage) {
      memorySessionToken = fromStorage
      return fromStorage
    }
  } catch {
    /* ignore */
  }
  return null
}

export function setSessionToken(token: string | null): void {
  memorySessionToken = token
  try {
    if (token) localStorage.setItem(SESSION_TOKEN_KEY, token)
    else localStorage.removeItem(SESSION_TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

export function clearSessionToken(): void {
  setSessionToken(null)
}

export function hasAccountSession(): boolean {
  return Boolean((getSessionToken() || '').trim())
}

/**
 * Desktop: pull local loopback token from Electron preload bridge.
 * `window.grox.apiBase` is a plain string origin (not a function).
 * `window.grox.token` is preferably a string; async getter still supported.
 */
export async function initDesktopAuth(): Promise<void> {
  const g = getGroxBridge()
  if (!g) return
  let token: string | null | undefined
  if (typeof g.token === 'function') {
    try {
      token = await g.token()
    } catch {
      return
    }
  } else if (typeof g.token === 'string') {
    token = g.token
  }
  if (token) setToken(token)
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

export type ContextUsageCategory = {
  name: string
  tokens: number
  color?: string
  is_deferred?: boolean
}

export type ContextUsage = {
  total_tokens: number
  max_tokens: number
  raw_max_tokens?: number
  percentage: number
  model?: string | null
  categories?: ContextUsageCategory[]
  auto_compact?: boolean
  auto_compact_threshold?: number
  updated_at?: string
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
  context_usage?: ContextUsage | null
  last_usage?: Record<string, unknown> | null
  last_cost_usd?: number | null
}

export type SubAgentStatus = 'running' | 'done' | 'error' | string

export type SubAgent = {
  id: string
  name: string
  agent_type?: string
  parent_tool_use_id?: string
  status: SubAgentStatus
  text?: string
  tools?: ToolCard[]
  summary?: string
}

export type ToolCard = {
  id: string
  name: string
  input_summary?: string
  output_summary?: string
  ok?: boolean
  subagent?: SubAgent
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

export type PathAttachment = {
  type?: 'path' | string
  path: string
  name?: string
  kind?: 'image' | 'text' | 'file' | string
  mime?: string
  size?: number
}

export type MessageMeta = {
  kind?: 'image_prompt' | 'image' | string
  model?: string
  urls?: string[]
}

export type Message = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  tools?: ToolCard[]
  created_at?: string
  /** compact_boundary | compact_summary | undefined */
  kind?: string
  attachments?: PathAttachment[]
  meta?: MessageMeta
}

export type ImageGenResponse = {
  user_message: Message
  assistant_message: Message
  session: {
    id: string
    updated_at?: string
    status?: string
    title?: string
  }
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
    // Probe auth via sessions; also hit login for cookie (path=/)
    try {
      await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ token }),
      })
    } catch {
      // Cookie login optional; bearer still works
    }
    await apiFetch<SessionSummary[]>('/sessions')
  } catch (err) {
    setToken(previous)
    throw err
  }
}

export type RuntimeConfig = {
  base_url: string
  api_key_set: boolean
  default_model: string
}

export type RuntimeConfigUpdate = {
  base_url?: string
  api_key?: string
  default_model?: string
}

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  return apiFetch<RuntimeConfig>('/runtime-config')
}

export async function putRuntimeConfig(
  body: RuntimeConfigUpdate,
): Promise<RuntimeConfig> {
  return apiFetch<RuntimeConfig>('/runtime-config', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

// ── Account login (grokcli-2api) ────────────────────────────────────────────

export type AccountUser = {
  id: string
  username: string
  display_name?: string
  tier?: string
  tier_expires_at?: number | null
  status?: string
  created_at?: number
  updated_at?: number
}

export type AccountLoginResponse = {
  session_token: string
  expires_at?: number
  user: AccountUser
}

export type MeUsage = {
  used: number
  limit: number
  period?: string
  requests?: number
}

export type MeLimits = {
  monthly_token_limit?: number
  max_tokens_per_request?: number
  rpm?: number
  concurrent?: number
  models_allow?: string[]
  agent?: boolean
  web_search?: boolean
}

export type MeResponse = {
  user: AccountUser
  tier: string
  effective_tier: string
  expires_at?: number | null
  usage: MeUsage
  limits?: MeLimits
}

async function grokFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  opts?: { bearer?: string | null },
): Promise<T> {
  const base = getGrokBaseUrl().replace(/\/+$/, '')
  const url = path.startsWith('http')
    ? path
    : `${base}${path.startsWith('/') ? path : `/${path}`}`
  const headers = new Headers(init.headers)
  const bearer = opts?.bearer
  if (bearer) headers.set('Authorization', `Bearer ${bearer}`)
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

/**
 * Username/password login against grokcli-2api.
 * Stores session_token and pushes it into the local agent runtime as ANTHROPIC_API_KEY.
 */
export async function loginAccount(
  username: string,
  password: string,
  baseUrl?: string,
): Promise<AccountLoginResponse> {
  const url = (baseUrl || getGrokBaseUrl()).trim().replace(/\/+$/, '')
  if (!url) throw new Error('Base URL is required')
  setGrokBaseUrl(url)

  const res = await fetch(`${url}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.trim(), password }),
  })
  if (!res.ok) throw await parseError(res)
  const body = (await res.json()) as AccountLoginResponse
  if (!body?.session_token) {
    throw new Error('Login response missing session_token')
  }
  setSessionToken(body.session_token)

  // Wire session into local agent so Claude SDK / models use Bearer session.
  try {
    await putRuntimeConfig({
      base_url: url,
      api_key: body.session_token,
      default_model: 'grok-4.5',
    })
  } catch (err) {
    // A desktop login is not usable unless the local agent receives the same
    // account session. Browser-only UI development has no preload bridge.
    if (getGroxBridge()) {
      clearSessionToken()
      throw err
    }
  }

  // Drop legacy key onboarding markers; account session is the gate now.
  try {
    localStorage.removeItem('grox_api_key')
    localStorage.setItem('grox_onboarded', '1')
  } catch {
    /* ignore */
  }
  return body
}

export async function fetchMe(
  sessionToken?: string | null,
): Promise<MeResponse> {
  const token = (sessionToken ?? getSessionToken() ?? '').trim()
  if (!token) throw new ApiError(401, 'Not signed in')
  return grokFetch<MeResponse>('/v1/me', { method: 'GET' }, { bearer: token })
}

export async function logoutAccount(): Promise<void> {
  const token = getSessionToken()
  if (token) {
    try {
      await grokFetch(
        '/v1/auth/logout',
        { method: 'POST' },
        { bearer: token },
      )
    } catch {
      /* best-effort revoke */
    }
  }
  clearSessionToken()
  try {
    localStorage.removeItem('grox_api_key')
    localStorage.removeItem('grox_onboarded')
  } catch {
    /* ignore */
  }
  // Clear agent key so a stale session is not reused.
  try {
    await putRuntimeConfig({ api_key: '' })
  } catch {
    /* agent may be offline */
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

/** Composer Image mode — generate via grok2api lite (JSON, not SSE). */
export async function generateSessionImage(
  sessionId: string,
  prompt: string,
  n = 1,
): Promise<ImageGenResponse> {
  return apiFetch<ImageGenResponse>(`/sessions/${sessionId}/images`, {
    method: 'POST',
    body: JSON.stringify({ prompt, n }),
  })
}

/** Run Claude Code /compact on the session's SDK conversation. */
export async function compactSession(id: string): Promise<SessionSummary> {
  return apiFetch<SessionSummary>(`/sessions/${id}/compact`, { method: 'POST' })
}

export type SseHandler = (event: string, data: Record<string, unknown>) => void

export async function resolveSessionPath(
  sessionId: string,
  path: string,
): Promise<PathAttachment> {
  return apiFetch<PathAttachment>(`/sessions/${sessionId}/attachments/resolve`, {
    method: 'POST',
    body: JSON.stringify({ path }),
  })
}

/** Upload a dragged/selected browser file into session cwd .chat-attachments/. */
export async function uploadSessionFile(
  sessionId: string,
  file: File,
): Promise<PathAttachment> {
  const url = `${apiBase()}/sessions/${sessionId}/attachments/upload`
  const headers = authHeaders()
  // Let the browser set multipart boundary — do not force JSON content-type.
  headers.delete('Content-Type')
  const form = new FormData()
  form.append('file', file, file.name)
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: form,
  })
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as PathAttachment
}

/**
 * POST messages and parse SSE via fetch ReadableStream (Bearer auth).
 * Returns AbortController for cancel; also call stopSession for server interrupt.
 */
export async function streamMessage(
  sessionId: string,
  content: string,
  onEvent: SseHandler,
  signal?: AbortSignal,
  attachments?: PathAttachment[],
): Promise<void> {
  const url = `${apiBase()}/sessions/${sessionId}/messages`
  const headers = authHeaders({
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  })
  const body: Record<string, unknown> = { content }
  if (attachments && attachments.length > 0) {
    body.attachments = attachments.map((a) => ({
      type: 'path',
      path: a.path,
    }))
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
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
