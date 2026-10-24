// An image from a support message. The server checks who asks, so the bytes come through
// getBlob with the Bearer token and render from an object URL.
import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { getBlob } from '../../api/client'
import { Skeleton } from '../../ui'

export function SupportImage({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    let objectUrl: string | null = null
    getBlob(url).then(
      (blob) => {
        objectUrl = URL.createObjectURL(blob)
        if (live) setSrc(objectUrl)
        else URL.revokeObjectURL(objectUrl)
      },
      () => live && setFailed(true),
    )
    return () => {
      live = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])
  if (failed)
    return (
      <span className="sp-image sp-image-failed" role="img" aria-label={alt}>
        <ImageOff size={18} aria-hidden />
      </span>
    )
  if (!src) return <Skeleton className="sp-image" width="16rem" height="9rem" />
  return (
    <a href={src} target="_blank" rel="noopener" className="sp-image">
      <img src={src} alt={alt} loading="lazy" />
    </a>
  )
}
