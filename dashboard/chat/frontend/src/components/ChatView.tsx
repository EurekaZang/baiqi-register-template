import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiError,
  createSession,
  getSession,
  patchSession,
  stopSession,
  streamMessage,
  type AgentTask,
  type Message,
  type SessionSummary,
  type ToolCard,
} from '../api'
import { Boxes } from 'lucide-react'
import { extractArtifacts, type Artifact } from '../lib/content'
import { ArtifactsPanel } from './ArtifactsPanel'
import { Composer } from './Composer'
import { CwdPicker } from './CwdPicker'
import { MessageList, type StreamState } from './MessageList'
import { ModelSelect } from './ModelSelect'
import { TasksPanel } from './TasksPanel'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Tooltip } from './ui/tooltip'

function upsertTask(list: AgentTask[], task: AgentTask): AgentTask[] {
  const id = String(task.id)
  const idx = list.findIndex((t) => String(t.id) === id)
  // Also replace provisional tmp:* with same source tool if final id arrives.
  const byTool = task.source_tool_use_id
    ? list.findIndex(
        (t) =>
          t.source_tool_use_id === task.source_tool_use_id &&
          String(t.id) !== id,
      )
    : -1
  let next = [...list]
  if (byTool >= 0 && idx < 0) {
    next.splice(byTool, 1, task)
  } else if (idx >= 0) {
    next[idx] = { ...next[idx], ...task }
  } else {
    next.push(task)
  }
  // Keep active work near top: in_progress, pending, completed, deleted
  const rank = (s?: string) => {
    switch ((s || 'pending').toLowerCase()) {
      case 'in_progress':
        return 0
      case 'pending':
        return 1
      case 'completed':
        return 2
      case 'deleted':
        return 3
      default:
        return 4
    }
  }
  next.sort((a, b) => {
    const r = rank(a.status) - rank(b.status)
    if (r !== 0) return r
    return String(a.id).localeCompare(String(b.id), undefined, { numeric: true })
  })
  return next
}

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
  const [tasks, setTasks] = useState<AgentTask[]>([])
  const [cwd, setCwd] = useState(() => {
    try {
      return localStorage.getItem('chat_last_cwd') || ''
    } catch {
      return ''
    }
  })
  const [model, setModel] = useState(defaultModel)
  const [streaming, setStreaming] = useState<StreamState>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [seedText, setSeedText] = useState<string | undefined>(undefined)
  const [artifactsOpen, setArtifactsOpen] = useState(false)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const loadedIdRef = useRef<string | null>(null)
  const activeIdRef = useRef<string | null>(null)
  /** Session currently shown in the main pane (null = draft). */
  const viewSessionIdRef = useRef<string | null>(null)
  /** Session that owns the in-flight SSE stream (may differ from view). */
  const streamSessionIdRef = useRef<string | null>(null)
  /** Live stream snapshots so switching away/back can rehydrate partial UI. */
  const streamBuffersRef = useRef<
    Map<string, { text: string; tools: ToolCard[]; tasks?: AgentTask[] }>
  >(new Map())

  const isStreaming =
    !!streaming?.active &&
    !!sessionId &&
    streamSessionIdRef.current === sessionId

  // Keep view ownership ref in sync for async stream callbacks.
  viewSessionIdRef.current = draftMode ? null : sessionId

  useEffect(() => {
    if (draftMode || !sessionId) {
      loadedIdRef.current = null
      activeIdRef.current = null
      setSession(null)
      setMessages([])
      setTasks([])
      // Restore last cwd for new draft instead of wiping it.
      try {
        setCwd(localStorage.getItem('chat_last_cwd') || '')
      } catch {
        setCwd('')
      }
      setModel(defaultModel)
      // Detach UI from any background stream; do not abort the agent turn.
      setStreaming(null)
      setError(null)
      setSeedText(undefined)
      setArtifactsOpen(false)
      setActiveArtifactId(null)
      setTasksOpen(false)
      setLoading(false)
      return
    }

    // Same session already loaded: keep state (including live stream UI).
    if (loadedIdRef.current === sessionId) {
      return
    }

    let cancelled = false
    const targetId = sessionId
    setLoading(true)
    setError(null)
    // Immediately drop previous session's UI so stream callbacks cannot
    // paint the wrong chat while the next session is loading.
    setSession(null)
    setMessages([])
    setTasks([])
    setArtifactsOpen(false)
    setActiveArtifactId(null)
    setTasksOpen(false)
    // Only show streaming chrome when the open session owns the stream.
    if (streamSessionIdRef.current !== targetId) {
      setStreaming(null)
    }

    getSession(targetId)
      .then((s) => {
        if (cancelled || viewSessionIdRef.current !== targetId) return
        loadedIdRef.current = s.id
        activeIdRef.current = s.id
        setSession(s)
        setMessages(s.messages || [])
        setTasks(Array.isArray(s.tasks) ? s.tasks : [])
        setCwd(s.cwd || '')
        setModel(s.model || defaultModel)
        // Re-attach stream UI only if this session still owns the live stream.
        if (streamSessionIdRef.current === s.id) {
          const buf = streamBuffersRef.current.get(s.id)
          setStreaming({
            text: buf?.text || '',
            tools: buf?.tools || [],
            active: true,
          })
          if (buf?.tasks) setTasks(buf.tasks)
        } else {
          setStreaming(null)
        }
      })
      .catch((err: Error) => {
        if (!cancelled && viewSessionIdRef.current === targetId) {
          setError(err.message)
        }
      })
      .finally(() => {
        if (!cancelled && viewSessionIdRef.current === targetId) {
          setLoading(false)
        }
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
        if (updated.cwd) {
          setCwd(updated.cwd)
          try {
            localStorage.setItem('chat_last_cwd', updated.cwd)
          } catch {
            /* ignore */
          }
        }
        onSessionUpdated(updated)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Update failed')
      }
    },
    [sessionId, draftMode, onSessionUpdated],
  )

  const handleCwdDraftChange = useCallback((v: string) => {
    setCwd(v)
    setError(null)
  }, [])

  const handleCwdCommit = useCallback(
    (v: string) => {
      const next = v.trim()
      setCwd(next)
      try {
        if (next) localStorage.setItem('chat_last_cwd', next)
      } catch {
        /* ignore */
      }
      if (!draftMode && sessionId) {
        void applyModelCwd({ cwd: next })
      }
    },
    [applyModelCwd, draftMode, sessionId],
  )

  function isViewingSession(id: string | null | undefined): boolean {
    return !!id && viewSessionIdRef.current === id
  }

  async function handleSend(text: string) {
    setError(null)
    let activeId = sessionId || activeIdRef.current

    // One live stream at a time in this SPA instance. Switching chats does not
    // cancel background work, but starting a new send on another session does.
    if (abortRef.current && streamSessionIdRef.current && streamSessionIdRef.current !== activeId) {
      abortRef.current.abort()
      abortRef.current = null
      streamSessionIdRef.current = null
      setStreaming(null)
    }

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
        viewSessionIdRef.current = created.id
        setSession(created)
        setMessages(created.messages || [])
        if (created.cwd) {
          setCwd(created.cwd)
          try {
            localStorage.setItem('chat_last_cwd', created.cwd)
          } catch {
            /* ignore */
          }
        }
        onSessionCreated(created)
      } else {
        activeIdRef.current = activeId
      }

      const streamId = activeId!
      streamSessionIdRef.current = streamId
      streamBuffersRef.current.set(streamId, { text: '', tools: [] })

      const userMsg: Message = {
        id: `local-${Date.now()}`,
        role: 'user',
        content: text,
        created_at: new Date().toISOString(),
      }
      if (isViewingSession(streamId)) {
        setMessages((prev) => [...prev, userMsg])
        setStreaming({ text: '', tools: [], active: true })
      }

      const ac = new AbortController()
      abortRef.current = ac
      const toolsMap = new Map<string, ToolCard>()

      const touchBuffer = (patch: {
        text?: string
        tools?: ToolCard[]
        tasks?: AgentTask[]
      }) => {
        const prev = streamBuffersRef.current.get(streamId) || {
          text: '',
          tools: [],
        }
        streamBuffersRef.current.set(streamId, {
          text: patch.text ?? prev.text,
          tools: patch.tools ?? prev.tools,
          tasks: patch.tasks ?? prev.tasks,
        })
      }

      await streamMessage(
        streamId,
        text,
        (event, data) => {
          // Always keep sidebar metadata fresh; only mutate main pane when
          // the user is still looking at the streaming session.
          const viewing = isViewingSession(streamId)

          if (event === 'meta') {
            if (Array.isArray(data.tasks)) {
              const tasks = data.tasks as AgentTask[]
              touchBuffer({ tasks })
              if (viewing) setTasks(tasks)
            }
          } else if (event === 'text_delta') {
            const chunk = String(data.text ?? '')
            const prev = streamBuffersRef.current.get(streamId)
            const nextText = (prev?.text || '') + chunk
            touchBuffer({ text: nextText })
            if (!viewing) return
            setStreaming((s) =>
              s
                ? { ...s, text: nextText, active: true }
                : { text: nextText, tools: [], active: true },
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
            const tools = Array.from(toolsMap.values())
            touchBuffer({ tools })
            if (!viewing) return
            setStreaming((s) => ({
              text: s?.text || streamBuffersRef.current.get(streamId)?.text || '',
              tools,
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
            const tools = Array.from(toolsMap.values())
            touchBuffer({ tools })
            if (!viewing) return
            setStreaming((s) => ({
              text: s?.text || streamBuffersRef.current.get(streamId)?.text || '',
              tools,
              active: true,
            }))
          } else if (event === 'task_create' || event === 'task_update') {
            const task = data.task as AgentTask | undefined
            if (task && task.id != null) {
              if (viewing) {
                setTasks((prev) => {
                  const next = upsertTask(prev, task)
                  touchBuffer({ tasks: next })
                  return next
                })
              } else {
                const prevTasks =
                  streamBuffersRef.current.get(streamId)?.tasks || []
                touchBuffer({ tasks: upsertTask(prevTasks, task) })
              }
            } else if (Array.isArray(data.tasks)) {
              const tasks = data.tasks as AgentTask[]
              touchBuffer({ tasks })
              if (viewing) setTasks(tasks)
            }
          } else if (event === 'error') {
            if (viewing) setError(String(data.message ?? 'Agent error'))
          } else if (event === 'done') {
            if (Array.isArray(data.tasks)) {
              const tasks = data.tasks as AgentTask[]
              touchBuffer({ tasks })
              if (viewing) setTasks(tasks)
            }
          }
        },
        ac.signal,
      )

      const fresh = await getSession(streamId)
      // Sidebar always updates; main pane only if still viewing this session.
      onSessionUpdated(fresh)
      if (isViewingSession(streamId)) {
        setSession(fresh)
        setMessages(fresh.messages || [])
        setTasks(Array.isArray(fresh.tasks) ? fresh.tasks : [])
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Send failed'
        if (isViewingSession(activeId)) setError(msg)
      }
      if (activeId) {
        try {
          const fresh = await getSession(activeId)
          onSessionUpdated(fresh)
          if (isViewingSession(activeId)) {
            setSession(fresh)
            setMessages(fresh.messages || [])
            setTasks(Array.isArray(fresh.tasks) ? fresh.tasks : [])
          }
        } catch {
          /* ignore */
        }
      }
    } finally {
      if (activeId) streamBuffersRef.current.delete(activeId)
      if (streamSessionIdRef.current === activeId) {
        streamSessionIdRef.current = null
        abortRef.current = null
      }
      // Clear stream chrome only if the user is still on this session.
      if (isViewingSession(activeId)) {
        setStreaming(null)
      }
    }
  }

  async function handleStop() {
    // Stop only the session currently on screen (or its draft-created id).
    const id = sessionId || activeIdRef.current || session?.id || null
    if (!id) return

    if (streamSessionIdRef.current === id) {
      abortRef.current?.abort()
      abortRef.current = null
      streamSessionIdRef.current = null
      streamBuffersRef.current.delete(id)
      setStreaming(null)
    }
    try {
      await stopSession(id)
    } catch {
      /* ignore */
    }
    // Refresh status if still viewing.
    if (isViewingSession(id)) {
      try {
        const fresh = await getSession(id)
        setSession(fresh)
        setMessages(fresh.messages || [])
        setTasks(Array.isArray(fresh.tasks) ? fresh.tasks : [])
        onSessionUpdated(fresh)
      } catch {
        /* ignore */
      }
    }
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
              <Tooltip content="permission_mode=bypassPermissions">
                <Badge variant="success" className="full-auto-badge">
                  <span className="status-dot-inline ok" />
                  Full auto
                </Badge>
              </Tooltip>
              {running ? (
                <Tooltip content="Agent turn in progress">
                  <Badge variant="accent" className="running-badge">
                    <span className="pulse-dot" />
                    Running
                  </Badge>
                </Tooltip>
              ) : null}
            </div>
            <div className="header-controls">
              <CwdPicker
                value={headerCwd}
                onChange={handleCwdDraftChange}
                onCommit={handleCwdCommit}
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
            <TasksPanel
              tasks={tasks}
              open={tasksOpen}
              onOpenChange={setTasksOpen}
            />
            <Tooltip content={artifactsOpen ? 'Hide artifacts panel' : 'Show artifacts panel'}>
              <Button
                type="button"
                variant={artifactsOpen ? 'secondary' : 'ghost'}
                onClick={() => setArtifactsOpen((v) => !v)}
                className={artifactsOpen ? 'active-toggle' : undefined}
              >
                <Boxes className="h-4 w-4" />
                Artifacts{artifacts.length ? ` (${artifacts.length})` : ''}
              </Button>
            </Tooltip>
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
