import { useMemo, useState } from 'react'
import { Boxes, Copy, RotateCcw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message, ToolCard } from '../api'
import { extractArtifacts, extractReasoning, type Artifact } from '../lib/content'
import { ReasoningBlock } from './ReasoningBlock'
import { ToolCardView } from './ToolCard'
import { Button } from './ui/button'

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
  if (!tools?.length) return null
  return (
    <div className="tool-cards">
      {tools.map((t) => (
        <ToolCardView key={t.id} tool={t} running={runningIds?.has(t.id)} />
      ))}
    </div>
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
      ) : null}
      {onRetry ? (
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
      ) : null}
      {artifacts && artifacts.length > 0 && onOpenArtifact ? (
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
      ) : null}
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
}: {
  id: string
  role: string
  content: string
  tools?: ToolCard[]
  streaming?: boolean
  runningToolIds?: Set<string>
  onRetry?: () => void
  onOpenArtifact?: (a: Artifact) => void
}) {
  const isUser = role === 'user'
  const { reasoning, rest } = useMemo(
    () => (isUser ? { reasoning: [] as string[], rest: content } : extractReasoning(content)),
    [content, isUser],
  )
  const artifacts = useMemo(
    () => (isUser ? [] : extractArtifacts(content, id)),
    [content, id, isUser],
  )

  return (
    <div className={`msg ${isUser ? 'user' : 'assistant'}`}>
      <div className="msg-meta">
        <div className="msg-role">{isUser ? 'You' : 'Assistant'}</div>
        {!isUser && streaming ? (
          <div className="msg-stream-badge">
            <span className="pulse-dot" />
            Streaming
          </div>
        ) : null}
      </div>
      <div className="msg-body">
        {isUser ? (
          <div className="user-text">{content}</div>
        ) : (
          <>
            {reasoning.map((r, idx) => (
              <ReasoningBlock key={`${id}-r${idx}`} text={r} />
            ))}
            <ToolCards tools={tools || []} runningIds={runningToolIds} />
            <div className="md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {rest || (streaming ? '' : '')}
              </ReactMarkdown>
              {streaming && <span className="cursor" aria-hidden />}
            </div>
          </>
        )}
      </div>
      {!streaming ? (
        <MessageActions
          content={isUser ? content : rest}
          onRetry={isUser ? onRetry : undefined}
          artifacts={artifacts}
          onOpenArtifact={onOpenArtifact}
        />
      ) : null}
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
          <div className="empty-card">
            <div className="empty-kicker">8090 Agent</div>
            <h2 className="empty-title">What should we work on?</h2>
            <p className="empty-desc muted">
              Full auto mode is on. Pick a working directory, then send a task or
              try a suggestion.
            </p>
            {onSuggestion ? (
              <div className="suggestion-row">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="suggestion-chip"
                    onClick={() => onSuggestion(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}
      {messages.map((m) => (
        <Bubble
          key={m.id}
          id={m.id}
          role={m.role}
          content={m.content}
          tools={m.tools}
          onRetry={
            m.role === 'user' && onRetry
              ? () => onRetry(m.content)
              : undefined
          }
          onOpenArtifact={onOpenArtifact}
        />
      ))}
      {streaming?.active && (
        <Bubble
          id="streaming"
          role="assistant"
          content={streaming.text}
          tools={streaming.tools}
          streaming
          runningToolIds={runningToolIds}
        />
      )}
    </div>
  )
}
