import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  compactSession,
  createSession,
  generateSessionImage,
  getDefaultCwd,
  getSession,
  patchSession,
  resolveSessionPath,
  stopSession,
  streamMessage,
  uploadSessionFile,
  type AgentTask,
  type ContextUsage,
  type Message,
  type PathAttachment,
  type SessionSummary,
  type SubAgent,
  type ToolCard,
} from '../api'
import type { SendPayload } from './Composer'
import { Menu, MoreHorizontal } from 'lucide-react'
// MVP: ArtifactsPanel / TasksPanel hidden from default layout (keep files for later).
// import { ArtifactsPanel } from './ArtifactsPanel'
// import { TasksPanel } from './TasksPanel'
import { Composer } from './Composer'
import { ContextUsageDetail, ContextUsageMeter } from './ContextUsage'
import { CwdPicker } from './CwdPicker'
import { MessageList, type StreamState } from './MessageList'
import { MobileSheet } from './MobileSheet'
import { ModelSelect } from './ModelSelect'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Tooltip } from './ui/tooltip'

function shortPath(path: string): string {
  if (!path) return ''
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean)
  if (parts.length <= 3) return path
  return `…/${parts.slice(-3).join('/')}`
}

function upsertSubagentOnTools(
  tools: ToolCard[],
  subagent: SubAgent,
  parentToolUseId?: string | null,
): ToolCard[] {
  const parentId = parentToolUseId || subagent.parent_tool_use_id || ''
  if (!parentId) {
    // No parent yet — keep as-is; parent tool_start will attach later via buffer.
    return tools
  }
  let found = false
  const next = tools.map((t) => {
    if (t.id !== parentId) return t
    found = true
    return { ...t, subagent }
  })
  if (found) return next
  // Parent tool card not created yet: synthesize a placeholder so nested UI can show.
  return [
    ...next,
    {
      id: parentId,
      name: 'Agent',
      input_summary: subagent.name || subagent.agent_type || 'subagent',
      output_summary: '',
      ok: true,
      subagent,
    },
  ]
}

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

type StreamBuffer = {
  text: string
  tools: ToolCard[]
  tasks?: AgentTask[]
  subagents?: Record<string, SubAgent>
}

/**
 * Keep already-streamed assistant content when the SSE dies mid-turn.
 * Network errors clear the live stream bubble; without this merge the UI
 * reloads server messages that may not yet include the partial assistant.
 */
function mergePartialAssistant(
  messages: Message[],
  partial?: StreamBuffer | null,
): Message[] {
  if (!partial) return messages
  const text = partial.text || ''
  const tools = partial.tools || []
  if (!text && tools.length === 0) return messages

  const last = messages[messages.length - 1]
  if (last?.role === 'assistant') {
    const serverText = last.content || ''
    const serverTools = last.tools || []
    const partialRicher =
      text.length > serverText.length ||
      (tools.length > 0 && serverTools.length === 0) ||
      (text && !serverText)
    if (!partialRicher) return messages
    const next = [...messages]
    next[next.length - 1] = {
      ...last,
      content: text.length >= serverText.length ? text : serverText,
      tools: tools.length >= serverTools.length ? tools : serverTools,
    }
    return next
  }

  return [
    ...messages,
    {
      id: `local-partial-${Date.now()}`,
      role: 'assistant',
      content: text,
      tools: tools.length ? tools : undefined,
      created_at: new Date().toISOString(),
    },
  ]
}

type Props = {
  sessionId: string | null
  draftMode: boolean
  onSessionCreated: (session: SessionSummary) => void
  onSessionUpdated: (session: SessionSummary) => void
  defaultModel?: string
  isCompact?: boolean
  onOpenSidebar?: () => void
  sidebarOpen?: boolean
}

export function ChatView({
  sessionId,
  draftMode,
  onSessionCreated,
  onSessionUpdated,
  defaultModel = 'grok-4.5',
  isCompact = false,
  onOpenSidebar,
  sidebarOpen = false,
}: Props) {
  const [session, setSession] = useState<SessionSummary | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  // Keep task stream state for agent protocol; TasksPanel UI is MVP-hidden.
  const [, setTasks] = useState<AgentTask[]>([])
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)
  const [compacting, setCompacting] = useState(false)
  const [cwd, setCwd] = useState(() => {
    try {
      return localStorage.getItem('chat_last_cwd') || getDefaultCwd()
    } catch {
      return getDefaultCwd()
    }
  })
  const [model, setModel] = useState(defaultModel)
  const [streaming, setStreaming] = useState<StreamState>(null)
  const [imageBusy, setImageBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [seedText, setSeedText] = useState<string | undefined>(undefined)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [cwdSheetOpen, setCwdSheetOpen] = useState(false)
  const [contextSheetOpen, setContextSheetOpen] = useState(false)
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
    Map<
      string,
      {
        text: string
        tools: ToolCard[]
        tasks?: AgentTask[]
        subagents?: Record<string, SubAgent>
      }
    >
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
      setContextUsage(null)
      setCompacting(false)
      // Restore last cwd for new draft instead of wiping it.
      try {
        setCwd(localStorage.getItem('chat_last_cwd') || getDefaultCwd())
      } catch {
        setCwd(getDefaultCwd())
      }
      setModel(defaultModel)
      // Detach UI from any background stream; do not abort the agent turn.
      setStreaming(null)
      setError(null)
      setSeedText(undefined)
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
    setContextUsage(null)
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
        setContextUsage(s.context_usage || null)
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

  const applyModelCwd = useCallback(
    async (next: { model?: string; cwd?: string }) => {
      if (!sessionId || draftMode) return
      try {
        const updated = await patchSession(sessionId, next)
        setSession(updated)
        if (updated.model) setModel(updated.model)
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

  function isViewingSessionOrDraft(id: string | null | undefined): boolean {
    return id ? isViewingSession(id) : viewSessionIdRef.current === null
  }

  /** Ensure a real session exists so paste/drop can upload into cwd. */
  const ensureSessionForUpload = useCallback(async (): Promise<string> => {
    const existing = sessionId || activeIdRef.current
    if (existing && !draftMode) return existing
    if (!cwd.trim()) {
      throw new Error('Working directory (cwd) is required before attaching files')
    }
    const created = await createSession({
      cwd: cwd.trim(),
      model: model || defaultModel,
    })
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
    return created.id
  }, [sessionId, draftMode, cwd, model, defaultModel, onSessionCreated])

  async function handleSend(payload: SendPayload | string) {
    const text = typeof payload === 'string' ? payload : payload.text
    const attachments: PathAttachment[] =
      typeof payload === 'string' ? [] : payload.attachments || []
    const mode =
      typeof payload === 'string' ? 'chat' : payload.mode || 'chat'
    setError(null)
    let activeId = sessionId || activeIdRef.current

    // Image mode: JSON generate path (no agent SSE).
    if (mode === 'image') {
      const prompt = text.trim()
      if (!prompt || imageBusy || isStreaming) return
      try {
        if (draftMode || !activeId) {
          activeId = await ensureSessionForUpload()
        } else {
          activeIdRef.current = activeId
        }
        const sid = activeId!
        setImageBusy(true)
        const res = await generateSessionImage(sid, prompt)
        if (isViewingSession(sid)) {
          setMessages((prev) => [
            ...prev,
            res.user_message,
            res.assistant_message,
          ])
          setSession((s) =>
            s
              ? {
                  ...s,
                  title: res.session.title || s.title,
                  updated_at: res.session.updated_at || s.updated_at,
                  status: res.session.status || s.status,
                }
              : s,
          )
        }
        try {
          const fresh = await getSession(sid)
          onSessionUpdated(fresh)
          if (isViewingSession(sid)) {
            setSession(fresh)
            setMessages(fresh.messages || [])
          }
        } catch {
          onSessionUpdated({
            ...(session as SessionSummary),
            id: sid,
            title: res.session.title || session?.title || 'Chat',
            updated_at: res.session.updated_at || new Date().toISOString(),
            status: res.session.status || 'idle',
          } as SessionSummary)
        }
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Image generation failed'
        if (isViewingSessionOrDraft(activeId)) setError(msg)
      } finally {
        setImageBusy(false)
      }
      return
    }

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
        activeId = await ensureSessionForUpload()
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
        attachments: attachments.length ? attachments : undefined,
        created_at: new Date().toISOString(),
      }
      if (isViewingSession(streamId)) {
        setMessages((prev) => [...prev, userMsg])
        setStreaming({ text: '', tools: [], active: true })
      }

      const ac = new AbortController()
      abortRef.current = ac
      const toolsMap = new Map<string, ToolCard>()
      const subagentsMap = new Map<string, SubAgent>()

      const touchBuffer = (patch: {
        text?: string
        tools?: ToolCard[]
        tasks?: AgentTask[]
        subagents?: Record<string, SubAgent>
      }) => {
        const prev = streamBuffersRef.current.get(streamId) || {
          text: '',
          tools: [],
        }
        streamBuffersRef.current.set(streamId, {
          text: patch.text ?? prev.text,
          tools: patch.tools ?? prev.tools,
          tasks: patch.tasks ?? prev.tasks,
          subagents: patch.subagents ?? prev.subagents,
        })
      }

      const publishTools = (tools: ToolCard[]) => {
        touchBuffer({
          tools,
          subagents: Object.fromEntries(subagentsMap.entries()),
        })
        if (!isViewingSession(streamId)) return
        setStreaming((s) => ({
          text: s?.text || streamBuffersRef.current.get(streamId)?.text || '',
          tools,
          active: true,
        }))
      }

      const applySubagent = (partial: Partial<SubAgent> & { id: string }) => {
        const prev = subagentsMap.get(partial.id)
        const next: SubAgent = {
          id: partial.id,
          name: partial.name || prev?.name || partial.agent_type || 'subagent',
          agent_type: partial.agent_type || prev?.agent_type,
          parent_tool_use_id:
            partial.parent_tool_use_id || prev?.parent_tool_use_id,
          status: partial.status || prev?.status || 'running',
          text:
            partial.text !== undefined
              ? partial.text
              : prev?.text || '',
          tools: partial.tools || prev?.tools || [],
          summary:
            partial.summary !== undefined ? partial.summary : prev?.summary,
        }
        subagentsMap.set(next.id, next)
        // Re-nest onto current tool cards.
        let tools = Array.from(toolsMap.values())
        tools = upsertSubagentOnTools(tools, next, next.parent_tool_use_id)
        // Keep toolsMap in sync with nested attachment / placeholder parent.
        for (const t of tools) toolsMap.set(t.id, t)
        publishTools(tools)
        return next
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
            if (data.context_usage && typeof data.context_usage === 'object') {
              const cu = data.context_usage as ContextUsage
              if (viewing) setContextUsage(cu)
            }
          } else if (event === 'context_usage') {
            const cu = data as unknown as ContextUsage
            if (cu && typeof cu.total_tokens === 'number') {
              if (viewing) setContextUsage(cu)
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
            const id = String(data.id ?? crypto.randomUUID())
            const existing = toolsMap.get(id)
            const card: ToolCard = {
              id,
              name: String(data.name ?? existing?.name ?? 'tool'),
              input_summary: data.input_summary
                ? String(data.input_summary)
                : existing?.input_summary || '',
              output_summary: existing?.output_summary || '',
              ok: existing?.ok ?? true,
              subagent: existing?.subagent,
            }
            // If a subagent already claimed this parent, reattach.
            for (const sa of subagentsMap.values()) {
              if (sa.parent_tool_use_id === id) {
                card.subagent = sa
                break
              }
            }
            toolsMap.set(card.id, card)
            publishTools(Array.from(toolsMap.values()))
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
            // Preserve nested subagent if present.
            for (const sa of subagentsMap.values()) {
              if (sa.parent_tool_use_id === id) {
                existing.subagent = sa
                break
              }
            }
            toolsMap.set(id, existing)
            publishTools(Array.from(toolsMap.values()))
          } else if (event === 'subagent_start') {
            applySubagent({
              id: String(data.id ?? crypto.randomUUID()),
              name: String(data.name ?? data.agent_type ?? 'subagent'),
              agent_type: data.agent_type
                ? String(data.agent_type)
                : undefined,
              parent_tool_use_id: data.parent_tool_use_id
                ? String(data.parent_tool_use_id)
                : undefined,
              status: String(data.status ?? 'running'),
              text: '',
              tools: [],
            })
          } else if (event === 'subagent_text_delta') {
            const id = String(data.id ?? '')
            if (!id) return
            const prev = subagentsMap.get(id)
            applySubagent({
              id,
              name: prev?.name,
              agent_type: prev?.agent_type,
              parent_tool_use_id:
                (data.parent_tool_use_id
                  ? String(data.parent_tool_use_id)
                  : prev?.parent_tool_use_id) || undefined,
              status: prev?.status || 'running',
              text: (prev?.text || '') + String(data.text ?? ''),
              tools: prev?.tools || [],
            })
          } else if (event === 'subagent_tool_start' || event === 'subagent_tool_end') {
            const id = String(data.id ?? '')
            if (!id) return
            const prev = subagentsMap.get(id)
            const toolData = (data.tool || {}) as Record<string, unknown>
            const toolId = String(toolData.id ?? crypto.randomUUID())
            const tools = [...(prev?.tools || [])]
            const idx = tools.findIndex((t) => t.id === toolId)
            const nextTool: ToolCard = {
              id: toolId,
              name: String(toolData.name ?? (idx >= 0 ? tools[idx].name : 'tool')),
              input_summary:
                toolData.input_summary != null
                  ? String(toolData.input_summary)
                  : idx >= 0
                    ? tools[idx].input_summary
                    : '',
              output_summary:
                toolData.output_summary != null
                  ? String(toolData.output_summary)
                  : idx >= 0
                    ? tools[idx].output_summary
                    : '',
              ok:
                toolData.ok !== undefined
                  ? toolData.ok !== false
                  : idx >= 0
                    ? tools[idx].ok
                    : true,
            }
            if (idx >= 0) tools[idx] = nextTool
            else tools.push(nextTool)
            applySubagent({
              id,
              name: prev?.name,
              agent_type: prev?.agent_type,
              parent_tool_use_id:
                (data.parent_tool_use_id
                  ? String(data.parent_tool_use_id)
                  : prev?.parent_tool_use_id) || undefined,
              status: prev?.status || 'running',
              text: prev?.text || '',
              tools,
            })
          } else if (event === 'subagent_done') {
            const id = String(data.id ?? '')
            if (!id) return
            const prev = subagentsMap.get(id)
            applySubagent({
              id,
              name: prev?.name,
              agent_type: prev?.agent_type,
              parent_tool_use_id:
                (data.parent_tool_use_id
                  ? String(data.parent_tool_use_id)
                  : prev?.parent_tool_use_id) || undefined,
              status: String(data.status ?? 'done'),
              text: prev?.text || '',
              tools: prev?.tools || [],
              summary: data.summary != null ? String(data.summary) : prev?.summary,
            })
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
            if (data.context_usage && typeof data.context_usage === 'object') {
              const cu = data.context_usage as ContextUsage
              if (viewing) setContextUsage(cu)
            }
          }
        },
        ac.signal,
        attachments,
      )

      const streamBuf = streamBuffersRef.current.get(streamId)
      const fresh = await getSession(streamId)
      // Sidebar always updates; main pane only if still viewing this session.
      onSessionUpdated(fresh)
      if (isViewingSession(streamId)) {
        setSession(fresh)
        // Prefer server transcript, but keep any partial stream content the
        // backend has not finalized yet (network blips / race after done).
        setMessages(mergePartialAssistant(fresh.messages || [], streamBuf))
        setTasks(
          Array.isArray(fresh.tasks)
            ? fresh.tasks
            : streamBuf?.tasks || [],
        )
        setContextUsage(fresh.context_usage || null)
      }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      if (!aborted) {
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Send failed'
        if (isViewingSessionOrDraft(activeId)) setError(msg)
      }
      if (activeId) {
        const streamBuf = streamBuffersRef.current.get(activeId)
        try {
          const fresh = await getSession(activeId)
          onSessionUpdated(fresh)
          if (isViewingSession(activeId)) {
            setSession(fresh)
            // Network/stream failure must not erase already-rendered tokens.
            setMessages(mergePartialAssistant(fresh.messages || [], streamBuf))
            setTasks(
              Array.isArray(fresh.tasks)
                ? fresh.tasks
                : streamBuf?.tasks || [],
            )
            setContextUsage(fresh.context_usage || null)
          }
        } catch {
          // Session refresh failed (also network): still pin partial UI.
          if (isViewingSession(activeId) && streamBuf) {
            setMessages((prev) => mergePartialAssistant(prev, streamBuf))
            if (streamBuf.tasks) setTasks(streamBuf.tasks)
          }
        }
      }
    } finally {
      if (activeId) streamBuffersRef.current.delete(activeId)
      if (streamSessionIdRef.current === activeId) {
        streamSessionIdRef.current = null
        abortRef.current = null
      }
      // Clear stream chrome only if the user is still on this session.
      // Partial content has already been merged into `messages` above.
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
        setContextUsage(fresh.context_usage || null)
        onSessionUpdated(fresh)
      } catch {
        /* ignore */
      }
    }
  }

  async function handleCompact() {
    const id = sessionId || activeIdRef.current || session?.id || null
    if (!id || draftMode || running || compacting) return
    if (!session?.sdk_session_id) {
      setError('Nothing to compact yet — send at least one agent turn first.')
      return
    }
    setError(null)
    setCompacting(true)
    try {
      const updated = await compactSession(id)
      if (isViewingSession(id)) {
        setSession(updated)
        setMessages(updated.messages || [])
        setTasks(Array.isArray(updated.tasks) ? updated.tasks : [])
        setContextUsage(updated.context_usage || null)
      }
      onSessionUpdated(updated)
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Compact failed'
      if (isViewingSession(id)) setError(msg)
    } finally {
      setCompacting(false)
    }
  }

  function handleSuggestion(text: string) {
    if (!cwd.trim() && (draftMode || !sessionId)) {
      setError('Working directory (cwd) is required')
      return
    }
    setSeedText(text)
  }

  function closeAllSheets() {
    setOverflowOpen(false)
    setCwdSheetOpen(false)
    setContextSheetOpen(false)
  }

  function openOnly(which: 'overflow' | 'cwd' | 'context') {
    setOverflowOpen(which === 'overflow')
    setCwdSheetOpen(which === 'cwd')
    setContextSheetOpen(which === 'context')
  }

  // Always collapse overlays so desktop doesn't inherit compact sheet state (and vice versa).
  useEffect(() => {
    closeAllSheets()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when compact mode changes
  }, [isCompact])

  const headerCwd = draftMode ? cwd : session?.cwd || cwd
  const headerModel = draftMode ? model : session?.model || model
  const running = isStreaming || imageBusy || session?.status === 'running'
  const title =
    session?.title && session.title !== 'New chat'
      ? session.title
      : draftMode
        ? 'New chat'
        : session?.title || 'Chat'

  return (
    <section className="chat-view">
      <div className="chat-main-col">
        {isCompact ? (
          <header className="chat-header chat-header--compact">
            <div className="header-top header-top--compact">
              <div className="header-title-row">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="header-menu-btn"
                  aria-label="Open sessions"
                  aria-expanded={sidebarOpen}
                  aria-controls="chat-sidebar"
                  onClick={() => {
                    closeAllSheets()
                    onOpenSidebar?.()
                  }}
                >
                  <Menu className="h-5 w-5" />
                </Button>
                <h1 className="chat-title">{title}</h1>
                {running ? (
                  <Badge variant="accent" className="running-badge">
                    <span className="pulse-dot" />
                    Running
                  </Badge>
                ) : null}
              </div>
              <div className="header-actions header-actions--compact">
                <div className="model-select-host">
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="header-overflow-btn"
                  aria-label="More tools"
                  aria-haspopup="dialog"
                  aria-expanded={overflowOpen}
                  onClick={() => openOnly('overflow')}
                >
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </header>
        ) : (
          <header className="chat-header">
            <div className="header-top">
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
              <div className="header-actions">
                <ContextUsageMeter
                  usage={contextUsage}
                  canCompact={
                    !draftMode &&
                    !!session?.sdk_session_id &&
                    (session.messages?.length || messages.length) > 0
                  }
                  compacting={compacting}
                  onCompact={
                    running || compacting ? undefined : () => void handleCompact()
                  }
                />
              </div>
            </div>
            <div className="header-toolbar">
              <CwdPicker
                value={headerCwd}
                onChange={handleCwdDraftChange}
                onCommit={handleCwdCommit}
                disabled={running}
              />
              <Tooltip
                content={
                  running
                    ? 'Wait for the current turn to finish, then change model'
                    : session?.sdk_session_id
                      ? 'Applies to the next message (starts a fresh model session)'
                      : 'Model for the next agent turn'
                }
              >
                <div className="model-select-host">
                  <ModelSelect
                    value={headerModel}
                    onChange={(v) => {
                      setModel(v)
                      if (!draftMode && sessionId)
                        void applyModelCwd({ model: v })
                    }}
                    disabled={running}
                    compact
                  />
                </div>
              </Tooltip>
            </div>
          </header>
        )}

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
                  : (userText) =>
                      void handleSend({ text: userText, attachments: [] })
              }
            />
          )}
        </div>

        <Composer
          compact={!!isCompact}
          missingCwd={!!isCompact && draftMode && !cwd.trim()}
          onRequestCwd={() => openOnly('cwd')}
          disabled={loading || (draftMode && !cwd.trim()) || imageBusy}
          streaming={isStreaming}
          imageBusy={imageBusy}
          onSend={handleSend}
          onStop={() => void handleStop()}
          seedText={seedText}
          onSeedConsumed={() => setSeedText(undefined)}
          resolvePath={
            cwd.trim()
              ? async (path) => {
                  const id = await ensureSessionForUpload()
                  return resolveSessionPath(id, path)
                }
              : undefined
          }
          uploadFile={
            cwd.trim()
              ? async (file) => {
                  const id = await ensureSessionForUpload()
                  return uploadSessionFile(id, file)
                }
              : undefined
          }
          hint={
            draftMode && !cwd.trim()
              ? isCompact
                ? undefined
                : 'Set an absolute cwd above before starting.'
              : isStreaming || session?.status === 'running'
                ? 'Agent is running in Full auto mode.'
                : isCompact
                  ? undefined
                  : 'Paste or drop files under the workspace cwd.'
          }
          placeholder={
            draftMode
              ? cwd.trim()
                ? 'Message Grox…'
                : 'Set cwd above, then message Grox…'
              : 'Message Grox…'
          }
        />
      </div>

      {isCompact ? (
        <>
          <MobileSheet
            open={overflowOpen}
            onClose={() => setOverflowOpen(false)}
            title="Workspace"
            height="auto"
          >
            <div className="overflow-sheet-list">
              <button
                type="button"
                className="overflow-sheet-row"
                onClick={() => openOnly('cwd')}
              >
                <span className="overflow-sheet-label">Working directory</span>
                <span className="overflow-sheet-meta mono">
                  {headerCwd ? shortPath(headerCwd) : 'Not set'}
                </span>
              </button>
              <button
                type="button"
                className="overflow-sheet-row"
                onClick={() => openOnly('context')}
              >
                <span className="overflow-sheet-label">Context</span>
                <span className="overflow-sheet-meta">
                  {contextUsage?.max_tokens
                    ? `${Math.round(contextUsage.percentage ?? 0)}%`
                    : '—'}
                </span>
              </button>
              <div className="overflow-sheet-note muted">
                Full auto · permission_mode=bypassPermissions
              </div>
            </div>
          </MobileSheet>

          <MobileSheet
            open={cwdSheetOpen}
            onClose={() => setCwdSheetOpen(false)}
            title="Working directory"
            height="auto"
          >
            <CwdPicker
              value={headerCwd}
              onChange={handleCwdDraftChange}
              onCommit={(v) => {
                handleCwdCommit(v)
              }}
              disabled={running}
              className="cwd-picker--sheet"
            />
          </MobileSheet>

          <MobileSheet
            open={contextSheetOpen}
            onClose={() => setContextSheetOpen(false)}
            title="Context"
            height="auto"
          >
            <ContextUsageDetail
              usage={contextUsage}
              canCompact={
                !draftMode &&
                !!session?.sdk_session_id &&
                (session.messages?.length || messages.length) > 0
              }
              compacting={compacting}
              onCompact={
                running || compacting ? undefined : () => void handleCompact()
              }
            />
          </MobileSheet>
        </>
      ) : null}
    </section>
  )
}
