import { useState, type FormEvent } from 'react'
import { ArrowRight, ChevronDown, LockKeyhole } from 'lucide-react'
import {
  ApiError,
  DEFAULT_GROK_BASE_URL,
  getGrokBaseUrl,
  loginAccount,
} from '../api'
import { Button } from './ui/button'
import { Input } from './ui/input'

type Props = {
  onComplete: () => void
}

/**
 * Account login (username/password) against grokcli-2api.
 * Replaces the old API-key onboarding for normal users.
 */
export function Onboarding({ onComplete }: Props) {
  const [baseUrl, setBaseUrl] = useState(() => getGrokBaseUrl())
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const user = username.trim()
    if (!user) {
      setError('Username is required')
      return
    }
    if (!password) {
      setError('Password is required')
      return
    }
    setBusy(true)
    try {
      await loginAccount(user, password, baseUrl)
      onComplete()
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Login failed'
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-shell" onSubmit={(e) => void onSubmit(e)}>
        <section className="login-identity" aria-label="Grox">
          <div className="login-brand">
            <img src="/logo-mark.svg" alt="" draggable={false} />
            <span>GROX</span>
          </div>

          <div className="login-statement">
            <p className="login-eyebrow">DESKTOP CODING AGENT</p>
            <h1>
              Build.
              <br />
              Review.
              <br />
              Ship.
            </h1>
            <p>
              One focused workspace for turning intent into working software.
            </p>
          </div>

          <div className="login-identity-footer">
            <span className="login-signal" aria-hidden />
            <span>LOCAL WORKSPACE</span>
            <span className="login-footer-rule" aria-hidden />
            <span>FULL AUTO</span>
          </div>
        </section>

        <section className="login-card">
          <div className="login-card-topline">
            <span>ACCOUNT ACCESS</span>
            <span>G / 01</span>
          </div>

          <div className="login-card-heading">
            <p className="login-card-kicker">
              <LockKeyhole aria-hidden />
              SECURE SIGN IN
            </p>
            <h2>Welcome back.</h2>
            <p>Enter your Grox account to open the workspace.</p>
          </div>

          <div className="login-fields">
            <label className="field">
              <span>Username</span>
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Your username"
                disabled={busy}
                autoComplete="username"
                autoFocus
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={busy}
                autoComplete="current-password"
                required
              />
            </label>
          </div>

          <button
            type="button"
            className="login-advanced-toggle"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <span>Connection settings</span>
            <ChevronDown aria-hidden />
          </button>
          {showAdvanced ? (
            <label className="field login-advanced-field">
              <span>Server URL</span>
              <Input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={DEFAULT_GROK_BASE_URL}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          ) : null}
          {error ? <div className="error-banner login-error">{error}</div> : null}
          <Button
            type="submit"
            disabled={busy || !username.trim() || !password}
            className="login-submit"
          >
            <span>{busy ? 'Signing in…' : 'Enter workspace'}</span>
            <ArrowRight aria-hidden />
          </Button>

          <p className="login-footnote">
            Your account session is used only to connect this Grox workspace.
          </p>
        </section>
      </form>
    </div>
  )
}
