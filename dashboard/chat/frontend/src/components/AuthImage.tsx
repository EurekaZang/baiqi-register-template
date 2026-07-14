import { useEffect, useState } from 'react'
import { getToken } from '../api'

type Props = {
  src?: string
  alt?: string
  title?: string
  className?: string
}

/** True for chat-service generated image paths that need auth. */
export function isGeneratedImageSrc(src: string | undefined | null): boolean {
  if (!src) return false
  return /\/api\/sessions\/[^/]+\/generated\/[^/?#]+/i.test(src)
}

/**
 * Render markdown images. Local generated URLs require Bearer/cookie auth,
 * so we fetch as blob and use an object URL. External URLs use a plain <img>.
 */
export function AuthImage({ src, alt, title, className }: Props) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const needsAuth = isGeneratedImageSrc(src)

  useEffect(() => {
    let revoked: string | null = null
    let cancelled = false

    async function load() {
      setError(null)
      setObjectUrl(null)
      if (!src) return
      if (!needsAuth) return

      const headers = new Headers()
      const token = getToken()
      if (token) headers.set('Authorization', `Bearer ${token}`)

      try {
        const res = await fetch(src, {
          headers,
          credentials: 'include',
        })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const blob = await res.blob()
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        revoked = url
        setObjectUrl(url)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load image')
      }
    }

    void load()
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [src, needsAuth])

  if (!src) return null

  if (!needsAuth) {
    return (
      <img
        src={src}
        alt={alt || ''}
        title={title}
        className={className}
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    )
  }

  if (error) {
    return (
      <span className="auth-image-error muted" title={error}>
        [image failed to load: {error}]
      </span>
    )
  }

  if (!objectUrl) {
    return <span className="auth-image-loading muted">Loading image…</span>
  }

  return (
    <img
      src={objectUrl}
      alt={alt || ''}
      title={title}
      className={className}
      loading="lazy"
    />
  )
}
