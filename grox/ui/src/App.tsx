import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getToken,
  listSessions,
  deleteSession,
  patchSession,
  setToken,
  type SessionSummary,
} from './api'
import { ChatView } from './components/ChatView'
import { Onboarding } from './components/Onboarding'
import { SettingsModal } from './components/SettingsModal'
import { Sidebar } from './components/Sidebar'
import { cn } from './lib/utils'
import { useMediaQuery } from './lib/useMediaQuery'
import { useVisualViewportLock } from './lib/useVisualViewportLock'
import './App.css'
import './styles/grox-theme.css'

const LOCAL_TOKEN = 'grox-local-token'

function needsOnboarding(): boolean {
  try {
    const onboarded = localStorage.getItem('grox_onboarded') === '1'
    const apiKey = (localStorage.getItem('grox_api_key') || '').trim()
    return !onboarded || !apiKey
  } catch {
    return true
  }
}

/** Desktop / dev: always use local token — no login gate. */
function ensureLocalToken(): void {
  if (!getToken()) setToken(LOCAL_TOKEN)
}

export default function App() {
  const isCompact = useMediaQuery('(max-width: 1024px)')
  const shellRef = useRef<HTMLDivElement>(null)
  useVisualViewportLock(shellRef, isCompact)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draftMode, setDraftMode] = useState(true)

  const refreshSessions = useCallback(async () => {
    const list = await listSessions()
    setSessions(list)
    return list
  }, [])

  useEffect(() => {
    ensureLocalToken()
    setShowOnboarding(needsOnboarding())
    refreshSessions()
      .catch(() => {
        // Agent may be offline during pure UI work; still enter shell with empty list.
        setSessions([])
      })
      .finally(() => setReady(true))
  }, [refreshSessions])

  useEffect(() => {
    if (!isCompact) setSidebarOpen(false)
  }, [isCompact])

  function handleOnboarded() {
    ensureLocalToken()
    setShowOnboarding(false)
    void refreshSessions().catch(() => setSessions([]))
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

  if (!ready) {
    return (
      <div className="app-shell center">
        <div className="muted">Loading…</div>
      </div>
    )
  }

  if (showOnboarding) {
    return <Onboarding onComplete={handleOnboarded} />
  }

  return (
    <div
      ref={shellRef}
      className={cn('app-shell', isCompact && 'is-compact')}
    >
      <Sidebar
        sessions={sessions}
        activeId={draftMode ? null : activeId}
        onSelect={handleSelect}
        onNew={handleNew}
        onDelete={(id) => void handleDelete(id)}
        onRename={(id, title) => void handleRename(id, title)}
        onTogglePin={(id, pinned) => void handleTogglePin(id, pinned)}
        onOpenSettings={() => setSettingsOpen(true)}
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
        sidebarOpen={isCompact ? sidebarOpen : false}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
