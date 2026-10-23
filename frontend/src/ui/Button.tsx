import { forwardRef, useEffect, useRef, useState, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { LocalLink, useT } from '../i18n'
import { MiniLoader } from './Logo'

// Weight hierarchy from the app: exactly one primary per screen. Press feedback is CSS
// (.btn:active scales to 0.97 on pointer-down and springs back), so it works without JS.
export type ButtonVariant = 'primary' | 'soft' | 'ghost' | 'danger'
type Size = 'md' | 'lg'

const cls = (variant: ButtonVariant | 'icon' | 'icon-sm', size: Size, block?: boolean, extra = '') =>
  ['btn', `btn-${variant}`, size === 'lg' && 'btn-lg', block && 'btn-block', extra].filter(Boolean).join(' ')

type Common = { variant?: ButtonVariant; size?: Size; block?: boolean; className?: string; children: ReactNode }

export type ButtonProps = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & {
    /** Shows a mini loader, sets aria-busy and blocks clicks. Keep the label (verb-first). */
    loading?: boolean
  }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'soft', size = 'md', block, loading, className, children, type = 'button', disabled, ...rest },
  ref,
) {
  const t = useT()
  return (
    <button
      ref={ref}
      type={type}
      className={cls(variant, size, block, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <MiniLoader size={13} label={t.a11y.loading} />}
      {children}
    </button>
  )
})

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & {
  /** Required: the accessible name and the tooltip. */
  label: string
  icon: ReactNode
  small?: boolean
  className?: string
}

/** Round icon-only button. `label` becomes aria-label and title. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, small, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cls(small ? 'icon-sm' : 'icon', 'md', false, className)} aria-label={label} title={label} {...rest}>
      {icon}
    </button>
  )
})

export type ButtonLinkProps = Common &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children' | 'href'> &
  (
    | { /** Internal route, unprefixed ('/download'); localized automatically. */ to: string; href?: never }
    | { /** External or server-served URL (Telegram, /releases/...). */ href: string; to?: never }
  )

/** A link that looks like a button (navigation, downloads). Use Button for actions. */
export function ButtonLink({ variant = 'soft', size = 'md', block, className, children, to, href, ...rest }: ButtonLinkProps) {
  const c = cls(variant, size, block, className)
  if (to !== undefined)
    return (
      <LocalLink to={to} className={c} {...rest}>
        {children}
      </LocalLink>
    )
  const external = /^https?:/.test(href!)
  return (
    <a href={href} className={c} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} {...rest}>
      {children}
    </a>
  )
}

type CopyState = 'idle' | 'copied' | 'failed'

/** Copies `text`. A soft button whose label reads "Скопировано" for two seconds, or with
 *  `icon` a small icon button (tables). Without a clipboard (outside secure contexts) it
 *  says how to copy by hand. */
export function CopyButton({ text, label, icon, className = '' }: { text: string; label: string; icon?: boolean; className?: string }) {
  const t = useT()
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = (e: MouseEvent) => {
    e.stopPropagation()
    clearTimeout(timer.current)
    const show = (s: CopyState, ms: number) => {
      setState(s)
      timer.current = setTimeout(() => setState('idle'), ms)
    }
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => show('copied', 2000),
        () => show('failed', 6000),
      )
  }
  const Icon = state === 'copied' ? Check : Copy
  return (
    <span className={`copy ${className}`}>
      {icon ? (
        <IconButton small label={label} icon={<Icon size={14} />} onClick={copy} data-state={state} />
      ) : (
        <Button variant="soft" onClick={copy} data-state={state}>
          <Icon size={15} aria-hidden />
          {state === 'copied' ? t.actions.copied : label}
        </Button>
      )}
      <span className={state === 'failed' ? 'copy-status' : 'sr-only'} role="status">
        {state === 'failed' ? t.actions.copyFailed : state === 'copied' ? t.actions.copied : ''}
      </span>
    </span>
  )
}
