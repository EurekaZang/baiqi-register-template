import { useEffect, useState } from 'react'
import { listModels, type ModelItem } from '../api'

type Props = {
  value: string
  onChange: (model: string) => void
  disabled?: boolean
}

const FALLBACK_DEFAULT = 'grok-4.5'

export function ModelSelect({ value, onChange, disabled }: Props) {
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
        if (!value) {
          onChange(res.default || FALLBACK_DEFAULT)
        } else if (
          res.data?.length &&
          !res.data.some((m) => m.id === value) &&
          res.default
        ) {
          // keep current value even if not in list
        }
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

  const options =
    models.length > 0
      ? models
      : [{ id: value || FALLBACK_DEFAULT, display_name: value || FALLBACK_DEFAULT }]

  // Ensure current value is selectable
  if (value && !options.some((m) => m.id === value)) {
    options.unshift({ id: value, display_name: value })
  }

  return (
    <label className="field inline model-select">
      <span>Model</span>
      <select
        value={value || FALLBACK_DEFAULT}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        title={error ? `Models: ${error}` : stale ? 'Stale model list' : undefined}
      >
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.display_name || m.id}
          </option>
        ))}
      </select>
      {stale && <span className="badge warn">stale</span>}
    </label>
  )
}
