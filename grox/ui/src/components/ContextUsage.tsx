import { useMemo, useState } from 'react'
import { Gauge, Minimize2 } from 'lucide-react'
import type { ContextUsage as ContextUsageType } from '../api'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Tooltip } from './ui/tooltip'
import { cn } from '../lib/utils'

type Props = {
  usage?: ContextUsageType | null
  className?: string
  /** Show compact action when a compactable SDK session exists. */
  canCompact?: boolean
  compacting?: boolean
  onCompact?: () => void
}

export type ContextUsageDetailProps = {
  usage?: ContextUsageType | null
  canCompact?: boolean
  compacting?: boolean
  onCompact?: () => void
  className?: string
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

function levelOf(pct: number): 'ok' | 'warn' | 'hot' {
  if (pct >= 85) return 'hot'
  if (pct >= 65) return 'warn'
  return 'ok'
}

/** Detail body: summary, bar, categories, Compact button. Reused by meter popover + mobile sheet. */
export function ContextUsageDetail({
  usage,
  canCompact,
  compacting,
  onCompact,
  className,
}: ContextUsageDetailProps) {
  const pct = usage?.percentage ?? 0
  const level = levelOf(pct)
  const total = usage?.total_tokens ?? 0
  const max = usage?.max_tokens ?? 0
  const cats = useMemo(() => {
    const list = [...(usage?.categories || [])]
    list.sort((a, b) => (b.tokens || 0) - (a.tokens || 0))
    return list.slice(0, 8)
  }, [usage])

  if (!usage || !max) {
    return (
      <div className={cn('ctx-detail space-y-2', className)}>
        <p className="text-xs leading-relaxed text-neutral-500">
          Context usage appears after the first agent turn.
        </p>
        {canCompact ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1 w-full text-xs"
            disabled={compacting || !onCompact}
            onClick={() => onCompact?.()}
          >
            <Minimize2 className="h-3.5 w-3.5" />
            {compacting ? 'Compacting…' : 'Compact conversation'}
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn('ctx-detail space-y-2', className)}>
      <div className="ctx-popover-summary">
        <strong>{formatTokens(total)}</strong>
        <span className="muted"> / {formatTokens(max)}</span>
        {usage.raw_max_tokens && usage.raw_max_tokens !== max ? (
          <span className="muted"> · raw {formatTokens(usage.raw_max_tokens)}</span>
        ) : null}
      </div>
      <div className="ctx-popover-bar" aria-hidden>
        <span
          className={`fill level-${level}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      {cats.length > 0 ? (
        <ul className="ctx-cat-list">
          {cats.map((c) => {
            const share = max > 0 ? (100 * c.tokens) / max : 0
            return (
              <li key={c.name} className="ctx-cat-row">
                <span
                  className="ctx-cat-dot"
                  style={c.color ? { background: c.color } : undefined}
                />
                <span className="ctx-cat-name" title={c.name}>
                  {c.name}
                </span>
                <span className="ctx-cat-tokens">{formatTokens(c.tokens)}</span>
                <span className="ctx-cat-share muted">{share.toFixed(1)}%</span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-xs text-neutral-500">No category breakdown available.</p>
      )}
      {usage.model ? (
        <div className="ctx-popover-meta muted">model · {usage.model}</div>
      ) : null}
      {usage.auto_compact ? (
        <div className="ctx-popover-meta muted">
          autocompact on
          {usage.auto_compact_threshold
            ? ` · threshold ${formatTokens(usage.auto_compact_threshold)}`
            : ''}
        </div>
      ) : null}
      {canCompact ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-1 w-full text-xs"
          disabled={compacting || !onCompact}
          onClick={() => onCompact?.()}
        >
          <Minimize2 className="h-3.5 w-3.5" />
          {compacting ? 'Compacting…' : 'Compact conversation'}
        </Button>
      ) : null}
    </div>
  )
}

export function ContextUsageMeter({
  usage,
  className,
  canCompact,
  compacting,
  onCompact,
}: Props) {
  const [open, setOpen] = useState(false)

  const pct = usage?.percentage ?? 0
  const level = levelOf(pct)
  const total = usage?.total_tokens ?? 0
  const max = usage?.max_tokens ?? 0

  if (!usage || !max) {
    return (
      <div className={cn('ctx-meter-wrap', className)}>
        <Tooltip content="Context usage appears after the first agent turn">
          <div className="ctx-meter empty">
            <Gauge className="h-3.5 w-3.5 text-neutral-500" />
            <span className="ctx-meter-label">Context</span>
            <span className="ctx-meter-pct muted">—</span>
          </div>
        </Tooltip>
        {canCompact ? (
          <Tooltip content="Summarize conversation to free context (Claude /compact)">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ctx-compact-btn h-8 px-2.5 text-xs rounded-full"
              disabled={compacting || !onCompact}
              onClick={() => onCompact?.()}
            >
              <Minimize2 className={cn('h-3.5 w-3.5', compacting ? 'animate-pulse' : '')} />
              {compacting ? 'Compacting…' : 'Compact'}
            </Button>
          </Tooltip>
        ) : null}
      </div>
    )
  }

  const tip = `${formatTokens(total)} / ${formatTokens(max)} tokens · ${pct.toFixed(1)}% of context window`

  return (
    <div className={cn('ctx-meter-wrap', className)}>
      <div className="ctx-meter-row">
        <Tooltip content={tip}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn('ctx-meter', `level-${level}`, open ? 'open' : '')}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            <Gauge className="h-3.5 w-3.5" />
            <span className="ctx-meter-label">Context</span>
            <span className="ctx-meter-bar" aria-hidden>
              <span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
            </span>
            <span className="ctx-meter-pct">{pct.toFixed(pct >= 10 ? 0 : 1)}%</span>
          </Button>
        </Tooltip>
        {canCompact ? (
          <Tooltip content="Summarize conversation to free context (Claude /compact)">
            <Button
              type="button"
              variant={level === 'hot' || level === 'warn' ? 'secondary' : 'outline'}
              size="sm"
              className="ctx-compact-btn h-8 px-2.5 text-xs rounded-full"
              disabled={compacting || !onCompact}
              onClick={() => onCompact?.()}
            >
              <Minimize2 className={cn('h-3.5 w-3.5', compacting ? 'animate-pulse' : '')} />
              {compacting ? 'Compacting…' : 'Compact'}
            </Button>
          </Tooltip>
        ) : null}
      </div>

      {open ? (
        <Card className="ctx-popover shadow-lg">
          <CardHeader className="flex-row items-center justify-between space-y-0 p-3 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Gauge className="h-4 w-4 text-white" />
              Context window
            </CardTitle>
            <Badge
              variant={level === 'hot' ? 'danger' : level === 'warn' ? 'warn' : 'accent'}
              className="text-[10px]"
            >
              {pct.toFixed(1)}%
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2 p-3 pt-0">
            <ContextUsageDetail
              usage={usage}
              canCompact={canCompact}
              compacting={compacting}
              onCompact={onCompact}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
