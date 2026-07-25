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
    const element = elRef.current
    if (!enabled) {
      if (element) {
        element.style.height = ''
        element.style.top = ''
        element.style.position = ''
      }
      return
    }

    const vv = window.visualViewport
    if (!vv) return

    const apply = () => {
      if (!element) return
      const height = vv.height
      const offsetTop = vv.offsetTop
      element.style.position = 'fixed'
      element.style.left = '0'
      element.style.right = '0'
      element.style.top = `${offsetTop}px`
      element.style.height = `${height}px`
    }

    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    window.addEventListener('orientationchange', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      window.removeEventListener('orientationchange', apply)
      if (element) {
        element.style.height = ''
        element.style.top = ''
        element.style.left = ''
        element.style.right = ''
        element.style.position = ''
      }
    }
  }, [elRef, enabled])
}
