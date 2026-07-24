import { useEffect, type RefObject } from 'react'

/**
 * When enabled, sizes `el` to the visualViewport height and offsets for keyboard.
 * No-ops when enabled=false or visualViewport missing.
 */
export function useVisualViewportLock(
  elRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) {
      const el = elRef.current
      if (el) {
        el.style.height = ''
        el.style.top = ''
        el.style.position = ''
      }
      return
    }

    const vv = window.visualViewport
    if (!vv) return

    const apply = () => {
      const el = elRef.current
      if (!el) return
      const height = vv.height
      const offsetTop = vv.offsetTop
      el.style.position = 'fixed'
      el.style.left = '0'
      el.style.right = '0'
      el.style.top = `${offsetTop}px`
      el.style.height = `${height}px`
    }

    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    window.addEventListener('orientationchange', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      window.removeEventListener('orientationchange', apply)
      const el = elRef.current
      if (el) {
        el.style.height = ''
        el.style.top = ''
        el.style.left = ''
        el.style.right = ''
        el.style.position = ''
      }
    }
  }, [elRef, enabled])
}
