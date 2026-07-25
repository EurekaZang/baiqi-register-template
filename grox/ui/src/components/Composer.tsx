import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import {
  CornerDownLeft,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Square,
  Upload,
  X,
} from 'lucide-react'
import type { PathAttachment } from '../api'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Tooltip } from './ui/tooltip'

export type ComposerMode = 'chat' | 'image'

export type SendPayload = {
  text: string
  attachments: PathAttachment[]
  mode?: ComposerMode
}

type Props = {
  disabled?: boolean
  streaming?: boolean
  /** Image generation in flight (no Stop; disables composer). */
  imageBusy?: boolean
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
  /** Upload dragged/selected browser files into session cwd. */
  uploadFile?: (file: File) => Promise<PathAttachment>
  /** Compact layout tweaks (phone / narrow shell). */
  compact?: boolean
  /** Shown when cwd missing on draft. */
  missingCwd?: boolean
  onRequestCwd?: () => void
}

function shortName(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean)
  if (parts.length <= 2) return path
  return `…/${parts.slice(-2).join('/')}`
}

function kindIcon(kind?: string) {
  if (kind === 'image') return <ImageIcon className="h-3.5 w-3.5 text-white" />
  return <FileText className="h-3.5 w-3.5 text-neutral-500" />
}

function extForMime(mime: string): string {
  const m = (mime || '').toLowerCase()
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  if (m.includes('png')) return 'png'
  return 'png'
}

/** Collect image files from a paste event (screenshots + copied image files). */
function imagesFromClipboard(e: ClipboardEvent): File[] {
  const out: File[] = []
  const cd = e.clipboardData
  if (!cd) return out

  // 1) Explicit file list (copied files from file manager)
  if (cd.files && cd.files.length > 0) {
    for (const f of Array.from(cd.files)) {
      if (f.type.startsWith('image/')) out.push(f)
    }
  }

  // 2) ClipboardItem blobs (OS screenshot / browser copy image)
  if (cd.items && cd.items.length > 0) {
    for (const item of Array.from(cd.items)) {
      if (item.kind !== 'file') continue
      if (!item.type.startsWith('image/')) continue
      const blob = item.getAsFile()
      if (!blob) continue
      // Avoid duplicates when both files + items expose the same image.
      const already = out.some(
        (f) => f.size === blob.size && f.type === blob.type && f.name === blob.name,
      )
      if (already) continue
      if (blob.name && blob.name !== 'image.png' && blob.name !== 'blob') {
        out.push(blob)
      } else {
        const ext = extForMime(blob.type || 'image/png')
        const stamp = new Date()
          .toISOString()
          .replace(/[:.]/g, '-')
          .replace('T', '_')
          .slice(0, 19)
        out.push(
          new File([blob], `paste-${stamp}.${ext}`, {
            type: blob.type || 'image/png',
            lastModified: Date.now(),
          }),
        )
      }
    }
  }
  return out
}

export function Composer({
  disabled,
  streaming,
  imageBusy,
  onSend,
  onStop,
  placeholder = 'Message Grox…',
  seedText,
  onSeedConsumed,
  hint,
  resolvePath,
  uploadFile,
  compact = false,
  missingCwd = false,
  onRequestCwd,
}: Props) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<PathAttachment[]>([])
  const [pathDraft, setPathDraft] = useState('')
  const [pathOpen, setPathOpen] = useState(false)
  const [pathError, setPathError] = useState<string | null>(null)
  const [pathBusy, setPathBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  // MVP: chat-only; Image mode hard-hidden (type kept for API compatibility).
  const taRef = useRef<HTMLTextAreaElement>(null)
  const pathRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const busy = !!streaming || !!imageBusy
  const imageMode = false

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

  function pushAttachment(item: PathAttachment) {
    setAttachments((prev) => {
      if (prev.some((a) => a.path === item.path)) return prev
      if (prev.length >= 12) return prev
      return [...prev, { ...item, type: 'path' }]
    })
  }

  async function handleFiles(fileList: FileList | File[] | null) {
    if (!fileList || disabled || busy) return
    const files = Array.from(fileList as ArrayLike<File>)
    if (!files.length) return
    if (!uploadFile) {
      setPathError('Set cwd and open/create a chat first, then paste or drop files.')
      return
    }
    setUploadBusy(true)
    setPathError(null)
    const errors: string[] = []
    try {
      for (const file of files.slice(0, 12)) {
        try {
          const item = await uploadFile(file)
          pushAttachment(item)
        } catch (err) {
          errors.push(
            `${file.name}: ${err instanceof Error ? err.message : 'upload failed'}`,
          )
        }
      }
    } finally {
      setUploadBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
    if (errors.length) setPathError(errors.slice(0, 3).join(' · '))
  }

  function onPaste(e: ClipboardEvent) {
    if (imageMode || disabled || busy || uploadBusy) return
    const images = imagesFromClipboard(e)
    if (!images.length) return
    // Keep text paste behavior when clipboard is text-only; for images
    // swallow default so binary/placeholder text doesn't enter the box.
    e.preventDefault()
    e.stopPropagation()
    void handleFiles(images)
  }

  function onDragEnter(e: DragEvent) {
    if (imageMode) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current += 1
    if (e.dataTransfer?.types?.includes('Files')) setDragOver(true)
  }

  function onDragLeave(e: DragEvent) {
    if (imageMode) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragOver(false)
  }

  function onDragOver(e: DragEvent) {
    if (imageMode) return
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }

  function onDrop(e: DragEvent) {
    if (imageMode) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setDragOver(false)
    void handleFiles(e.dataTransfer?.files || null)
  }

  function submit() {
    const t = text.trim()
    if (disabled || busy || uploadBusy) return
    if (imageMode) {
      if (!t) return
      onSend({ text: t, attachments: [], mode: 'image' })
      setText('')
      setPathOpen(false)
      setPathDraft('')
      setPathError(null)
      return
    }
    if (!t && attachments.length === 0) return
    onSend({ text: t, attachments, mode: 'chat' })
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

  const canSend = imageMode
    ? !disabled && !busy && !uploadBusy && !!text.trim()
    : !disabled &&
      !busy &&
      !uploadBusy &&
      (!!text.trim() || attachments.length > 0)

  const effectivePlaceholder = imageMode
    ? 'Describe an image to generate…'
    : placeholder

  // On compact, skip idle long hints; keep missing-cwd / busy / error-like hints.
  const showHint =
    !!hint &&
    (!compact || missingCwd || !!imageBusy || !!streaming || !!pathError)

  return (
    <div
      className={cn(
        'composer-shell',
        compact && 'composer-shell--compact',
        dragOver && !imageMode && 'is-dragover',
        imageMode && 'is-image-mode',
      )}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onPaste={onPaste}
    >
      {missingCwd ? (
        <button
          type="button"
          className="composer-cwd-cta"
          onClick={() => onRequestCwd?.()}
        >
          Set working directory to start chatting
        </button>
      ) : null}
      {showHint ? <div className="composer-hint muted">{hint}</div> : null}
      {dragOver && !imageMode ? (
        <div className="composer-drop-overlay" aria-hidden>
          <Upload className="h-5 w-5" />
          Drop files to attach under cwd
        </div>
      ) : null}
      <form className="composer" onSubmit={onSubmit}>
        <div
          className={`composer-main${busy ? ' is-streaming' : ''}${dragOver && !imageMode ? ' drag-target' : ''}`}
        >
          {!imageMode && attachments.length > 0 ? (
            <div className="composer-attach-row" aria-label="Attached project paths">
              {attachments.map((a) => (
                <span key={a.path} className="attach-chip" title={a.path}>
                  {kindIcon(a.kind)}
                  <span className="attach-chip-name">{shortName(a.path)}</span>
                  <button
                    type="button"
                    className="attach-chip-x"
                    aria-label={`Remove ${a.path}`}
                    disabled={busy || disabled || uploadBusy}
                    onClick={() => removeAttachment(a.path)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {!imageMode && pathOpen ? (
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
                disabled={disabled || busy || pathBusy || uploadBusy}
                className="h-8 font-mono text-xs"
                spellCheck={false}
                autoComplete="off"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-8 shrink-0"
                disabled={
                  disabled || busy || pathBusy || uploadBusy || !pathDraft.trim()
                }
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
            onPaste={imageMode ? undefined : onPaste}
            placeholder={effectivePlaceholder}
            rows={1}
            disabled={disabled || !!imageBusy}
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
                  disabled={disabled || busy || uploadBusy}
                  onClick={() => setPathOpen((v) => !v)}
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  Path
                </Button>
              </Tooltip>
              <Tooltip
                content={
                  uploadFile
                    ? 'Upload files into .chat-attachments/ under cwd (or drag & drop / paste image)'
                    : 'Open/create a session with cwd first'
                }
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  disabled={disabled || busy || uploadBusy || !uploadFile}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" />
                  {uploadBusy ? 'Uploading…' : 'Upload'}
                </Button>
              </Tooltip>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.json,.py,.ts,.tsx,.js,.jsx,.css,.html,.log,.pdf"
                className="sr-only"
                disabled={disabled || busy || !uploadFile}
                onChange={(e) => void handleFiles(e.target.files)}
              />
              <span className="composer-hotkey muted">
                Enter send · paste image · drop files
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
