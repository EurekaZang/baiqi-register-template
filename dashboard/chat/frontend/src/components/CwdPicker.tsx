import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, History } from 'lucide-react'
import { recentCwds } from '../api'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Select } from './ui/select'
import { Tooltip } from './ui/tooltip'
import { cn } from '../lib/utils'

type Props = {
  value: string
  onChange: (cwd: string) => void
  /** Commit path (e.g. patch existing session). Called on blur / Enter / explicit pick. */
  onCommit?: (cwd: string) => void
  disabled?: boolean
  /** When true, load recent list on mount */
  loadRecent?: boolean
  className?: string
}

function normalizeCwdClient(raw: string): string {
  let text = raw.trim()
  if (!text) return ''
  text = text.replace(/\\/g, '/')
  while (text.includes('//')) text = text.replaceAll('//', '/')
  if (text.length > 1) text = text.replace(/\/+$/, '')
  return text
}

function shortPath(path: string): string {
  if (!path) return ''
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean)
  if (parts.length <= 3) return path
  return `…/${parts.slice(-3).join('/')}`
}

export function CwdPicker({
  value,
  onChange,
  onCommit,
  disabled,
  loadRecent = true,
  className,
}: Props) {
  const [recent, setRecent] = useState<string[]>([])
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (!loadRecent) return
    let cancelled = false
    recentCwds()
      .then((list) => {
        if (!cancelled) setRecent(Array.isArray(list) ? list : [])
      })
      .catch(() => {
        if (!cancelled) setRecent([])
      })
    return () => {
      cancelled = true
    }
  }, [loadRecent, value])

  const options = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const item of recent) {
      const n = normalizeCwdClient(item)
      if (!n || seen.has(n)) continue
      seen.add(n)
      out.push(n)
    }
    return out
  }, [recent])

  function validateLocal(path: string): string | null {
    const n = normalizeCwdClient(path)
    if (!n) return 'cwd is required'
    if (!(n.startsWith('/') || n === '~' || n.startsWith('~/'))) {
      return 'Use an absolute path (/…) or ~/'
    }
    return null
  }

  function commit(raw: string) {
    const next = normalizeCwdClient(raw)
    const err = validateLocal(next)
    setError(err)
    if (err) return
    onChange(next)
    onCommit?.(next)
  }

  return (
    <div className={cn('cwd-picker', className)}>
      <label className="field inline cwd-field">
        <span>cwd</span>
        <div className="cwd-input-wrap">
          <FolderOpen className="cwd-input-icon" aria-hidden />
          <Input
            type="text"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setError(null)
              // Keep parent draft state in sync for Send enablement, but do not
              // PATCH session until commit (blur/Enter/pick).
              onChange(e.target.value)
            }}
            onBlur={() => commit(draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit(draft)
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            placeholder="/absolute/path or ~/project"
            disabled={disabled}
            list="recent-cwds"
            spellCheck={false}
            autoComplete="off"
            className={cn(
              'cwd-input font-mono text-xs',
              error ? 'border-red-300 focus-visible:border-red-400' : '',
            )}
            title={error || draft || 'Working directory'}
          />
        </div>
      </label>

      <datalist id="recent-cwds">
        {options.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {options.length > 0 && (
        <Tooltip content="Choose a recent working directory">
          <div className="cwd-recent-wrap">
            <History className="cwd-recent-icon" aria-hidden />
            <Select
              className="cwd-recent h-9 font-mono text-xs"
              value=""
              disabled={disabled}
              onChange={(e) => {
                const v = e.target.value
                if (!v) return
                setDraft(v)
                commit(v)
              }}
              aria-label="Recent working directories"
            >
              <option value="">Recent…</option>
              {options.map((c) => (
                <option key={c} value={c} title={c}>
                  {shortPath(c)}
                </option>
              ))}
            </Select>
          </div>
        </Tooltip>
      )}

      {!draft.trim() && options[0] ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0 px-2 text-xs"
          disabled={disabled}
          onClick={() => {
            setDraft(options[0])
            commit(options[0])
          }}
        >
          Use last
        </Button>
      ) : null}

      {error ? <div className="cwd-error">{error}</div> : null}
    </div>
  )
}
