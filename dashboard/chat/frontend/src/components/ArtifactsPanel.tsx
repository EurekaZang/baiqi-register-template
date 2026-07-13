import { useMemo, useState } from 'react'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { Code2, Copy, Eye, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { Artifact } from '../lib/content'
import { buildPreviewHtml } from '../lib/content'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'

const PANEL_SPRING = { type: 'spring' as const, stiffness: 380, damping: 34, mass: 0.85 }

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
  const [mode, setMode] = useState<'code' | 'preview'>('code')
  const [listParent] = useAutoAnimate({ duration: 160, easing: 'ease-out' })
  const reduceMotion = useReducedMotion()

  const active =
    artifacts.find((a) => a.id === activeId) || artifacts[artifacts.length - 1] || null

  const previewHtml = useMemo(
    () => (active ? buildPreviewHtml(active) : ''),
    [active],
  )

  const canPreview = !!active?.previewable

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.aside
          key="artifacts-panel"
          className="artifacts-panel"
          aria-label="Artifacts"
          initial={
            reduceMotion
              ? { opacity: 0 }
              : { opacity: 0, x: 28, width: 0 }
          }
          animate={
            reduceMotion
              ? { opacity: 1 }
              : { opacity: 1, x: 0, width: 'var(--artifacts-w)' }
          }
          exit={
            reduceMotion
              ? { opacity: 0 }
              : { opacity: 0, x: 20, width: 0 }
          }
          transition={PANEL_SPRING}
          style={{ overflow: 'hidden' }}
        >
          <div className="artifacts-panel-inner">
            <div className="artifacts-head">
              <div>
                <div className="empty-kicker">Artifacts</div>
                <div className="artifacts-title">Code panels</div>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} title="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>

            {artifacts.length === 0 ? (
              <div className="muted pad-sm">
                No code artifacts in this conversation yet.
              </div>
            ) : (
              <>
                <div className="artifacts-list" ref={listParent}>
                  {artifacts.map((a) => (
                    <Button
                      key={a.id}
                      type="button"
                      variant={active?.id === a.id ? 'secondary' : 'ghost'}
                      className={`artifact-item h-auto w-full justify-start px-2.5 py-2 ${active?.id === a.id ? 'active' : ''}`}
                      onClick={() => {
                        onSelect?.(a.id)
                        setMode(a.previewable ? mode : 'code')
                      }}
                    >
                      <span className="artifact-lang">{a.language}</span>
                      <span className="artifact-name">{a.title}</span>
                      {a.previewable ? (
                        <span
                          className="artifact-previewable"
                          title="Preview available"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </span>
                      ) : null}
                    </Button>
                  ))}
                </div>
                {active ? (
                  <div className="artifact-view">
                    <div className="artifact-view-bar">
                      <div className="flex items-center gap-2">
                        <Badge variant="accent">{active.language}</Badge>
                        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-0.5">
                          <Button
                            size="sm"
                            variant={mode === 'code' ? 'secondary' : 'ghost'}
                            className="h-7 px-2"
                            onClick={() => setMode('code')}
                          >
                            <Code2 className="mr-1 h-3.5 w-3.5" />
                            Code
                          </Button>
                          <Button
                            size="sm"
                            variant={mode === 'preview' ? 'secondary' : 'ghost'}
                            className="h-7 px-2"
                            disabled={!canPreview}
                            title={
                              canPreview
                                ? 'Show sandboxed preview'
                                : 'Preview only for HTML/SVG/JSX'
                            }
                            onClick={() => canPreview && setMode('preview')}
                          >
                            <Eye className="mr-1 h-3.5 w-3.5" />
                            Preview
                          </Button>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          void copyText(active.code).then((ok) => {
                            if (!ok) return
                            setCopied(true)
                            window.setTimeout(() => setCopied(false), 1200)
                          })
                        }}
                      >
                        <Copy className="mr-1 h-3.5 w-3.5" />
                        {copied ? 'Copied' : 'Copy'}
                      </Button>
                    </div>
                    {mode === 'preview' && canPreview ? (
                      <iframe
                        title={`preview-${active.id}`}
                        className="artifact-preview-frame"
                        sandbox=""
                        srcDoc={previewHtml}
                      />
                    ) : (
                      <ScrollArea className="flex-1">
                        <pre className="artifact-code">{active.code}</pre>
                      </ScrollArea>
                    )}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}
