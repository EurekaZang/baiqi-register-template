import type { SessionSummary } from '../api'


type Props = {
  sessions: SessionSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
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

export function Sidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onLogout,
}: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button type="button" className="btn primary block" onClick={onNew}>
          + New chat
        </button>
      </div>
      <div className="session-list">
        {sessions.length === 0 && (
          <div className="muted pad-sm">No sessions yet</div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`session-item ${s.id === activeId ? 'active' : ''}`}
            onClick={() => onSelect(s.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onSelect(s.id)
            }}
          >
            <div className="session-title">{shortTitle(s)}</div>
            <div className="session-meta muted">
              <span className="status-dot" data-status={s.status} />
              {s.model}
            </div>
            <button
              type="button"
              className="btn ghost icon-btn delete-btn"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(s.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="sidebar-footer">
        <button type="button" className="btn ghost block" onClick={onLogout}>
          Log out
        </button>
      </div>
    </aside>
  )
}
