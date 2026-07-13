import { useEffect, useState } from 'react'
import { recentCwds } from '../api'
import { Input } from './ui/input'
import { Select } from './ui/select'

type Props = {
  value: string
  onChange: (cwd: string) => void
  disabled?: boolean
  /** When true, load recent list on mount */
  loadRecent?: boolean
}

export function CwdPicker({ value, onChange, disabled, loadRecent = true }: Props) {
  const [recent, setRecent] = useState<string[]>([])

  useEffect(() => {
    if (!loadRecent) return
    let cancelled = false
    recentCwds()
      .then((list) => {
        if (!cancelled) setRecent(list)
      })
      .catch(() => {
        if (!cancelled) setRecent([])
      })
    return () => {
      cancelled = true
    }
  }, [loadRecent])

  return (
    <div className="cwd-picker">
      <label className="field inline">
        <span>cwd</span>
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="/absolute/path/to/project"
          disabled={disabled}
          list="recent-cwds"
          spellCheck={false}
          className="font-mono text-xs"
        />
      </label>
      <datalist id="recent-cwds">
        {recent.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {recent.length > 0 && (
        <Select
          className="cwd-recent h-9 max-w-[150px] font-mono text-xs"
          value=""
          disabled={disabled}
          onChange={(e) => {
            if (e.target.value) onChange(e.target.value)
          }}
          aria-label="Recent working directories"
        >
          <option value="">Recent…</option>
          {recent.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      )}
    </div>
  )
}
