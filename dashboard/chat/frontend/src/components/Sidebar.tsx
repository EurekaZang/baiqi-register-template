import { useMemo, useState } from 'react'
import { LogOut, Pin, PinOff, Pencil, Trash2 } from 'lucide-react'
import type { SessionSummary } from '../api'
import { groupSessionsByDay } from '../lib/content'
import { Button } from './ui/button'
import { Input } from './ui/input'

type Props = {
  sessions: SessionSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
  onLogout: () => void
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
  onLogout,
}: Props) {
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

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

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <a href="/" className="brand-link" title="Back to dashboard">
          <span className="brand-accent">8090</span> Chat
        </a>
        <div className="sidebar-sub muted">Agent workspace</div>
      </div>

      <div className="sidebar-top">
        <Button className="w-full" onClick={onNew}>
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
        {groups.map((g) => (
          <div key={g.label} className="session-group">
            <div className="session-group-label">{g.label}</div>
            {g.items.map((s) => (
              <div
                key={s.id}
                className={`session-item ${s.id === activeId ? 'active' : ''} ${s.pinned ? 'pinned' : ''}`}
                onClick={() => onSelect(s.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelect(s.id)
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
                  <Button
                    variant="ghost"
                    size="icon"
                    title={s.pinned ? 'Unpin' : 'Pin'}
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
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Rename"
                    onClick={(e) => {
                      e.stopPropagation()
                      startRename(s)
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(s.id)
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
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
        <Button variant="ghost" className="w-full justify-start" onClick={onLogout}>
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </Button>
      </div>
    </aside>
  )
}
