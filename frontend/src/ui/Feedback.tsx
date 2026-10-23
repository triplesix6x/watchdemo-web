// Waiting and status: Skeleton, DelayedReveal, Pending, EmptyState, LoadError, Note, Toast.
// Loader rule from the app: nothing under 100 ms, MiniLoader up to 1 s, skeletons beyond.
// Wrap a skeleton in <DelayedReveal> so a fast response never flashes it.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from 'react'
import { RotateCw, X } from 'lucide-react'
import { useT } from '../i18n'
import { Button, IconButton } from './Button'
import { MiniLoader } from './Logo'
import { Portal } from './Overlay'

export function Skeleton({ width = '100%', height = '1rem', radius, className = '' }: { width?: string | number; height?: string | number; radius?: string; className?: string }) {
  return <span aria-hidden="true" className={`skeleton ${className}`} style={{ width, height, borderRadius: radius }} />
}

/** Shows children only after `delay` ms (CSS animation, no timers): short waits pass with
 *  no flash, long ones fade in. Same as the app's .appear-late. */
export function DelayedReveal({ delay = 300, as: Tag = 'div', className = '', children }: { delay?: number; as?: ElementType; className?: string; children: ReactNode }) {
  return (
    <Tag className={`appear-late ${className}`} style={{ '--appear-delay': `${delay}ms` } as CSSProperties}>
      {children}
    </Tag>
  )
}

/** The loader rule in CSS for server-rendered waits: nothing for 100 ms, then the mini
 *  loader, and from 1 s the skeleton in `children`. The server render shows the same
 *  markup, so a prerendered page hydrates without a jump. */
export function Pending({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`pending ${className}`} aria-busy="true">
      <span className="pending-mini">
        <MiniLoader size={16} label={label} />
      </span>
      <div className="pending-skel" aria-hidden="true">
        {children}
      </div>
    </div>
  )
}

/** Empty or filtered-to-zero state. Always say what to do next: pass an action. */
export function EmptyState({ icon, title, text, action, className = '' }: { icon?: ReactNode; title: ReactNode; text?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`empty ${className}`}>
      {icon && (
        <div className="empty-icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <p className="empty-title">{title}</p>
      {text && <p className="empty-text">{text}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}

/** A failed load: the localized reason and a retry. */
export function LoadError({ text, onRetry, className = 'card' }: { text: string; onRetry: () => void; className?: string }) {
  const t = useT()
  return (
    <EmptyState
      className={className}
      title={text}
      action={
        <Button variant="soft" onClick={onRetry}>
          <RotateCw size={14} aria-hidden />
          {t.actions.retry}
        </Button>
      }
    />
  )
}

export type NoteTone = 'info' | 'success' | 'warning' | 'danger'

/** A message block inside a form or a page. Danger and warning interrupt (role=alert). */
export function Note({ tone = 'info', children, className = '' }: { tone?: NoteTone; children: ReactNode; className?: string }) {
  return (
    <div className={`note ${className}`} data-tone={tone} role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}

// ==== Toast ==============================================================

export type ToastTone = 'info' | 'success' | 'error'
type ToastItem = { id: number; message: ReactNode; tone: ToastTone }
type ToastFn = (message: ReactNode, opts?: { tone?: ToastTone; duration?: number }) => void

const ToastCtx = createContext<ToastFn | null>(null)

/** One stack for the whole app, bottom right. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setItems((xs) => xs.filter((x) => x.id !== id))
  }, [])

  const toast = useCallback<ToastFn>(
    (message, { tone = 'info', duration } = {}) => {
      const id = ++seq.current
      setItems((xs) => [...xs.slice(-2), { id, message, tone }])
      timers.current.set(id, setTimeout(() => dismiss(id), duration ?? (tone === 'error' ? 7000 : 4000)))
    },
    [dismiss],
  )

  useEffect(() => {
    const all = timers.current
    return () => all.forEach(clearTimeout)
  }, [])

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <Portal>
        <div className="toast-stack" aria-live="polite">
          {items.map((it) => (
            <ToastView key={it.id} item={it} onClose={() => dismiss(it.id)} />
          ))}
        </div>
      </Portal>
    </ToastCtx.Provider>
  )
}

function ToastView({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const t = useT()
  return (
    <div className="toast card-raised" data-tone={item.tone} role={item.tone === 'error' ? 'alert' : 'status'}>
      <span className="toast-dot" aria-hidden="true" />
      <span style={{ flex: 1 }}>{item.message}</span>
      <IconButton small className="toast-close" label={t.actions.close} icon={<X size={14} />} onClick={onClose} />
    </div>
  )
}

/** `const toast = useToast(); toast('Сохранено', { tone: 'success' })`. */
export function useToast(): ToastFn {
  const fn = useContext(ToastCtx)
  if (!fn) throw new Error('useToast must be used within ToastProvider')
  return fn
}
