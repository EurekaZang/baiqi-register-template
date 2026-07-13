import { useState } from 'react'

type Props = {
  text: string
  defaultOpen?: boolean
}

export function ReasoningBlock({ text, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  if (!text.trim()) return null
  return (
    <div className={`reasoning-block ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="reasoning-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="reasoning-icon" aria-hidden>
          ◇
        </span>
        <span className="reasoning-title">Reasoning</span>
        <span className="reasoning-meta muted">
          {open ? 'Hide' : 'Show'} · {text.split(/\s+/).filter(Boolean).length} words
        </span>
        <span className="tool-chevron" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? (
        <div className="reasoning-body">
          <pre className="reasoning-pre">{text}</pre>
        </div>
      ) : null}
    </div>
  )
}
