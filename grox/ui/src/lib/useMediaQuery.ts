import { useSyncExternalStore } from 'react'

/**
 * Subscribe to a CSS media query without a first-paint false flash.
 * Client snapshot reads matchMedia immediately; server snapshot is false.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () =>
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia(query).matches
        : false,
    () => false,
  )
}
