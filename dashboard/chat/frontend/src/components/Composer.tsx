import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { CornerDownLeft, FileText, Image as ImageIcon, Paperclip, Square, X } from 'lucide-react'
import type { PathAttachment } from '../api'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Tooltip } from './ui/tooltip'

export type SendPayload = {
  text: string
  attachments: PathAttachment[]
}

type Props = {
  disabled?: boolean
  streaming?: boolean
  onSend: (payload: SendPayload) => void
  onStop: () => void
  placeholder?: string
  /** Controlled seed text (e.g. from suggestion chips). */
  seedText?: string
  onSeedConsumed?: () => void
  hint?: string
  /**
   * Optional path resolver (existing session). When absent, paths are accepted
   * as draft chips and validated on send by the backend.
   */
  resolvePath?: (path: string) => Promise<PathAttachment>
}

function shortName(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean)
  if (parts.length <= 2) return path
  return `…/${parts.slice(-2).join('/')}`
}

function kindIcon(kind?: string) {
  if (kind === 'image') return <ImageIcon className="h-3.5 w-3.5 text-sky-600" />
  return <FileText className="h-3.5 w-3.5 text-slate-500" />
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
  resolvePath,
}: Props) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<PathAttachment[]>([])
  const [pathDraft, setPathDraft] = useState('')
  const [pathOpen, setPathOpen] = useState(false)
  const [pathError, setPathError] = useState<string | null>(null)
  const [pathBusy, setPathBusy] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const pathRef = useRef<HTMLInputElement>(null)

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

  useEffect(() => {
    if (pathOpen) {
      requestAnimationFrame(() => pathRef.current?.focus())
    }
  }, [pathOpen])

  async function addPath(raw: string) {
    const path = raw.trim().replace(/^@/, '')
    if (!path) return
    setPathError(null)
    if (attachments.some((a) => a.path === path || a.path.endsWith(`/${path}`))) {
      setPathDraft('')
      return
    }
    setPathBusy(true)
    try {
      let item: PathAttachment
      if (resolvePath) {
        item = await resolvePath(path)
      } else {
        // Draft / offline: accept as-is; backend validates on send.
        const name = path.split('/').filter(Boolean).pop() || path
        const lower = name.toLowerCase()
        const kind =
          /\.(png|jpe?g|webp|gif)$/.test(lower)
            ? 'image'
            : /\.(txt|md|json|ya?ml|py|ts|tsx|js|jsx|css|html|log|sh)$/.test(lower)
              ? 'text'
              : 'file'
        item = { type: 'path', path, name, kind }
      }
      setAttachments((prev) => {
        if (prev.some((a) => a.path === item.path)) return prev
        return [...prev, { ...item, type: 'path' }]
      })
      setPathDraft('')
      setPathOpen(false)
    } catch (err) {
      setPathError(err instanceof Error ? err.message : 'Invalid path')
    } finally {
      setPathBusy(false)
    }
  }

  function removeAttachment(path: string) {
    setAttachments((prev) => prev.filter((a) => a.path !== path))
  }

  function submit() {
    const t = text.trim()
    if ((!t && attachments.length === 0) || disabled || streaming) return
    onSend({ text: t, attachments })
    setText('')
    setAttachments([])
    setPathDraft('')
    setPathOpen(false)
    setPathError(null)
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

  const canSend = !disabled && !streaming && (!!text.trim() || attachments.length > 0)

  return (
    <div className="composer-shell">
      {hint ? <div className="composer-hint muted">{hint}</div> : null}
      <form className="composer" onSubmit={onSubmit}>
        <div className={`composer-main${streaming ? ' is-streaming' : ''}`}>
          {attachments.length > 0 ? (
            <div className="composer-attach-row" aria-label="Attached project paths">
              {attachments.map((a) => (
                <span key={a.path} className="attach-chip" title={a.path}>
                  {kindIcon(a.kind)}
                  <span className="attach-chip-name">{shortName(a.path)}</span>
                  <button
                    type="button"
                    className="attach-chip-x"
                    aria-label={`Remove ${a.path}`}
                    disabled={streaming || disabled}
                    onClick={() => removeAttachment(a.path)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {pathOpen ? (
            <div className="composer-path-add">
              <Input
                ref={pathRef}
                value={pathDraft}
                onChange={(e) => {
                  setPathDraft(e.target.value)
                  setPathError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void addPath(pathDraft)
                  }
                  if (e.key === 'Escape') {
                    setPathOpen(false)
                    setPathDraft('')
                    setPathError(null)
                  }
                }}
                placeholder="Project path under cwd, e.g. src/ui.png or docs/a.md"
                disabled={disabled || streaming || pathBusy}
                className="h-8 font-mono text-xs"
                spellCheck={false}
                autoComplete="off"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-8 shrink-0"
                disabled={disabled || streaming || pathBusy || !pathDraft.trim()}
                onClick={() => void addPath(pathDraft)}
              >
                {pathBusy ? '…' : 'Add'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 shrink-0"
                onClick={() => {
                  setPathOpen(false)
                  setPathDraft('')
                  setPathError(null)
                }}
              >
                Cancel
              </Button>
            </div>
          ) : null}
          {pathError ? <div className="composer-path-error">{pathError}</div> : null}

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
            <div className="composer-toolbar-left">
              <Tooltip content="Attach a path under the session cwd (image/text/code)">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  disabled={disabled || streaming}
                  onClick={() => setPathOpen((v) => !v)}
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  Path
                </Button>
              </Tooltip>
              <span className="composer-hotkey muted">
                Enter send · Shift+Enter newline · Path = project files
              </span>
            </div>
            <div className="composer-actions">
              {streaming ? (
                <Button type="button" variant="danger" onClick={onStop}>
                  <Square className="h-3.5 w-3.5 fill-current" />
                  Stop
                </Button>
              ) : (
                <Button type="submit" disabled={!canSend}>
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
