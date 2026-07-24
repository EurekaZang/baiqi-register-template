import { useState, type FormEvent } from 'react'
import { ApiError, login } from '../api'
import { Button } from './ui/button'
import { Input } from './ui/input'

type Props = {
  onSuccess: () => void
}

export function Login({ onSuccess }: Props) {
  const [token, setTokenValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(token.trim())
      onSuccess()
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
      <form className="login-card" onSubmit={onSubmit}>
        <h1>
          <span className="brand-accent">8090</span> Chat
        </h1>
        <p className="muted">Enter the shared chat token to continue.</p>
        <label className="field">
          <span>Token</span>
          <Input
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(e) => setTokenValue(e.target.value)}
            placeholder="CHAT_TOKEN"
            disabled={busy}
            required
          />
        </label>
        {error && <div className="error-banner">{error}</div>}
        <Button type="submit" disabled={busy || !token.trim()} className="w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  )
}
