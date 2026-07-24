import { useEffect, useRef, useState, type FormEvent } from 'react'
import { FolderOpen, X } from 'lucide-react'
import {
  DEFAULT_GROK_BASE_URL,
  fetchMe,
  getGrokBaseUrl,
  getRuntimeConfig,
  getSessionToken,
  logoutAccount,
  putRuntimeConfig,
  setGrokBaseUrl,
  type MeResponse,
} from '../api'
import { Button } from './ui/button'
import { Input } from './ui/input'

type GroxBridge = {
  openDataDir?: () => void | Promise<void>
  apiBase?: string
}

type Props = {
  open: boolean
  onClose: () => void
  onSignedOut?: () => void
  me?: MeResponse | null
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

export function SettingsModal({ open, onClose, onSignedOut, me: meProp }: Props) {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_GROK_BASE_URL)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [me, setMe] = useState<MeResponse | null>(meProp ?? null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (meProp !== undefined) setMe(meProp)
  }, [meProp])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    setSaved(false)
    ;(async () => {
      try {
        const cfg = await getRuntimeConfig()
        if (cancelled) return
        setBaseUrl(cfg.base_url || getGrokBaseUrl() || DEFAULT_GROK_BASE_URL)
      } catch {
        if (cancelled) return
        setBaseUrl(getGrokBaseUrl() || DEFAULT_GROK_BASE_URL)
      }
      // Refresh /v1/me when modal opens (if session present).
      if (getSessionToken()) {
        try {
          const latest = await fetchMe()
          if (!cancelled) setMe(latest)
        } catch {
          /* ignore; chip/settings may show stale */
        }
      }
    })()
    requestAnimationFrame(() => closeBtnRef.current?.focus())
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    const url = baseUrl.trim().replace(/\/+$/, '')
    if (!url) {
      setError('Base URL is required')
      return
    }
    setBusy(true)
    try {
      setGrokBaseUrl(url)
      const session = getSessionToken()
      const body: { base_url: string; api_key?: string } = { base_url: url }
      // Keep agent Bearer in sync with account session when present.
      if (session) body.api_key = session
      await putRuntimeConfig(body)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings')
    } finally {
      setBusy(false)
    }
  }

  async function onSignOut() {
    setSigningOut(true)
    setError(null)
    try {
      await logoutAccount()
      onSignedOut?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign out failed')
    } finally {
      setSigningOut(false)
    }
  }

  function openDataFolder() {
    const bridge = (window as unknown as { grox?: GroxBridge }).grox
    if (bridge?.openDataDir) {
      void bridge.openDataDir()
      return
    }
    setError('Open data folder is available in the desktop app.')
  }

  if (!open) return null

  const tierLabel = me
    ? titleCaseTier(me.effective_tier || me.tier || 'free')
    : null
  const used = me?.usage?.used ?? 0
  const limit = me?.usage?.limit ?? 0
  const usageLabel =
    me && limit > 0
      ? `${formatTokens(used)} / ${formatTokens(limit)} tokens`
      : me
        ? `${formatTokens(used)} tokens`
        : null

  return (
    <div className="settings-modal-root" role="presentation">
      <button
        type="button"
        className="settings-modal-backdrop"
        aria-label="Close settings"
        onClick={onClose}
      />
      <div
        className="settings-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="settings-modal-head">
          <h2 id="settings-title" className="settings-modal-title">
            Settings
          </h2>
          <Button
            ref={closeBtnRef}
            type="button"
            variant="ghost"
            size="sm"
            className="settings-modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <form className="settings-modal-body" onSubmit={(e) => void onSubmit(e)}>
          {me ? (
            <div className="settings-account-card">
              <div className="settings-account-row">
                <span className="settings-account-label">Account</span>
                <span className="settings-account-value">
                  {me.user.display_name || me.user.username}
                </span>
              </div>
              <div className="settings-account-row">
                <span className="settings-account-label">Tier</span>
                <span className="settings-account-value">
                  {tierLabel}
                  {me.effective_tier &&
                  me.tier &&
                  me.effective_tier !== me.tier
                    ? ` (stored ${titleCaseTier(me.tier)})`
                    : ''}
                </span>
              </div>
              {usageLabel ? (
                <div className="settings-account-row">
                  <span className="settings-account-label">Usage</span>
                  <span className="settings-account-value">{usageLabel}</span>
                </div>
              ) : null}
              {me.usage?.period ? (
                <div className="settings-account-row">
                  <span className="settings-account-label">Period</span>
                  <span className="settings-account-value muted">
                    {me.usage.period}
                  </span>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="settings-note muted">
              Signed in with an account session. Tier and usage appear after
              /v1/me loads.
            </p>
          )}

          <label className="field">
            <span>Base URL</span>
            <Input
              type="url"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value)
                setSaved(false)
              }}
              placeholder={DEFAULT_GROK_BASE_URL}
              disabled={busy || signingOut}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          <p className="settings-note muted">
            Normal mode uses account login — API keys are not configured in the
            client. Theme is fixed to 8090 chat blue–white for this MVP.
          </p>
          {error ? <div className="error-banner settings-error">{error}</div> : null}
          {saved ? (
            <div className="settings-saved muted">Saved to agent process.</div>
          ) : null}
          <div className="settings-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={openDataFolder}
              disabled={busy || signingOut}
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              Open data folder
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void onSignOut()}
              disabled={busy || signingOut}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Button>
            <Button type="submit" disabled={busy || signingOut || !baseUrl.trim()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
