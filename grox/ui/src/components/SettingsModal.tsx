import { useEffect, useRef, useState, type FormEvent } from 'react'
import { FolderOpen, X } from 'lucide-react'
import { getRuntimeConfig, putRuntimeConfig } from '../api'
import { Button } from './ui/button'
import { Input } from './ui/input'

const DEFAULT_BASE_URL = 'https://kaggleyes.top/grokapi'

type GroxBridge = {
  openDataDir?: () => void | Promise<void>
  apiBase?: string
}

type Props = {
  open: boolean
  onClose: () => void
}

export function SettingsModal({ open, onClose }: Props) {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL)
  const [apiKey, setApiKey] = useState('')
  const [apiKeySet, setApiKeySet] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    setSaved(false)
    setApiKey('')
    ;(async () => {
      try {
        const cfg = await getRuntimeConfig()
        if (cancelled) return
        setBaseUrl(cfg.base_url || DEFAULT_BASE_URL)
        setApiKeySet(Boolean(cfg.api_key_set))
      } catch {
        if (cancelled) return
        try {
          setBaseUrl(localStorage.getItem('grox_base_url') || DEFAULT_BASE_URL)
          const localKey = localStorage.getItem('grox_api_key') || ''
          setApiKey(localKey)
          setApiKeySet(Boolean(localKey.trim()))
        } catch {
          setBaseUrl(DEFAULT_BASE_URL)
          setApiKey('')
          setApiKeySet(false)
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
    const key = apiKey.trim()
    if (!url) {
      setError('Base URL is required')
      return
    }
    if (!key && !apiKeySet) {
      setError('API Key is required')
      return
    }
    setBusy(true)
    try {
      const body: { base_url: string; api_key?: string } = { base_url: url }
      if (key) body.api_key = key
      await putRuntimeConfig(body)
      try {
        localStorage.setItem('grox_base_url', url)
        if (key) localStorage.setItem('grox_api_key', key)
        localStorage.setItem('grox_onboarded', '1')
      } catch {
        /* ignore */
      }
      if (key) {
        setApiKeySet(true)
        setApiKey('')
      }
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings')
    } finally {
      setBusy(false)
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
          <label className="field">
            <span>Base URL</span>
            <Input
              type="url"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value)
                setSaved(false)
              }}
              placeholder={DEFAULT_BASE_URL}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          <label className="field">
            <span>API Key{apiKeySet ? ' (leave blank to keep)' : ''}</span>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value)
                setSaved(false)
              }}
              placeholder={apiKeySet ? '•••••••• (set)' : 'sk-…'}
              disabled={busy}
              autoComplete="off"
              required={!apiKeySet}
            />
          </label>
          <p className="settings-note muted">
            Theme is fixed to 8090 chat blue–white for this MVP.
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
              disabled={busy}
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              Open data folder
            </Button>
            <Button
              type="submit"
              disabled={busy || !baseUrl.trim() || (!apiKey.trim() && !apiKeySet)}
            >
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
