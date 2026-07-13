import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ToolCard as ToolCardType } from '../api'
import { Button } from './ui/button'
import { Badge } from './ui/badge'

type Props = {
  tool: ToolCardType
  /** When true, tool is still running (stream mid-flight). */
  running?: boolean
  defaultOpen?: boolean
}

function statusOf(tool: ToolCardType, running?: boolean): 'running' | 'done' | 'error' {
  if (running && tool.ok !== false && !tool.output_summary) return 'running'
  if (tool.ok === false) return 'error'
  return 'done'
}

export function ToolCardView({ tool, running, defaultOpen = false }: Props) {
  const status = statusOf(tool, running)
  const [open, setOpen] = useState(defaultOpen || status === 'error')

  return (
    <div className={`tool-card status-${status}`} data-open={open ? '1' : '0'}>
      <Button
        type="button"
        variant="ghost"
        className="tool-card-head h-auto w-full justify-start rounded-none px-3 py-2.5 hover:bg-slate-50"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={`tool-status-dot status-${status}`} aria-hidden />
        <span className="tool-name">{tool.name}</span>
        <Badge
          variant={
            status === 'error' ? 'danger' : status === 'running' ? 'accent' : 'success'
          }
          className="ml-auto"
        >
          {status === 'running' ? 'Running' : status === 'error' ? 'Failed' : 'Done'}
        </Badge>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
        )}
      </Button>
      {open && (
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
          ) : status === 'running' ? (
            <div className="tool-running-hint muted">
              <span className="shimmer-bar" />
              Waiting for tool result…
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
