import { useEffect, useMemo, useState } from 'react'
import { listModels, type ModelItem } from '../api'
import { Badge } from './ui/badge'
import { Select } from './ui/select'

type Props = {
  value: string
  onChange: (model: string) => void
  disabled?: boolean
  compact?: boolean
}

const FALLBACK_DEFAULT = 'grok-4.5'

export function ModelSelect({ value, onChange, disabled, compact }: Props) {
  const [models, setModels] = useState<ModelItem[]>([])
  const [stale, setStale] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listModels()
      .then((res) => {
        if (cancelled) return
        setModels(res.data || [])
        setStale(!!res.stale)
        setError(null)
        if (!value) onChange(res.default || FALLBACK_DEFAULT)
      })
      .catch((err: Error) => {
        if (cancelled) return
        setError(err.message)
        setModels((prev) =>
          prev.length
            ? prev
            : [{ id: FALLBACK_DEFAULT, display_name: FALLBACK_DEFAULT }],
        )
        if (!value) onChange(FALLBACK_DEFAULT)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const options = useMemo(() => {
    const base =
      models.length > 0
        ? [...models]
        : [{ id: value || FALLBACK_DEFAULT, display_name: value || FALLBACK_DEFAULT }]
    if (value && !base.some((m) => m.id === value)) {
      base.unshift({ id: value, display_name: value })
    }
    return base
  }, [models, value])

  const current = options.find((m) => m.id === (value || FALLBACK_DEFAULT))

  return (
    <label className={`field model-select ${compact ? 'compact' : 'inline'}`}>
      {!compact ? <span>Model</span> : <span className="model-label">Model</span>}
      <div className="model-control">
        <Select
          value={value || FALLBACK_DEFAULT}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="min-w-[150px] font-mono text-xs"
          title={
            error
              ? `Models: ${error}`
              : stale
                ? 'Stale model list'
                : current?.display_name || value
          }
        >
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name || m.id}
            </option>
          ))}
        </Select>
        {stale ? <Badge variant="warn">stale</Badge> : null}
      </div>
    </label>
  )
}
