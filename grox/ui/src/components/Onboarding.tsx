import { useState, type FormEvent } from 'react'
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
      <form className="login-card" onSubmit={(e) => void onSubmit(e)}>
        <h1>
          <span className="brand-accent">Grox</span>
        </h1>
        <p className="muted">
          Sign in with your account. No API key setup needed for normal use.
        </p>
        <label className="field">
          <span>Username</span>
          <Input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username"
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
        <button
          type="button"
          className="login-advanced-toggle muted"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? 'Hide server URL' : 'Advanced: server URL'}
        </button>
        {showAdvanced ? (
          <label className="field">
            <span>Base URL</span>
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
          className="w-full"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  )
}
