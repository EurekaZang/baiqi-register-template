import { useState } from 'react'
import type { Artifact } from '../lib/content'

type Props = {
  artifacts: Artifact[]
  open: boolean
  onClose: () => void
  activeId?: string | null
  onSelect?: (id: string) => void
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function ArtifactsPanel({
  artifacts,
  open,
  onClose,
  activeId,
  onSelect,
}: Props) {
  const [copied, setCopied] = useState(false)
  if (!open) return null

  const active =
    artifacts.find((a) => a.id === activeId) || artifacts[artifacts.length - 1] || null

  return (
    <aside className="artifacts-panel" aria-label="Artifacts">
      <div className="artifacts-head">
        <div>
          <div className="empty-kicker">Artifacts</div>
          <div className="artifacts-title">Code panels</div>
        </div>
        <button type="button" className="btn ghost icon-btn" onClick={onClose} title="Close">
          ×
        </button>
      </div>

      {artifacts.length === 0 ? (
        <div className="muted pad-sm">No code artifacts in this conversation yet.</div>
      ) : (
        <>
          <div className="artifacts-list">
            {artifacts.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`artifact-item ${active?.id === a.id ? 'active' : ''}`}
                onClick={() => onSelect?.(a.id)}
              >
                <span className="artifact-lang">{a.language}</span>
                <span className="artifact-name">{a.title}</span>
              </button>
            ))}
          </div>
          {active ? (
            <div className="artifact-view">
              <div className="artifact-view-bar">
                <span className="badge">{active.language}</span>
                <button
                  type="button"
                  className="btn ghost msg-action-btn"
                  onClick={() => {
                    void copyText(active.code).then((ok) => {
                      if (!ok) return
                      setCopied(true)
                      window.setTimeout(() => setCopied(false), 1200)
                    })
                  }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="artifact-code">{active.code}</pre>
            </div>
          ) : null}
        </>
      )}
    </aside>
  )
}
