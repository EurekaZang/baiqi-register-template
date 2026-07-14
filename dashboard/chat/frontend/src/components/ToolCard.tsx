import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ToolCard as ToolCardType } from '../api'
import { cn } from '../lib/utils'
import { SubAgentCard } from './SubAgentCard'

type Props = {
  tool: ToolCardType
  /** When true, tool is still running (stream mid-flight). */
  running?: boolean
  defaultOpen?: boolean
  /** Compact one-line row (used inside collapsed groups). */
  dense?: boolean
}

export function statusOf(
  tool: ToolCardType,
  running?: boolean,
): 'running' | 'done' | 'error' {
  if (running && tool.ok !== false && !tool.output_summary) return 'running'
  if (tool.ok === false) return 'error'
  return 'done'
}

function shortSummary(text?: string, max = 72): string {
  if (!text) return ''
  const one = text.replace(/\s+/g, ' ').trim()
  if (one.length <= max) return one
  return `${one.slice(0, max - 1)}…`
}

export function ToolCardView({
  tool,
  running,
  defaultOpen = false,
  dense = true,
}: Props) {
  const status = statusOf(tool, running)
  // Default: only errors open. Successful tools stay collapsed to reduce noise.
  const [open, setOpen] = useState(defaultOpen || status === 'error')
  const summary =
    status === 'error'
      ? shortSummary(tool.output_summary || tool.input_summary, 88)
      : shortSummary(tool.input_summary, 64)

  return (
    <div
      className={cn(
        'tool-card',
        `status-${status}`,
        dense && 'is-dense',
        open && 'is-open',
      )}
      data-open={open ? '1' : '0'}
      data-status={status}
    >
      <button
        type="button"
        className="tool-card-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={cn('tool-status-dot', `status-${status}`)} aria-hidden />
        <span className="tool-name">{tool.name}</span>
        {summary && !open ? (
          <span className="tool-inline-summary" title={summary}>
            {summary}
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
        <div className="tool-card-body">
          {tool.input_summary ? (
            <div className="tool-block">
              <div className="tool-block-label">Input</div>
              <pre className="tool-pre">{tool.input_summary}</pre>
            </div>
          ) : null}
          {tool.output_summary ? (
            <div className="tool-block">
              <div className="tool-block-label">Output</div>
              <pre className="tool-pre">{tool.output_summary}</pre>
            </div>
          ) : status === 'running' && !tool.subagent ? (
            <div className="tool-running-hint muted">
              <span className="shimmer-bar" />
              Waiting for tool result…
            </div>
          ) : null}
        </div>
      ) : null}
      {/* Nested subagent stays visible even when parent tool body is collapsed. */}
      {tool.subagent ? (
        <div className="tool-subagent-wrap">
          <SubAgentCard
            subagent={tool.subagent}
            forceOpen={status === 'running' || tool.subagent.status === 'running'}
          />
        </div>
      ) : null}
    </div>
  )
}
