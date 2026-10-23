// Layers that leave the page flow: Portal, Menu, Dialog, ConfirmModal.
// Ported from the app's Menu.svelte, ConfirmModal.svelte, dialog.ts, menu.ts, portal.ts.
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X } from 'lucide-react'
import { LocalLink, useT } from '../i18n'
import { lockScroll } from '../engine'
import { Button, IconButton } from './Button'

// Portals present during hydration (the toast stack) wait one effect so the server and
// client markup agree. Anything opened later (menus, dialogs) renders at once, so refs
// inside it exist in the opener's layout effects.
let hydrated = false

/** Renders into document.body. Islands clip with overflow: hidden; anything that floats
 *  must live outside them. */
export function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(hydrated)
  useEffect(() => {
    hydrated = true
    setMounted(true)
  }, [])
  return mounted ? createPortal(children, document.body) : null
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Modal focus: moves in on open, cycles with Tab, returns to the opener on close. Esc is
 *  caught on the node and stops there, so a nested dialog closes alone. */
export function useFocusTrap(onEscape: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const esc = useRef(onEscape)
  esc.current = onEscape
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const prev = document.activeElement as HTMLElement | null
    const items = () => [...node.querySelectorAll<HTMLElement>(FOCUSABLE)]
    const first = node.querySelector<HTMLElement>('[data-autofocus]') ?? items()[0] ?? node
    first.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        esc.current()
      } else if (e.key === 'Tab') {
        const list = items()
        const a = list[0]
        const z = list[list.length - 1]
        const at = document.activeElement
        if (!a) e.preventDefault()
        else if (e.shiftKey && (at === a || at === node)) {
          e.preventDefault()
          z.focus()
        } else if (!e.shiftKey && at === z) {
          e.preventDefault()
          a.focus()
        }
      }
    }
    node.addEventListener('keydown', onKey)
    return () => {
      node.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [])
  return ref
}

// ==== Menu ===============================================================

type TriggerProps = {
  ref: Ref<HTMLButtonElement>
  onClick: () => void
  onKeyDown: (e: ReactKeyboardEvent) => void
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
  'aria-controls': string | undefined
}

export type MenuProps = {
  /** Render the button that opens the menu; spread the props onto it. */
  trigger: (props: TriggerProps) => ReactElement
  /** Accessible name of the menu. */
  label: string
  /** Which edge of the trigger the menu aligns to. */
  align?: 'left' | 'right'
  className?: string
  children: ReactNode
}

const ITEMS = '[role^="menuitem"]:not([disabled])'

/** "⋯" menu: portal to body, arrows/Home/End move, Esc and Tab close (Esc stops there),
 *  outside pointer-down closes, picking an item closes and returns focus to the button. */
export function Menu({ trigger, label, align = 'right', className = '', children }: MenuProps) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) btn.current?.focus()
  }, [])

  const place = useCallback(() => {
    const a = btn.current?.getBoundingClientRect()
    const m = menu.current
    if (!a || !m) return
    const w = m.offsetWidth
    const h = m.offsetHeight
    let left = align === 'right' ? a.right - w : a.left
    left = Math.max(8, Math.min(left, innerWidth - w - 8))
    let top = a.bottom + 6
    if (top + h > innerHeight - 8) {
      const above = a.top - 6 - h
      top = above >= 8 ? above : Math.max(8, innerHeight - h - 8)
    }
    m.style.left = `${Math.round(left)}px`
    m.style.top = `${Math.round(top)}px`
    m.style.setProperty('--menu-origin', `${top < a.top ? 'bottom' : 'top'} ${align}`)
  }, [align])

  useLayoutEffect(() => {
    if (!open) return
    place()
    menu.current?.querySelector<HTMLElement>(ITEMS)?.focus()
    const outside = (e: PointerEvent) => {
      const t = e.target as Node
      if (menu.current?.contains(t) || btn.current?.contains(t)) return
      close(false)
    }
    addEventListener('pointerdown', outside)
    addEventListener('resize', place)
    addEventListener('scroll', place, true)
    return () => {
      removeEventListener('pointerdown', outside)
      removeEventListener('resize', place)
      removeEventListener('scroll', place, true)
    }
  }, [open, place, close])

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
    }
    if (e.key === 'Escape' || e.key === 'Tab') return close(true)
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(ITEMS)]
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? (i < 0 ? -1 : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? -1 : null
    if (next === null || !items.length) return
    e.preventDefault()
    items[(next + items.length) % items.length].focus()
  }

  return (
    <>
      {trigger({
        ref: btn,
        onClick: () => setOpen((o) => !o),
        onKeyDown: (e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        },
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? id : undefined,
      })}
      {open && (
        <Portal>
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-label={label}
            tabIndex={-1}
            data-lenis-prevent
            className={`menu card-raised ${className}`}
            onKeyDown={onMenuKey}
            onClick={(e) => {
              // A plain menuitem closes the menu; toggles (menuitemcheckbox) keep it open.
              if ((e.target as Element).closest('[role="menuitem"]')) close(true)
            }}
          >
            {children}
          </div>
        </Portal>
      )}
    </>
  )
}

type MenuItemProps = {
  children: ReactNode
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
} & ({ onSelect: () => void; to?: never; href?: never } | { to: string; onSelect?: never; href?: never } | { href: string; onSelect?: never; to?: never })

/** One menu entry: an action (onSelect), a route (`to`, unprefixed) or a URL (`href`). */
export function MenuItem({ children, icon, danger, disabled, onSelect, to, href }: MenuItemProps) {
  const cls = `list-row list-row-hover menu-item${danger ? ' menu-item-danger' : ''}`
  const body = (
    <>
      {icon}
      <span>{children}</span>
    </>
  )
  if (to !== undefined)
    return (
      <LocalLink role="menuitem" tabIndex={-1} to={to} className={cls}>
        {body}
      </LocalLink>
    )
  if (href !== undefined)
    return (
      <a role="menuitem" tabIndex={-1} href={href} className={cls}>
        {body}
      </a>
    )
  return (
    <button type="button" role="menuitem" tabIndex={-1} disabled={disabled} className={cls} onClick={onSelect}>
      {body}
    </button>
  )
}

export const MenuSeparator = () => <div role="separator" className="menu-sep" />
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <div className="menu-label" role="presentation">
    {children}
  </div>
)

// ==== Dialog =============================================================

export type DialogProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** Accessible name when the title is not plain text. */
  label?: string
  icon?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** Buttons, right-aligned: secondary first, the primary action last. */
  footer?: ReactNode
  /** alertdialog for confirmations that interrupt. */
  role?: 'dialog' | 'alertdialog'
  /** Enter inside the dialog (not on a button) runs this. */
  onEnter?: () => void
  /** An action is running: Esc, the backdrop and the close button do nothing. */
  busy?: boolean
  children?: ReactNode
}

/** Modal dialog: portal to body, backdrop click and Esc close, focus trapped and restored,
 *  page scroll locked. Put data-autofocus on the element that should take focus first. */
export function Dialog({ open, ...rest }: DialogProps) {
  return open ? <DialogPanel {...rest} /> : null
}

function DialogPanel({ onClose: close, title, label, icon, size = 'md', footer, role = 'dialog', onEnter, busy, children }: Omit<DialogProps, 'open'>) {
  const t = useT()
  const onClose = () => {
    if (!busy) close()
  }
  const ref = useFocusTrap(onClose)
  const titleId = useId()
  useEffect(() => lockScroll(), [])
  return (
    <Portal>
      <div className="modal-backdrop" role="presentation" onClick={onClose} data-lenis-prevent>
        <div
          ref={ref}
          className={`modal-panel modal-panel-${size} card-raised`}
          role={role}
          aria-modal="true"
          aria-labelledby={label ? undefined : titleId}
          aria-label={label}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (onEnter && e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLTextAreaElement)) {
              e.preventDefault()
              onEnter()
            }
          }}
        >
          <header className="modal-head modal-header-line">
            <h2 className="modal-title" id={titleId}>
              {icon}
              {title}
            </h2>
            <IconButton small label={t.actions.close} icon={<X size={16} />} onClick={onClose} disabled={busy} />
          </header>
          {children && <div className="modal-body">{children}</div>}
          {footer && <footer className="modal-foot modal-footer-line">{footer}</footer>}
        </div>
      </div>
    </Portal>
  )
}

export type ConfirmModalProps = {
  open: boolean
  title: string
  message: ReactNode
  /** Name the action ("Удалить аккаунт"), never "OK". */
  confirmLabel: string
  cancelLabel?: string
  variant?: 'default' | 'danger'
  /** While the action runs: the confirm button shows a loader and the dialog stays open. */
  busy?: boolean
  onCancel: () => void
} & (
  | { onConfirm: () => void; formId?: never }
  /** The message holds a form with this id: confirming submits it (the form validates). */
  | { formId: string; onConfirm?: never }
)

/** Confirmation for destructive or irreversible actions. Enter confirms only from inside. */
export function ConfirmModal({ open, title, message, confirmLabel, cancelLabel, variant = 'default', busy, onConfirm, onCancel, formId }: ConfirmModalProps) {
  const t = useT()
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      busy={busy}
      title={title}
      role="alertdialog"
      size="md"
      icon={variant === 'danger' ? <AlertTriangle size={16} color="var(--danger)" aria-hidden /> : undefined}
      onEnter={busy || formId ? undefined : onConfirm}
      footer={
        <>
          <Button variant="soft" onClick={onCancel} disabled={busy}>
            {cancelLabel ?? t.actions.cancel}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            {...(formId ? { type: 'submit' as const, form: formId } : { onClick: onConfirm })}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {typeof message === 'string' ? <p style={{ whiteSpace: 'pre-line' }}>{message}</p> : message}
    </Dialog>
  )
}
