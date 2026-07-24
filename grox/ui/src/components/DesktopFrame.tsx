import { useEffect, useState, type ReactNode } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { getGroxBridge } from '../api'

type Props = {
  children: ReactNode
}

export function DesktopFrame({ children }: Props) {
  const controls = getGroxBridge()?.windowControls
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!controls) return
    let active = true
    void controls.isMaximized().then((value) => {
      if (active) setMaximized(value)
    })
    const unsubscribe = controls.onMaximizedChange((value) => {
      if (active) setMaximized(value)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [controls])

  if (!controls) return <>{children}</>

  async function toggleMaximize() {
    if (!controls) return
    setMaximized(await controls.toggleMaximize())
  }

  return (
    <div className="desktop-frame">
      <header
        className="desktop-titlebar"
        onDoubleClick={() => void toggleMaximize()}
      >
        <div className="desktop-titlebar-brand" aria-label="Grox">
          <img src="/logo-mark.svg" alt="" draggable={false} />
          <span>Grox</span>
        </div>
        <div
          className="desktop-window-controls"
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="desktop-window-button"
            aria-label="Minimize"
            title="Minimize"
            onClick={() => controls.minimize()}
          >
            <Minus aria-hidden />
          </button>
          <button
            type="button"
            className="desktop-window-button"
            aria-label={maximized ? 'Restore' : 'Maximize'}
            title={maximized ? 'Restore' : 'Maximize'}
            onClick={() => void toggleMaximize()}
          >
            {maximized ? <Copy aria-hidden /> : <Square aria-hidden />}
          </button>
          <button
            type="button"
            className="desktop-window-button desktop-window-button--close"
            aria-label="Close"
            title="Close"
            onClick={() => controls.close()}
          >
            <X aria-hidden />
          </button>
        </div>
      </header>
      <main className="desktop-frame-content">{children}</main>
    </div>
  )
}
