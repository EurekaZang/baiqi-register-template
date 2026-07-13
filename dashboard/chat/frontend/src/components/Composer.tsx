import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'

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
    // focus after paint
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
        <div className="composer-main">
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={disabled}
          />
          <div className="composer-toolbar">
            <span className="composer-hotkey muted">Enter send · Shift+Enter newline</span>
            <div className="composer-actions">
              {streaming ? (
                <button type="button" className="btn danger" onClick={onStop}>
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  className="btn primary"
                  disabled={disabled || !text.trim()}
                >
                  Send
                </button>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
