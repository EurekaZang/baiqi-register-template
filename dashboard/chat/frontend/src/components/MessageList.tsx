import { useMemo, useState } from 'react'
import { Boxes, Copy, RotateCcw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message, ToolCard } from '../api'
import { extractArtifacts, extractReasoning, type Artifact } from '../lib/content'
import { ReasoningBlock } from './ReasoningBlock'
import { ToolCardView } from './ToolCard'
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
      <Card
        className={
          isUser
            ? 'msg-card user-card border-slate-200 bg-white shadow-sm'
            : 'msg-card assistant-card border-transparent bg-transparent shadow-none'
        }
      >
        <CardHeader className="msg-card-header flex-row items-center justify-between space-y-0 p-3 pb-1">
          <CardTitle className="msg-role text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            {isUser ? 'You' : 'Assistant'}
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
                        {s}
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
        <div key={m.id} className="msg-stack">
          {index > 0 ? <Separator className="msg-separator my-1 opacity-60" /> : null}
          <Bubble
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
        </div>
      ))}

      {streaming?.active && (
        <div className="msg-stack">
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
        </div>
      )}
    </div>
  )
}
