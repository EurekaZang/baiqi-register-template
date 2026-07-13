import { useState } from 'react'
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react'
import { Button } from './ui/button'

type Props = {
  text: string
  defaultOpen?: boolean
}

export function ReasoningBlock({ text, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  if (!text.trim()) return null
  return (
    <div className={`reasoning-block ${open ? 'open' : ''}`}>
      <Button
        type="button"
        variant="ghost"
        className="reasoning-head h-auto w-full justify-start rounded-none px-3 py-2 hover:bg-slate-50"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Sparkles className="h-3.5 w-3.5 text-violet-500" />
        <span className="reasoning-title">Reasoning</span>
        <span className="reasoning-meta muted">
          {open ? 'Hide' : 'Show'} · {text.split(/\s+/).filter(Boolean).length} words
        </span>
        {open ? (
          <ChevronDown className="ml-auto h-3.5 w-3.5 text-slate-400" />
        ) : (
          <ChevronRight className="ml-auto h-3.5 w-3.5 text-slate-400" />
        )}
      </Button>
      {open ? (
        <div className="reasoning-body">
          <pre className="reasoning-pre">{text}</pre>
        </div>
      ) : null}
    </div>
  )
}
