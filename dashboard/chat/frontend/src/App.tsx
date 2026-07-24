import { useCallback, useEffect, useState } from 'react'
import {
  clearToken,
  getToken,
  listSessions,
  deleteSession,
  patchSession,
  type SessionSummary,
} from './api'
import { ChatView } from './components/ChatView'
import { Login } from './components/Login'
import { Sidebar } from './components/Sidebar'
import { cn } from './lib/utils'
import { useMediaQuery } from './lib/useMediaQuery'
import './App.css'

type AuthState = 'checking' | 'need-login' | 'ok'

export default function App() {
  const isCompact = useMediaQuery('(max-width: 1024px)')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [auth, setAuth] = useState<AuthState>('checking')
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draftMode, setDraftMode] = useState(true)

  const refreshSessions = useCallback(async () => {
    const list = await listSessions()
    setSessions(list)
    return list
  }, [])

  useEffect(() => {
    const token = getToken()
    if (!token) {
      setAuth('need-login')
      return
    }
    refreshSessions()
      .then(() => setAuth('ok'))
      .catch(() => {
        clearToken()
        setAuth('need-login')
      })
  }, [refreshSessions])

  useEffect(() => {
    if (!isCompact) setSidebarOpen(false)
  }, [isCompact])

  function handleLoginOk() {
    setAuth('ok')
    setDraftMode(true)
    setActiveId(null)
    void refreshSessions()
  }

  function handleLogout() {
    clearToken()
    setSessions([])
    setActiveId(null)
    setDraftMode(true)
    setAuth('need-login')
  }

  function handleNew() {
    setActiveId(null)
    setDraftMode(true)
  }

  function handleSelect(id: string) {
    setActiveId(id)
    setDraftMode(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this session?')) return
    await deleteSession(id)
    const list = await refreshSessions()
    if (activeId === id) {
      setActiveId(list[0]?.id ?? null)
      setDraftMode(!list[0])
    }
  }

  async function handleRename(id: string, title: string) {
    try {
      const updated = await patchSession(id, { title })
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === id)
        if (idx < 0) return prev
        const next = [...prev]
        next[idx] = { ...next[idx], ...updated }
        return next
      })
    } catch {
      /* ignore rename failure in UI */
    }
  }

  async function handleTogglePin(id: string, pinned: boolean) {
    try {
      const updated = await patchSession(id, { pinned })
      setSessions((prev) => {
        const next = prev.map((s) => (s.id === id ? { ...s, ...updated } : s))
        return next.sort((a, b) => {
          const ap = a.pinned ? 0 : 1
          const bp = b.pinned ? 0 : 1
          if (ap !== bp) return ap - bp
          return (b.updated_at || '').localeCompare(a.updated_at || '')
        })
      })
    } catch {
      /* ignore pin failure */
    }
  }

  function handleSessionCreated(session: SessionSummary) {
    setActiveId(session.id)
    setDraftMode(false)
    void refreshSessions()
  }

  function handleSessionUpdated(session: SessionSummary) {
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === session.id)
      if (idx < 0) return [session, ...prev]
      const next = [...prev]
      next[idx] = { ...next[idx], ...session }
      return next.sort((a, b) =>
        (b.updated_at || '').localeCompare(a.updated_at || ''),
      )
    })
  }

  if (auth === 'checking') {
    return (
      <div className="app-shell center">
        <div className="muted">Loading…</div>
      </div>
    )
  }

  if (auth === 'need-login') {
    return <Login onSuccess={handleLoginOk} />
  }

  return (
    <div className={cn('app-shell', isCompact && 'is-compact')}>
      <Sidebar
        sessions={sessions}
        activeId={draftMode ? null : activeId}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={(id) => void handleDelete(id)}
        onRename={(id, title) => void handleRename(id, title)}
        onTogglePin={(id, pinned) => void handleTogglePin(id, pinned)}
        onLogout={handleLogout}
        variant={isCompact ? 'drawer' : 'docked'}
        open={isCompact ? sidebarOpen : true}
        onClose={() => setSidebarOpen(false)}
      />
      <ChatView
        sessionId={draftMode ? null : activeId}
        draftMode={draftMode || !activeId}
        onSessionCreated={handleSessionCreated}
        onSessionUpdated={handleSessionUpdated}
        isCompact={isCompact}
        onOpenSidebar={() => setSidebarOpen(true)}
      />
    </div>
  )
}
