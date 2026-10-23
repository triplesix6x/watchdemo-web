// Building blocks of the auth pages: the centred island (the app's login window), the
// password input with a show toggle, and the live rule list under a field.
import { Fragment, forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { Check, Eye, EyeOff, Minus } from 'lucide-react'
import { Head } from '../../head/Head'
import { useDict } from '../../i18n'
import { Divider, IconButton, Input, Island, Logo } from '../../ui'
import ru from '../../i18n/pages/auth.ru'
import en from '../../i18n/pages/auth.en'
import './auth.css'

export const useAuthDict = () => useDict({ ru, en })

/** fmt() for templates whose placeholders are elements: fill(t.x, { email: <strong>..</strong> }). */
export function fill(template: string, vars: Record<string, ReactNode>): ReactNode[] {
  return template.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <Fragment key={i}>{vars[part]}</Fragment> : part))
}

export function AuthCard({ title, lead, children, foot }: { title: string; lead?: ReactNode; children?: ReactNode; foot?: ReactNode }) {
  const id = useId()
  return (
    <div className="auth-page">
      <Head title={title} noindex />
      <Island className="auth-card" aria-labelledby={id}>
        <div className="auth-head">
          <Logo size={56} intro label={null} className="auth-logo" />
          <h1 id={id}>{title}</h1>
          {lead && <p className="auth-lead">{lead}</p>}
        </div>
        {children}
        {foot && (
          <>
            <Divider soft />
            <div className="auth-foot">{foot}</div>
          </>
        )}
      </Island>
    </div>
  )
}

/** Password input with a show/hide toggle. Goes inside a Field like any Input. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(function PasswordInput(props, ref) {
  const d = useAuthDict()
  const [shown, setShown] = useState(false)
  return (
    <span className="pw-wrap">
      <Input ref={ref} type={shown ? 'text' : 'password'} spellCheck={false} autoCapitalize="none" {...props} />
      <IconButton
        small
        className="pw-toggle"
        label={shown ? d.common.hidePassword : d.common.showPassword}
        aria-pressed={shown}
        icon={shown ? <EyeOff size={15} /> : <Eye size={15} />}
        onClick={() => setShown((s) => !s)}
      />
    </span>
  )
})

/** Rules that tick as the user types. Pass it as a Field hint (it renders inline spans). */
export function RuleList<R extends string>({ rules, value, labels }: { rules: Record<R, (v: string) => boolean>; value: string; labels: Record<R, string> }) {
  const d = useAuthDict()
  return (
    <span className="rules">
      {(Object.keys(rules) as R[]).map((r) => {
        const ok = value !== '' && rules[r](value)
        return (
          <span key={r} className="rule" data-ok={ok || undefined}>
            {ok ? <Check size={13} aria-hidden /> : <Minus size={13} aria-hidden />}
            {labels[r]}
            {ok && <span className="sr-only">, {d.common.ruleMet}</span>}
          </span>
        )
      })}
    </span>
  )
}
