import { useState, type FormEvent, type KeyboardEvent } from 'react'

type Props = {
  disabled?: boolean
  streaming?: boolean
  onSend: (text: string) => void
  onStop: () => void
  placeholder?: string
}

export function Composer({
  disabled,
  streaming,
  onSend,
  onStop,
  placeholder = 'Message the agent…',
}: Props) {
  const [text, setText] = useState('')

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
    <form className="composer" onSubmit={onSubmit}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={2}
        disabled={disabled}
      />
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
    </form>
  )
}
