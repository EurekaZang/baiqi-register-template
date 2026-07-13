import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message, ToolCard } from '../api'
import { ToolCardView } from './ToolCard'

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
        <ToolCardView
          key={t.id}
          tool={t}
          running={runningIds?.has(t.id)}
        />
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

function MessageActions({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)
  if (!content.trim()) return null
  return (
    <div className="msg-actions">
      <button
        type="button"
        className="btn ghost msg-action-btn"
        onClick={() => {
          void copyText(content).then((ok) => {
            if (!ok) return
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
          })
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function Bubble({
  role,
  content,
  tools,
  streaming,
  runningToolIds,
}: {
  role: string
  content: string
  tools?: ToolCard[]
  streaming?: boolean
  runningToolIds?: Set<string>
}) {
  const isUser = role === 'user'
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
            <ToolCards tools={tools || []} runningIds={runningToolIds} />
            <div className="md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content || (streaming ? '' : '')}
              </ReactMarkdown>
              {streaming && <span className="cursor" aria-hidden />}
            </div>
          </>
        )}
      </div>
      {!streaming ? <MessageActions content={content} /> : null}
    </div>
  )
}

export function MessageList({
  messages,
  streaming,
  onSuggestion,
  suggestions = DEFAULT_SUGGESTIONS,
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
          role={m.role}
          content={m.content}
          tools={m.tools}
        />
      ))}
      {streaming?.active && (
        <Bubble
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
