import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiError,
  createSession,
  getSession,
  patchSession,
  stopSession,
  streamMessage,
  type Message,
  type SessionSummary,
  type ToolCard,
} from '../api'
import { extractArtifacts, type Artifact } from '../lib/content'
import { ArtifactsPanel } from './ArtifactsPanel'
import { Composer } from './Composer'
import { CwdPicker } from './CwdPicker'
import { MessageList, type StreamState } from './MessageList'
import { ModelSelect } from './ModelSelect'

type Props = {
  sessionId: string | null
  draftMode: boolean
  onSessionCreated: (session: SessionSummary) => void
  onSessionUpdated: (session: SessionSummary) => void
  defaultModel?: string
}

export function ChatView({
  sessionId,
  draftMode,
  onSessionCreated,
  onSessionUpdated,
  defaultModel = 'grok-4.5',
}: Props) {
  const [session, setSession] = useState<SessionSummary | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [cwd, setCwd] = useState('')
  const [model, setModel] = useState(defaultModel)
  const [streaming, setStreaming] = useState<StreamState>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [seedText, setSeedText] = useState<string | undefined>(undefined)
  const [artifactsOpen, setArtifactsOpen] = useState(false)
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const loadedIdRef = useRef<string | null>(null)
  const activeIdRef = useRef<string | null>(null)

  const isStreaming = !!streaming?.active

  useEffect(() => {
    if (draftMode || !sessionId) {
      loadedIdRef.current = null
      activeIdRef.current = null
      setSession(null)
      setMessages([])
      setCwd('')
      setModel(defaultModel)
      setStreaming(null)
      setError(null)
      setArtifactsOpen(false)
      setActiveArtifactId(null)
      return
    }
    if (loadedIdRef.current === sessionId) {
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    getSession(sessionId)
      .then((s) => {
        if (cancelled) return
        loadedIdRef.current = s.id
        activeIdRef.current = s.id
        setSession(s)
        setMessages(s.messages || [])
        setCwd(s.cwd || '')
        setModel(s.model || defaultModel)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, draftMode, defaultModel])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streaming])

  const artifacts = useMemo(() => {
    const all: Artifact[] = []
    for (const m of messages) {
      if (m.role !== 'assistant') continue
      all.push(...extractArtifacts(m.content || '', m.id))
    }
    if (streaming?.text) {
      all.push(...extractArtifacts(streaming.text, 'streaming'))
    }
    return all
  }, [messages, streaming])

  const applyModelCwd = useCallback(
    async (next: { model?: string; cwd?: string }) => {
      if (!sessionId || draftMode) return
      try {
        const updated = await patchSession(sessionId, next)
        setSession(updated)
        onSessionUpdated(updated)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Update failed')
      }
    },
    [sessionId, draftMode, onSessionUpdated],
  )

  async function handleSend(text: string) {
    setError(null)
    let activeId = sessionId || activeIdRef.current

    try {
      if (draftMode || !activeId) {
        if (!cwd.trim()) {
          setError('Working directory (cwd) is required')
          return
        }
        const created = await createSession({
          cwd: cwd.trim(),
          model: model || defaultModel,
        })
        activeId = created.id
        activeIdRef.current = created.id
        loadedIdRef.current = created.id
        setSession(created)
        setMessages(created.messages || [])
        onSessionCreated(created)
      } else {
        activeIdRef.current = activeId
      }

      const userMsg: Message = {
        id: `local-${Date.now()}`,
        role: 'user',
        content: text,
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, userMsg])
      setStreaming({ text: '', tools: [], active: true })

      const ac = new AbortController()
      abortRef.current = ac
      const toolsMap = new Map<string, ToolCard>()

      await streamMessage(
        activeId!,
        text,
        (event, data) => {
          if (event === 'text_delta') {
            const chunk = String(data.text ?? '')
            setStreaming((prev) =>
              prev
                ? { ...prev, text: prev.text + chunk, active: true }
                : { text: chunk, tools: [], active: true },
            )
          } else if (event === 'tool_start') {
            const card: ToolCard = {
              id: String(data.id ?? crypto.randomUUID()),
              name: String(data.name ?? 'tool'),
              input_summary: data.input_summary
                ? String(data.input_summary)
                : '',
              output_summary: '',
              ok: true,
            }
            toolsMap.set(card.id, card)
            setStreaming((prev) => ({
              text: prev?.text || '',
              tools: Array.from(toolsMap.values()),
              active: true,
            }))
          } else if (event === 'tool_end') {
            const id = String(data.id ?? '')
            const existing = toolsMap.get(id) || {
              id,
              name: String(data.name ?? 'tool'),
              input_summary: '',
            }
            existing.output_summary = data.output_summary
              ? String(data.output_summary)
              : existing.output_summary
            existing.ok = data.ok !== false
            if (data.name) existing.name = String(data.name)
            toolsMap.set(id, existing)
            setStreaming((prev) => ({
              text: prev?.text || '',
              tools: Array.from(toolsMap.values()),
              active: true,
            }))
          } else if (event === 'error') {
            setError(String(data.message ?? 'Agent error'))
          }
        },
        ac.signal,
      )

      const fresh = await getSession(activeId!)
      setSession(fresh)
      setMessages(fresh.messages || [])
      onSessionUpdated(fresh)
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Send failed'
        setError(msg)
      }
      if (activeId) {
        try {
          const fresh = await getSession(activeId)
          setSession(fresh)
          setMessages(fresh.messages || [])
          onSessionUpdated(fresh)
        } catch {
          /* ignore */
        }
      }
    } finally {
      setStreaming(null)
      abortRef.current = null
    }
  }

  async function handleStop() {
    abortRef.current?.abort()
    const id = sessionId || activeIdRef.current || session?.id || null
    if (id) {
      try {
        await stopSession(id)
      } catch {
        /* ignore */
      }
    }
    setStreaming((prev) => (prev ? { ...prev, active: false } : null))
  }

  function handleSuggestion(text: string) {
    if (!cwd.trim() && (draftMode || !sessionId)) {
      setError('Working directory (cwd) is required')
      return
    }
    setSeedText(text)
  }

  function handleOpenArtifact(a: Artifact) {
    setActiveArtifactId(a.id)
    setArtifactsOpen(true)
  }

  const headerCwd = draftMode ? cwd : session?.cwd || cwd
  const headerModel = draftMode ? model : session?.model || model
  const running = isStreaming || session?.status === 'running'
  const title =
    session?.title && session.title !== 'New chat'
      ? session.title
      : draftMode
        ? 'New chat'
        : session?.title || 'Chat'

  return (
    <section className={`chat-view ${artifactsOpen ? 'with-artifacts' : ''}`}>
      <div className="chat-main-col">
        <header className="chat-header">
          <div className="header-identity">
            <div className="header-title-row">
              <h1 className="chat-title">{title}</h1>
              <span
                className="badge full-auto"
                title="permission_mode=bypassPermissions"
              >
                Full auto
              </span>
              {running ? (
                <span className="badge running">
                  <span className="pulse-dot" />
                  Running
                </span>
              ) : null}
            </div>
            <div className="header-controls">
              <CwdPicker
                value={headerCwd}
                onChange={(v) => {
                  setCwd(v)
                  if (!draftMode && sessionId) void applyModelCwd({ cwd: v })
                }}
                disabled={running}
              />
              <ModelSelect
                value={headerModel}
                onChange={(v) => {
                  setModel(v)
                  if (!draftMode && sessionId) void applyModelCwd({ model: v })
                }}
                disabled={running}
                compact
              />
            </div>
          </div>
          <div className="header-right">
            <button
              type="button"
              className={`btn ghost ${artifactsOpen ? 'active-toggle' : ''}`}
              onClick={() => setArtifactsOpen((v) => !v)}
              title="Toggle artifacts panel"
            >
              Artifacts{artifacts.length ? ` (${artifacts.length})` : ''}
            </button>
          </div>
        </header>

        {error && <div className="error-banner">{error}</div>}

        <div className="chat-scroll" ref={listRef}>
          {loading ? (
            <div className="muted pad-sm">Loading…</div>
          ) : (
            <MessageList
              messages={messages}
              streaming={streaming}
              onSuggestion={
                isStreaming || loading ? undefined : handleSuggestion
              }
              onRetry={
                isStreaming || loading
                  ? undefined
                  : (userText) => void handleSend(userText)
              }
              onOpenArtifact={handleOpenArtifact}
            />
          )}
        </div>

        <Composer
          disabled={loading || (draftMode && !cwd.trim())}
          streaming={isStreaming}
          onSend={handleSend}
          onStop={() => void handleStop()}
          seedText={seedText}
          onSeedConsumed={() => setSeedText(undefined)}
          hint={
            draftMode && !cwd.trim()
              ? 'Set an absolute cwd above before starting.'
              : running
                ? 'Agent is running in Full auto mode.'
                : undefined
          }
          placeholder={
            draftMode
              ? cwd.trim()
                ? 'Describe a coding task…'
                : 'Set cwd above, then message…'
              : 'Message the agent…'
          }
        />
      </div>

      <ArtifactsPanel
        artifacts={artifacts}
        open={artifactsOpen}
        onClose={() => setArtifactsOpen(false)}
        activeId={activeArtifactId}
        onSelect={setActiveArtifactId}
      />
    </section>
  )
}
