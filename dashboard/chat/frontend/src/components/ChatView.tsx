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

  const isStreaming = !!streaming?.active

  useEffect(() => {
    if (draftMode || !sessionId) {
      loadedIdRef.current = null
      activeIdRef.current = null
      setSession(null)
      setMessages([])
      setTasks([])
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
        setTasks(Array.isArray(s.tasks) ? s.tasks : [])
        setCwd(s.cwd || '')
        setModel(s.model || defaultModel)
        // Keep tasks collapsed by default to avoid covering chat.
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
          if (event === 'meta') {
            if (Array.isArray(data.tasks)) {
              setTasks(data.tasks as AgentTask[])
            }
          } else if (event === 'text_delta') {
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
          } else if (event === 'task_create' || event === 'task_update') {
            const task = data.task as AgentTask | undefined
            if (task && task.id != null) {
              setTasks((prev) => upsertTask(prev, task))
              // Auto-open only briefly useful when first task appears; keep collapsed otherwise.
              setTasksOpen((prev) => prev)
            } else if (Array.isArray(data.tasks)) {
              setTasks(data.tasks as AgentTask[])
            }
          } else if (event === 'error') {
            setError(String(data.message ?? 'Agent error'))
          } else if (event === 'done') {
            if (Array.isArray(data.tasks)) {
              setTasks(data.tasks as AgentTask[])
            }
          }
        },
        ac.signal,
      )

      const fresh = await getSession(activeId!)
      setSession(fresh)
      setMessages(fresh.messages || [])
      setTasks(Array.isArray(fresh.tasks) ? fresh.tasks : [])
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
          setTasks(Array.isArray(fresh.tasks) ? fresh.tasks : [])
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
