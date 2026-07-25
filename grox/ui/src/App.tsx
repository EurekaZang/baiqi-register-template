import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  fetchMe,
  getToken,
  hasAccountSession,
  listSessions,
  deleteSession,
  logoutAccount,
  patchSession,
  setToken,
  type MeResponse,
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

function sortSessions(items: SessionSummary[]): SessionSummary[] {
  return [...items].sort((a, b) => {
    const pinOrder = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
    if (pinOrder !== 0) return pinOrder
    return (b.updated_at || '').localeCompare(a.updated_at || '')
  })
}

/** Desktop / dev: always use local loopback token for agent API. */
function ensureLocalToken(): void {
  if (!getToken()) setToken(LOCAL_TOKEN)
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n >= 1_000_000) {
    const v = n / 1_000_000
    return `${v >= 10 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '')}M`
  }
  if (n >= 1_000) {
    const v = n / 1_000
    return `${v >= 10 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '')}k`
  }
  return String(Math.round(n))
}

function titleCaseTier(tier: string): string {
  const t = (tier || 'free').toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export default function App() {
  const isCompact = useMediaQuery('(max-width: 1024px)')
  const shellRef = useRef<HTMLDivElement>(null)
  useVisualViewportLock(shellRef, isCompact)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const [showLogin, setShowLogin] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draftMode, setDraftMode] = useState(true)
  const [me, setMe] = useState<MeResponse | null>(null)
  const meRequestIdRef = useRef(0)

  const refreshSessions = useCallback(async () => {
    const list = await listSessions()
    setSessions(list)
    return list
  }, [])

  const refreshMe = useCallback(async () => {
    const requestId = ++meRequestIdRef.current
    if (!hasAccountSession()) {
      setMe(null)
      return null
    }
    try {
      const profile = await fetchMe()
      if (requestId === meRequestIdRef.current) setMe(profile)
      return profile
    } catch (err) {
      if (requestId !== meRequestIdRef.current) return null
      setMe(null)
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        await logoutAccount()
        setSessions([])
        setActiveId(null)
        setDraftMode(true)
        setShowLogin(true)
      }
      return null
    }
  }, [])

  useEffect(() => {
    ensureLocalToken()
    const loggedIn = hasAccountSession()
    setShowLogin(!loggedIn)
    if (!loggedIn) {
      setReady(true)
      return
    }
    void Promise.all([
      refreshSessions().catch(() => {
        setSessions([])
      }),
      refreshMe(),
    ]).finally(() => setReady(true))
  }, [refreshSessions, refreshMe])

  useEffect(() => {
    if (!isCompact) setSidebarOpen(false)
  }, [isCompact])

  useEffect(() => {
    if (showLogin) return
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void refreshMe()
    }
    window.addEventListener('focus', refreshIfVisible)
    document.addEventListener('visibilitychange', refreshIfVisible)
    const intervalId = window.setInterval(refreshIfVisible, 30_000)
    return () => {
      window.removeEventListener('focus', refreshIfVisible)
      document.removeEventListener('visibilitychange', refreshIfVisible)
      window.clearInterval(intervalId)
    }
  }, [showLogin, refreshMe])

  function handleLoggedIn() {
    ensureLocalToken()
    setShowLogin(false)
    void refreshSessions().catch(() => setSessions([]))
    void refreshMe()
  }

  function handleSignedOut() {
    meRequestIdRef.current += 1
    setMe(null)
    setSessions([])
    setActiveId(null)
    setDraftMode(true)
    setShowLogin(true)
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
        return sortSessions(next)
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
      if (idx < 0) return sortSessions([session, ...prev])
      const next = [...prev]
      next[idx] = { ...next[idx], ...session }
      return sortSessions(next)
    })
  }

  if (!ready) {
    return (
      <div className="app-shell center">
        <div className="muted">Loading…</div>
      </div>
    )
  }

  if (showLogin) {
    return <Onboarding onComplete={handleLoggedIn} />
  }

  const tier = me?.effective_tier || me?.tier || ''
  const used = me?.usage?.used ?? 0
  const limit = me?.usage?.limit ?? 0
  const tierChip =
    me && tier
      ? `${titleCaseTier(tier)} · ${formatTokens(used)}${
          limit > 0 ? ` / ${formatTokens(limit)}` : ''
        } tokens`
      : null

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
        tierChip={tierChip}
        variant={isCompact ? 'drawer' : 'docked'}
        open={isCompact ? sidebarOpen : true}
        onClose={() => setSidebarOpen(false)}
      />
      <ChatView
        sessionId={draftMode ? null : activeId}
        draftMode={draftMode || !activeId}
        onSessionCreated={handleSessionCreated}
        onSessionUpdated={handleSessionUpdated}
        onUsageChanged={() => void refreshMe()}
        isCompact={isCompact}
        onOpenSidebar={() => setSidebarOpen(true)}
        sidebarOpen={isCompact ? sidebarOpen : false}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSignedOut={handleSignedOut}
        me={me}
      />
    </div>
  )
}
