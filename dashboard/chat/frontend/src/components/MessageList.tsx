import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message, ToolCard } from '../api'


export type StreamState = {
  text: string
  tools: ToolCard[]
  active: boolean
} | null

type Props = {
  messages: Message[]
  streaming: StreamState
}

function ToolCards({ tools }: { tools: ToolCard[] }) {
  if (!tools?.length) return null
  return (
    <div className="tool-cards">
      {tools.map((t) => (
        <div key={t.id} className={`tool-card ${t.ok === false ? 'error' : ''}`}>
          <div className="tool-name">
            <span className="tool-icon">{t.ok === false ? '✗' : '⚙'}</span>
            {t.name}
          </div>
          {t.input_summary && (
            <div className="tool-line muted">
              <span className="label">in</span> {t.input_summary}
            </div>
          )}
          {t.output_summary && (
            <div className="tool-line muted">
              <span className="label">out</span> {t.output_summary}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function Bubble({
  role,
  content,
  tools,
  streaming,
}: {
  role: string
  content: string
  tools?: ToolCard[]
  streaming?: boolean
}) {
  const isUser = role === 'user'
  return (
    <div className={`msg ${isUser ? 'user' : 'assistant'}`}>
      <div className="msg-role">{isUser ? 'You' : 'Assistant'}</div>
      <div className="msg-body">
        {isUser ? (
          <div className="user-text">{content}</div>
        ) : (
          <>
            <ToolCards tools={tools || []} />
            <div className="md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content || (streaming ? '' : '')}
              </ReactMarkdown>
              {streaming && <span className="cursor" aria-hidden />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function MessageList({ messages, streaming }: Props) {
  return (
    <div className="message-list">
      {messages.length === 0 && !streaming && (
        <div className="empty-state muted">
          Send a message to start. Agent runs in Full auto mode.
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
        />
      )}
    </div>
  )
}
