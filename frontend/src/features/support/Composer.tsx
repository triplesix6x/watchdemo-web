// The message box of the support chat and the inbox: text, one optional image, Ctrl+Enter.
import { useId, useRef, useState, type ReactNode } from 'react'
import { ImagePlus, Send, X } from 'lucide-react'
import { useT } from '../../i18n'
import { Button, IconButton, Textarea } from '../../ui'

const TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024
const MAX_BODY = 4000

type Labels = { label: string; placeholder?: string; send: string; attach: string; removeImage: string; hint: string }

/** `onSend` resolves true when the message went out; the box then clears. */
export function Composer({
  labels,
  onSend,
  disabled,
  extra,
  tone,
}: {
  labels: Labels
  onSend: (body: string, image: File | null) => Promise<boolean>
  disabled?: boolean
  /** Controls between the attach button and Send (the inbox puts the note switch here). */
  extra?: ReactNode
  tone?: 'note'
}) {
  const t = useT()
  const id = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [body, setBody] = useState('')
  const [image, setImage] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canSend = !busy && !disabled && (body.trim() !== '' || image !== null)

  const pick = (file: File | undefined) => {
    if (!file) return
    if (!TYPES.includes(file.type)) return setError(t.supportErrors.imageInvalid)
    if (file.size > MAX_BYTES) return setError(t.supportErrors.imageTooLarge)
    setError(null)
    setImage(file)
  }
  const send = async () => {
    if (!canSend) return
    setBusy(true)
    const ok = await onSend(body.trim(), image)
    setBusy(false)
    if (ok) {
      setBody('')
      setImage(null)
      setError(null)
    }
  }

  return (
    <form
      className="sp-composer"
      data-tone={tone}
      onSubmit={(e) => {
        e.preventDefault()
        void send()
      }}
    >
      <label htmlFor={id} className="sr-only">
        {labels.label}
      </label>
      <Textarea
        id={id}
        value={body}
        rows={3}
        maxLength={MAX_BODY}
        placeholder={labels.placeholder}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        aria-invalid={error ? true : undefined}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void send()
          }
        }}
        onPaste={(e) => {
          const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
          if (file) {
            e.preventDefault()
            pick(file)
          }
        }}
      />
      {image && (
        <p className="sp-attached">
          <span>{image.name || 'image'}</span>
          <IconButton small label={labels.removeImage} icon={<X size={14} />} onClick={() => setImage(null)} />
        </p>
      )}
      {error && (
        <p className="sp-composer-error" role="alert">
          {error}
        </p>
      )}
      <div className="sp-composer-bar">
        <input
          ref={fileRef}
          type="file"
          accept={TYPES.join(',')}
          hidden
          onChange={(e) => {
            pick(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <IconButton label={labels.attach} icon={<ImagePlus size={16} />} disabled={disabled} onClick={() => fileRef.current?.click()} />
        {extra}
        <span id={`${id}-hint`} className="sp-composer-hint">
          {labels.hint}
        </span>
        <Button type="submit" variant="primary" loading={busy} disabled={!canSend}>
          {labels.send}
          <Send size={15} aria-hidden className="nudge-out" />
        </Button>
      </div>
    </form>
  )
}
