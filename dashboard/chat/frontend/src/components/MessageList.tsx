import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { Boxes, ChevronDown, ChevronRight, Copy, RotateCcw, Wrench } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message, PathAttachment, ToolCard } from '../api'
import { extractArtifacts, extractReasoning, type Artifact } from '../lib/content'
import { AuthImage } from './AuthImage'
import { ReasoningBlock } from './ReasoningBlock'
import { statusOf, ToolCardView } from './ToolCard'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './ui/card'
import { Separator } from './ui/separator'
import { Tooltip } from './ui/tooltip'

const MSG_SPRING = { type: 'spring' as const, stiffness: 420, damping: 32, mass: 0.8 }

export type StreamState = {
  text: string
  tools: ToolCard[]
  active: boolean
} | null

type Props = {
  messages: Message[]
  streaming: StreamState
  onSuggestion?: (text: string) => void
  suggestions?: string[]
  onRetry?: (userText: string) => void
  onOpenArtifact?: (artifact: Artifact) => void
}

const DEFAULT_SUGGESTIONS = [
  'Summarize this project structure',
  'Find recent bugs or TODOs',
  'Explain the main entrypoint',
  'Propose a small safe refactor',
]

function ToolCards({
  tools,
  runningIds,
}: {
  tools: ToolCard[]
  runningIds?: Set<string>
}) {
  const [parent] = useAutoAnimate({ duration: 160, easing: 'ease-out' })
  const [expanded, setExpanded] = useState(false)

  const items = useMemo(() => {
    return (tools || []).map((t) => ({
      tool: t,
      running: !!runningIds?.has(t.id),
      status: statusOf(t, runningIds?.has(t.id)),
    }))
  }, [tools, runningIds])

  if (!items.length) return null

  const failedCount = items.filter((i) => i.status === 'error').length
  const runningCount = items.filter((i) => i.status === 'running').length
  const doneCount = items.filter((i) => i.status === 'done').length
  // Collapse long successful trails by default; keep failures/running visible.
  const shouldCollapse = doneCount >= 2 && items.length >= 3
  const collapsedCount = shouldCollapse && !expanded ? doneCount : 0
  const visible = items.filter((i) => {
    if (!shouldCollapse || expanded) return true
    return i.status !== 'done'
  })

  const summaryBits: string[] = []
  if (doneCount) summaryBits.push(`${doneCount} done`)
  if (failedCount) summaryBits.push(`${failedCount} failed`)
  if (runningCount) summaryBits.push(`${runningCount} running`)

  // Compact name strip for the group header (e.g. Read · Bash · Edit)
  const nameStrip = (() => {
    const names: string[] = []
    const seen = new Set<string>()
    for (const i of items) {
      const n = i.tool.name || 'tool'
      if (seen.has(n)) continue
      seen.add(n)
      names.push(n)
      if (names.length >= 5) break
    }
    if (names.length === 1 && items.length > 1) return `${names[0]} ×${items.length}`
    const uniqueTotal = new Set(items.map((i) => i.tool.name || 'tool')).size
    const hiddenUnique = Math.max(0, uniqueTotal - names.length)
    return names.join(' · ') + (hiddenUnique > 0 ? ` +${hiddenUnique}` : '')
  })()

  return (
    <div className={cn('tool-cards', shouldCollapse && 'is-grouped')} ref={parent}>
      {shouldCollapse ? (
        <button
          type="button"
          className={cn('tool-group-bar', expanded && 'is-open')}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <Wrench className="tool-group-icon" aria-hidden />
          <span className="tool-group-title">
            {items.length} tools
            <span className="tool-group-names">{nameStrip}</span>
          </span>
          <span className="tool-group-meta">{summaryBits.join(' · ')}</span>
          {expanded ? (
            <ChevronDown className="tool-chevron-icon" aria-hidden />
          ) : (
            <ChevronRight className="tool-chevron-icon" aria-hidden />
          )}
        </button>
      ) : null}

      {visible.map(({ tool, running }) => (
        <ToolCardView
          key={tool.id}
          tool={tool}
          running={running}
          dense
          defaultOpen={false}
        />
      ))}

      {collapsedCount > 0 ? (
        <button
          type="button"
          className="tool-group-more"
          onClick={() => setExpanded(true)}
        >
          Show {collapsedCount} successful step{collapsedCount === 1 ? '' : 's'}
        </button>
      ) : null}

      {shouldCollapse && expanded && doneCount > 0 ? (
        <button
          type="button"
          className="tool-group-more is-collapse"
          onClick={() => setExpanded(false)}
        >
          Hide successful steps
        </button>
      ) : null}
    </div>
  )
}

function MessageEntrance({
  children,
  className,
  animate = true,
}: {
  children: ReactNode
  className?: string
  /** When false, skip entrance (history load / session switch). */
  animate?: boolean
}) {
  const reduceMotion = useReducedMotion()
  if (reduceMotion || !animate) {
    return <div className={className}>{children}</div>
  }
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={MSG_SPRING}
    >
      {children}
    </motion.div>
  )
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

function MessageActions({
  content,
  onRetry,
  artifacts,
  onOpenArtifact,
}: {
  content: string
  onRetry?: () => void
  artifacts?: Artifact[]
  onOpenArtifact?: (a: Artifact) => void
}) {
  const [copied, setCopied] = useState(false)
  if (!content.trim() && !artifacts?.length && !onRetry) return null
  return (
    <div className="msg-actions">
      {content.trim() ? (
        <Tooltip content={copied ? 'Copied' : 'Copy message'}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="msg-action-btn h-7 px-2 text-xs"
            onClick={() => {
              void copyText(content).then((ok) => {
                if (!ok) return
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1200)
              })
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </Tooltip>
      ) : null}
      {onRetry ? (
        <Tooltip content="Resend this prompt">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="msg-action-btn h-7 px-2 text-xs"
            onClick={onRetry}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </Tooltip>
      ) : null}
      {artifacts && artifacts.length > 0 && onOpenArtifact ? (
        <Tooltip content="Open code artifacts panel">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="msg-action-btn h-7 px-2 text-xs"
            onClick={() => onOpenArtifact(artifacts[artifacts.length - 1])}
          >
            <Boxes className="h-3.5 w-3.5" />
            Artifacts ({artifacts.length})
          </Button>
        </Tooltip>
      ) : null}
    </div>
  )
}

function AttachmentChips({ items }: { items?: PathAttachment[] }) {
  if (!items?.length) return null
  return (
    <div className="msg-attach-row">
      {items.map((a) => (
        <span key={a.path} className="msg-attach-chip" title={a.path}>
          {a.kind === 'image' ? '🖼' : '📄'} {a.path}
        </span>
      ))}
    </div>
  )
}

function Bubble({
  id,
  role,
  content,
  tools,
  streaming,
  runningToolIds,
  onRetry,
  onOpenArtifact,
  kind,
  attachments,
}: {
  id: string
  role: string
  content: string
  tools?: ToolCard[]
  streaming?: boolean
  runningToolIds?: Set<string>
  onRetry?: () => void
  onOpenArtifact?: (a: Artifact) => void
  kind?: string
  attachments?: PathAttachment[]
}) {
  const isUser = role === 'user'
  const isSystem = role === 'system' || kind === 'compact_boundary'
  const isCompactSummary = kind === 'compact_summary'
  const { reasoning, rest } = useMemo(
    () =>
      isUser || isSystem
        ? { reasoning: [] as string[], rest: content }
        : extractReasoning(content),
    [content, isUser, isSystem],
  )
  const artifacts = useMemo(
    () => (isUser || isSystem ? [] : extractArtifacts(content, id)),
    [content, id, isUser, isSystem],
  )

  if (isSystem || kind === 'compact_boundary') {
    return (
      <div className="msg system compact-boundary">
        <div className="compact-boundary-line" role="separator">
          <span className="compact-boundary-label">{content}</span>
        </div>
      </div>
    )
  }

  return (
    <div className={`msg ${isUser ? 'user' : 'assistant'}${isCompactSummary ? ' compact-summary' : ''}`}>
      <Card
        className={
          isUser
            ? 'msg-card user-card border-slate-200 bg-white shadow-sm'
            : isCompactSummary
              ? 'msg-card assistant-card compact-summary-card border-sky-100 bg-sky-50/40 shadow-none'
              : 'msg-card assistant-card border-transparent bg-transparent shadow-none'
        }
      >
        <CardHeader className="msg-card-header flex-row items-center justify-between space-y-0 p-3 pb-1">
          <CardTitle className="msg-role text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            {isUser ? 'You' : isCompactSummary ? 'Compact summary' : 'Assistant'}
          </CardTitle>
          {!isUser && streaming ? (
            <Badge variant="accent" className="msg-stream-badge gap-1.5">
              <span className="pulse-dot" />
              Streaming
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent className={isUser ? 'p-3 pt-1' : 'px-1 py-1'}>
          {isUser ? (
            <>
              <AttachmentChips items={attachments} />
              {content ? <div className="user-text">{content}</div> : null}
            </>
          ) : (
            <>
              {reasoning.map((r, idx) => (
                <ReasoningBlock key={`${id}-r${idx}`} text={r} />
              ))}
              <ToolCards tools={tools || []} runningIds={runningToolIds} />
              <div className="md">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    img: ({ src, alt, title }) => (
                      <AuthImage
                        src={typeof src === 'string' ? src : undefined}
                        alt={alt}
                        title={title}
                      />
                    ),
                  }}
                >
                  {rest || (streaming ? '' : '')}
                </ReactMarkdown>
                {streaming && <span className="cursor" aria-hidden />}
              </div>
            </>
          )}
        </CardContent>
        {!streaming ? (
          <CardFooter className="msg-card-footer justify-start gap-1 p-2 pt-0">
            <MessageActions
              content={isUser ? content : rest}
              onRetry={isUser ? onRetry : undefined}
              artifacts={artifacts}
              onOpenArtifact={onOpenArtifact}
            />
          </CardFooter>
        ) : null}
      </Card>
    </div>
  )
}

export function MessageList({
  messages,
  streaming,
  onSuggestion,
  suggestions = DEFAULT_SUGGESTIONS,
  onRetry,
  onOpenArtifact,
}: Props) {
  // Only animate truly new bubbles (send / stream), not full history loads
  // or post-stream bulk replace (local ids → server ids).
  // Compute during render so Motion mounts with the correct `initial`.
  const knownIdsRef = useRef<Set<string>>(new Set())
  const seededRef = useRef(false)
  const entranceCacheRef = useRef<Map<string, boolean>>(new Map())

  const liveIds = useMemo(() => {
    const ids = new Set(messages.map((m) => m.id))
    if (streaming?.active) ids.add('streaming')
    return ids
  }, [messages, streaming?.active])

  if (liveIds.size === 0) {
    knownIdsRef.current.clear()
    entranceCacheRef.current.clear()
    seededRef.current = false
  } else {
    for (const id of [...knownIdsRef.current]) {
      if (!liveIds.has(id)) {
        knownIdsRef.current.delete(id)
        entranceCacheRef.current.delete(id)
      }
    }
    if (!seededRef.current) {
      for (const id of liveIds) {
        knownIdsRef.current.add(id)
        entranceCacheRef.current.set(id, false)
      }
      seededRef.current = true
    } else {
      const fresh: string[] = []
      for (const id of liveIds) {
        if (!knownIdsRef.current.has(id)) fresh.push(id)
      }
      // 1–2 new ids ≈ user send / stream start; bulk = history sync → no bounce.
      const animateFresh = fresh.length > 0 && fresh.length <= 2
      for (const id of fresh) {
        knownIdsRef.current.add(id)
        entranceCacheRef.current.set(id, animateFresh || id === 'streaming')
      }
    }
  }

  const shouldAnimate = (id: string) => entranceCacheRef.current.get(id) === true

  const runningToolIds = new Set<string>()
  if (streaming?.active) {
    for (const t of streaming.tools) {
      if (t.ok !== false && !t.output_summary) runningToolIds.add(t.id)
    }
  }

  return (
    <div className="message-list">
      {messages.length === 0 && !streaming && (
        <div className="empty-state">
          <Card className="empty-card mx-auto max-w-[560px] text-left shadow-md">
            <CardHeader>
              <CardDescription className="empty-kicker text-[11px] font-semibold uppercase tracking-[0.1em] text-sky-600">
                8090 Agent
              </CardDescription>
              <CardTitle className="empty-title text-xl tracking-tight">
                What should we work on?
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="empty-desc muted mb-4 text-[13px] leading-relaxed">
                Full auto mode is on. Pick a working directory, then send a task or
                try a suggestion.
              </p>
              {onSuggestion ? (
                <div className="suggestion-row">
                  {suggestions.map((s) => (
                    <Tooltip key={s} content="Fill composer">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="suggestion-chip h-auto rounded-full px-3 py-1.5 text-xs font-normal"
                        onClick={() => onSuggestion(s)}
                      >
                        <span>{s}</span>
                      </Button>
                    </Tooltip>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}

      {messages.map((m, index) => (
        <MessageEntrance
          key={m.id}
          className="msg-stack"
          animate={shouldAnimate(m.id)}
        >
          {index > 0 && m.kind !== 'compact_boundary' ? (
            <Separator className="msg-separator my-1 opacity-60" />
          ) : null}
          <Bubble
            id={m.id}
            role={m.role}
            content={m.content}
            tools={m.tools}
            kind={m.kind}
            attachments={m.attachments}
            onRetry={
              m.role === 'user' && onRetry
                ? () => onRetry(m.content)
                : undefined
            }
            onOpenArtifact={onOpenArtifact}
          />
        </MessageEntrance>
      ))}

      {streaming?.active && (
        <MessageEntrance
          key="streaming"
          className="msg-stack"
          animate={shouldAnimate('streaming')}
        >
          {messages.length > 0 ? (
            <Separator className="msg-separator my-1 opacity-60" />
          ) : null}
          <Bubble
            id="streaming"
            role="assistant"
            content={streaming.text}
            tools={streaming.tools}
            streaming
            runningToolIds={runningToolIds}
          />
        </MessageEntrance>
      )}
    </div>
  )
}
