import { useState, type FormEvent } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'

const DEFAULT_BASE_URL = 'https://kaggleyes.top/grokapi'

type Props = {
  onComplete: () => void
}

export function Onboarding({ onComplete }: Props) {
  const [baseUrl, setBaseUrl] = useState(() => {
    try {
      return localStorage.getItem('grox_base_url') || DEFAULT_BASE_URL
    } catch {
      return DEFAULT_BASE_URL
    }
  })
  const [apiKey, setApiKey] = useState(() => {
    try {
      return localStorage.getItem('grox_api_key') || ''
    } catch {
      return ''
    }
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const url = baseUrl.trim().replace(/\/+$/, '')
    const key = apiKey.trim()
    if (!url) {
      setError('Base URL is required')
      return
    }
    if (!key) {
      setError('API Key is required')
      return
    }
    setBusy(true)
    try {
      // Interim localStorage until Task 5 lands PUT /api/runtime-config.
      try {
        localStorage.setItem('grox_base_url', url)
        localStorage.setItem('grox_api_key', key)
        localStorage.setItem('grox_onboarded', '1')
      } catch {
        /* ignore storage failures in locked-down environments */
      }
      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings')
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
          Connect your Grok API to start coding with Grox. Settings stay local on
          this machine.
        </p>
        <label className="field">
          <span>Base URL</span>
          <Input
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={DEFAULT_BASE_URL}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>
        <label className="field">
          <span>API Key</span>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
            disabled={busy}
            autoComplete="off"
            required
          />
        </label>
        {error ? <div className="error-banner">{error}</div> : null}
        <Button
          type="submit"
          disabled={busy || !baseUrl.trim() || !apiKey.trim()}
          className="w-full"
        >
          {busy ? 'Saving…' : 'Continue'}
        </Button>
      </form>
    </div>
  )
}
