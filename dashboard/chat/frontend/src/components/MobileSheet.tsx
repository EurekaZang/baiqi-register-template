import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../lib/utils'
import { Button } from './ui/button'

export type MobileSheetHeight = 'auto' | 'half' | 'tall'

export type MobileSheetProps = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  height?: MobileSheetHeight
  className?: string
}

export function MobileSheet({
  open,
  onClose,
  title,
  children,
  height = 'half',
  className,
}: MobileSheetProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  return (
    <div className="mobile-sheet-root" role="presentation">
      <button
        type="button"
        className="mobile-sheet-backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={cn(
          'mobile-sheet-panel',
          `mobile-sheet-panel--${height}`,
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="mobile-sheet-handle" aria-hidden />
        <div className="mobile-sheet-head">
          <h2 id={titleId} className="mobile-sheet-title">
            {title}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mobile-sheet-close"
            onClick={onClose}
            aria-label="Close sheet"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="mobile-sheet-body">{children}</div>
      </div>
    </div>
  )
}
