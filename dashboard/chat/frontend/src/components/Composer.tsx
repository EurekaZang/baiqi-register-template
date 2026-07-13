import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { CornerDownLeft, Square } from 'lucide-react'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'

type Props = {
  disabled?: boolean
  streaming?: boolean
  onSend: (text: string) => void
  onStop: () => void
  placeholder?: string
  /** Controlled seed text (e.g. from suggestion chips). */
  seedText?: string
  onSeedConsumed?: () => void
  hint?: string
}

export function Composer({
  disabled,
  streaming,
  onSend,
  onStop,
  placeholder = 'Message the agent…',
  seedText,
  onSeedConsumed,
  hint,
}: Props) {
  const [text, setText] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (seedText == null) return
    setText(seedText)
    onSeedConsumed?.()
    requestAnimationFrame(() => {
      const el = taRef.current
      if (!el) return
      el.focus()
      el.selectionStart = el.value.length
      el.selectionEnd = el.value.length
    })
  }, [seedText, onSeedConsumed])

  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [text])

  function submit() {
    const t = text.trim()
    if (!t || disabled || streaming) return
    onSend(t)
    setText('')
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    submit()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="composer-shell">
      {hint ? <div className="composer-hint muted">{hint}</div> : null}
      <form className="composer" onSubmit={onSubmit}>
        <div
          className={`composer-main${streaming ? ' is-streaming' : ''}`}
        >
          <Textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={disabled}
            className="composer-textarea min-h-[44px] max-h-[200px] resize-none border-0 bg-transparent px-1 py-1 shadow-none focus-visible:ring-0"
          />
          <div className="composer-toolbar">
            <span className="composer-hotkey muted">
              Enter send · Shift+Enter newline
            </span>
            <div className="composer-actions">
              {streaming ? (
                <Button type="button" variant="danger" onClick={onStop}>
                  <Square className="h-3.5 w-3.5 fill-current" />
                  Stop
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={disabled || !text.trim()}
                >
                  Send
                  <CornerDownLeft className="h-3.5 w-3.5 opacity-80" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
