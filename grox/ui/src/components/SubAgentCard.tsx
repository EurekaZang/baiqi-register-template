import { useEffect, useMemo, useState } from 'react'
import { Bot, ChevronDown, ChevronRight } from 'lucide-react'
import type { SubAgent, ToolCard } from '../api'
import { cn } from '../lib/utils'
import { ToolCardView, statusOf } from './ToolCard'

type Props = {
  subagent: SubAgent
  /** Force expanded while streaming. */
  forceOpen?: boolean
  className?: string
}

function statusLabel(status?: string): 'running' | 'done' | 'error' {
  const s = (status || 'running').toLowerCase()
  if (s === 'error' || s === 'failed') return 'error'
  if (s === 'done' || s === 'completed' || s === 'idle') return 'done'
  return 'running'
}

export function SubAgentCard({ subagent, forceOpen, className }: Props) {
  const status = statusLabel(subagent.status)
  const [open, setOpen] = useState(forceOpen || status === 'running')

  useEffect(() => {
    if (forceOpen || status === 'running') setOpen(true)
  }, [forceOpen, status, subagent.id])

  const tools = useMemo(() => subagent.tools || [], [subagent.tools])
  const runningIds = useMemo(() => {
    const set = new Set<string>()
    for (const t of tools) {
      if (statusOf(t, true) === 'running' && !t.output_summary) set.add(t.id)
    }
    // Only mark running tools while the subagent itself is running.
    return status === 'running' ? set : new Set<string>()
  }, [tools, status])

  const title = subagent.name || subagent.agent_type || 'subagent'
  const subtitle =
    subagent.summary ||
    (subagent.text || '').replace(/\s+/g, ' ').trim().slice(0, 96)

  return (
    <div
      className={cn(
        'subagent-card',
        `status-${status}`,
        open && 'is-open',
        className,
      )}
      data-status={status}
    >
      <button
        type="button"
        className="subagent-card-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Bot className="subagent-icon" aria-hidden />
        <span className="subagent-title">{title}</span>
        {subagent.agent_type && subagent.agent_type !== title ? (
          <span className="subagent-type">{subagent.agent_type}</span>
        ) : null}
        {!open && subtitle ? (
          <span className="subagent-inline-summary" title={subtitle}>
            {subtitle}
            {subtitle.length >= 96 ? '…' : ''}
          </span>
        ) : null}
        <span className={cn('tool-status-pill', `status-${status}`)}>
          {status === 'running' ? 'Running' : status === 'error' ? 'Failed' : 'Done'}
        </span>
        {open ? (
          <ChevronDown className="tool-chevron-icon" aria-hidden />
        ) : (
          <ChevronRight className="tool-chevron-icon" aria-hidden />
        )}
      </button>

      {open ? (
        <div className="subagent-card-body">
          {subagent.text?.trim() ? (
            <div className="subagent-text">
              <div className="tool-block-label">Subagent</div>
              <pre className="tool-pre subagent-pre">{subagent.text}</pre>
            </div>
          ) : status === 'running' ? (
            <div className="tool-running-hint muted">
              <span className="shimmer-bar" />
              Subagent working…
            </div>
          ) : null}

          {tools.length > 0 ? (
            <div className="subagent-tools">
              {tools.map((tool: ToolCard) => (
                <ToolCardView
                  key={tool.id}
                  tool={tool}
                  running={runningIds.has(tool.id)}
                  dense
                  defaultOpen={false}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
