import { useEffect, useMemo, useRef, useState } from 'react'
import { Pin, PinOff, Pencil, Settings, Trash2, X } from 'lucide-react'
import type { SessionSummary } from '../api'
import { groupSessionsByDay } from '../lib/content'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Separator } from './ui/separator'
import { Tooltip } from './ui/tooltip'

type Props = {
  sessions: SessionSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
  onOpenSettings?: () => void
  /** e.g. "Plus · 1.2M / 5M tokens" from /v1/me */
  tierChip?: string | null
  /** docked = desktop flex child; drawer = off-canvas */
  variant?: 'docked' | 'drawer'
  open?: boolean
  onClose?: () => void
}

function shortTitle(s: SessionSummary): string {
  if (s.title && s.title !== 'New chat') return s.title
  const firstUser = (s.messages || []).find((m) => m.role === 'user')
  if (firstUser?.content) {
    const t = firstUser.content.trim().replace(/\s+/g, ' ')
    return t.length > 42 ? `${t.slice(0, 41)}…` : t
  }
  return s.title || 'New chat'
}

function shortCwd(cwd?: string): string {
  if (!cwd) return ''
  const parts = cwd.replace(/\/+$/, '').split('/')
  if (parts.length <= 2) return cwd
  return `…/${parts.slice(-2).join('/')}`
}

export function Sidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onTogglePin,
  onOpenSettings,
  tierChip,
  variant = 'docked',
  open = true,
  onClose,
}: Props) {
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter((s) => {
      const title = shortTitle(s).toLowerCase()
      return (
        title.includes(q) ||
        (s.model || '').toLowerCase().includes(q) ||
        (s.cwd || '').toLowerCase().includes(q)
      )
    })
  }, [sessions, query])

  const groups = useMemo(() => groupSessionsByDay(filtered), [filtered])

  function startRename(s: SessionSummary) {
    setEditingId(s.id)
    setDraftTitle(shortTitle(s))
  }

  function commitRename(id: string) {
    const t = draftTitle.trim()
    setEditingId(null)
    if (!t) return
    onRename(id, t)
  }

  function selectAndClose(id: string) {
    onSelect(id)
    onClose?.()
  }

  function newAndClose() {
    onNew()
    onClose?.()
  }

  useEffect(() => {
    if (variant !== 'drawer' || !open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [variant, open, onClose])

  // Move focus into the drawer when it opens; restore to ☰ trigger on close.
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (variant !== 'drawer') {
      wasOpenRef.current = false
      return
    }
    if (open) {
      closeBtnRef.current?.focus()
      wasOpenRef.current = true
      return
    }
    if (wasOpenRef.current) {
      const trigger = document.querySelector<HTMLElement>(
        '[aria-controls="chat-sidebar"]',
      )
      trigger?.focus()
    }
    wasOpenRef.current = false
  }, [variant, open])

  const aside = (
    <aside
      className={cn(
        'sidebar',
        variant === 'drawer' && 'sidebar--drawer',
        variant === 'drawer' && open && 'is-open',
      )}
      id="chat-sidebar"
      aria-hidden={variant === 'drawer' && !open ? true : undefined}
    >
      <div className="sidebar-brand">
        <div className="sidebar-brand-row">
          <a href="/" className="brand-link" title="Grox home">
            <span className="brand-accent">Grox</span>
          </a>
          {variant === 'drawer' ? (
            <Button
              ref={closeBtnRef}
              type="button"
              variant="ghost"
              size="sm"
              className="sidebar-drawer-close"
              aria-label="Close sidebar"
              onClick={() => onClose?.()}
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
        <div className="sidebar-sub muted">Agent workspace</div>
        {tierChip ? (
          <button
            type="button"
            className="tier-chip"
            title="Account tier and monthly usage"
            onClick={() => {
              onOpenSettings?.()
              onClose?.()
            }}
          >
            {tierChip}
          </button>
        ) : null}
      </div>

      <div className="sidebar-top">
        <Button className="w-full" onClick={newAndClose}>
          + New chat
        </Button>
        <label className="sidebar-search">
          <span className="sr-only">Search sessions</span>
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            spellCheck={false}
          />
        </label>
      </div>

      <div className="session-list">
        {filtered.length === 0 && (
          <div className="muted pad-sm">
            {sessions.length === 0 ? 'No sessions yet' : 'No matches'}
          </div>
        )}
        {groups.map((g, groupIndex) => (
          <div key={g.label} className="session-group">
            {groupIndex > 0 ? (
              <Separator className="session-group-sep mx-2 my-1 opacity-70" />
            ) : null}
            <div className="session-group-label">{g.label}</div>
            {g.items.map((s) => (
              <div
                key={s.id}
                className={`session-item ${s.id === activeId ? 'active' : ''} ${s.pinned ? 'pinned' : ''}`}
                onClick={() => selectAndClose(s.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') selectAndClose(s.id)
                }}
              >
                {editingId === s.id ? (
                  <Input
                    className="session-rename-input h-8"
                    value={draftTitle}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onBlur={() => commitRename(s.id)}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') commitRename(s.id)
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  />
                ) : (
                  <div className="session-title">
                    {s.pinned ? <Pin className="session-pin-icon" /> : null}
                    {shortTitle(s)}
                  </div>
                )}
                <div className="session-meta muted">
                  <span className="status-dot" data-status={s.status} />
                  <span className="session-model">{s.model}</span>
                  {s.cwd ? <span className="session-cwd">{shortCwd(s.cwd)}</span> : null}
                </div>
                <div className="session-actions">
                  <Tooltip content={s.pinned ? 'Unpin chat' : 'Pin chat'}>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        onTogglePin(s.id, !s.pinned)
                      }}
                    >
                      {s.pinned ? (
                        <PinOff className="h-3.5 w-3.5" />
                      ) : (
                        <Pin className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </Tooltip>
                  <Tooltip content="Rename">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        startRename(s)
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </Tooltip>
                  <Tooltip content="Delete">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(s.id)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-footer-meta muted">
          {sessions.length} chat{sessions.length === 1 ? '' : 's'}
          {sessions.some((s) => s.pinned)
            ? ` · ${sessions.filter((s) => s.pinned).length} pinned`
            : ''}
        </div>
        <Tooltip content="API and workspace settings">
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              onOpenSettings?.()
              onClose?.()
            }}
          >
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
        </Tooltip>
      </div>
    </aside>
  )

  if (variant === 'drawer') {
    return (
      <div
        className={cn('sidebar-drawer-root', open && 'is-open')}
        aria-hidden={!open}
        // Closed drawer must not contribute focusable controls to tab order.
        inert={!open ? true : undefined}
      >
        <button
          type="button"
          className="sidebar-drawer-backdrop"
          aria-label="Close sidebar"
          tabIndex={open ? 0 : -1}
          onClick={() => onClose?.()}
        />
        {aside}
      </div>
    )
  }

  return aside
}
