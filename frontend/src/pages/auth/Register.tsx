import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { authApi } from '../../api/endpoints'
import { LocalLink, useLocale, useLp, useT } from '../../i18n'
import { useForm } from '../../lib/useForm'
import { Button, ButtonLink, Field, Input, Note } from '../../ui'
import { AuthCard, PasswordInput, RuleList, fill, useAuthDict } from '../../features/auth/parts'
import { PASSWORD_RULES, USERNAME_RULES, emailError, passwordError, usernameError } from '../../features/auth/rules'

export default function Register() {
  const d = useAuthDict()
  const t = useT()
  const lp = useLp()
  const locale = useLocale()
  const { user } = useAuth()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [resent, setResent] = useState(false)
  const form = useForm(
    { email: '', username: '', password: '' },
    { email: (v) => emailError(v, t), username: (v) => usernameError(v, t), password: (v) => passwordError(v, t) },
    { email_taken: 'email', username_taken: 'username', password_weak: 'password' },
  )

  if (user) return <Navigate to={lp('/account')} replace />

  const submit = form.onSubmit(async (v) => {
    const email = v.email.trim()
    await authApi.register({ email, username: v.username.trim(), password: v.password, locale })
    setSentTo(email)
  })

  if (sentTo)
    return (
      <AuthCard
        title={d.register.doneTitle}
        lead={fill(d.register.doneText, { email: <strong>{sentTo}</strong> })}
        foot={
          <LocalLink to="/login" className="link">
            {d.common.backToLogin}
          </LocalLink>
        }
      >
        <div className="auth-actions">
          <p className="auth-text t-muted">{d.register.doneSpam}</p>
          {resent ? (
            <Note tone="success">{d.register.resent}</Note>
          ) : (
            <Button
              variant="soft"
              block
              onClick={() => authApi.resendVerification(sentTo).finally(() => setResent(true))}
            >
              <MailCheck size={15} aria-hidden />
              {d.register.resend}
            </Button>
          )}
          <ButtonLink to="/login" variant="primary" size="lg" block>
            {d.common.toLogin}
          </ButtonLink>
        </div>
      </AuthCard>
    )

  return (
    <AuthCard
      title={d.register.title}
      lead={d.register.lead}
      foot={
        <>
          <span>{d.register.haveAccount}</span>
          <LocalLink to="/login" className="link">
            {d.common.toLogin}
          </LocalLink>
        </>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field label={d.common.email} error={form.errors.email} required>
          <Input {...form.field('email')} type="email" autoComplete="email" placeholder={d.common.emailHint} spellCheck={false} />
        </Field>
        <Field
          label={d.register.username}
          error={form.errors.username}
          hint={
            <>
              <RuleList rules={USERNAME_RULES} value={form.values.username} labels={d.usernameRules} />
              <span className="rule-note">{d.register.usernameHint}</span>
            </>
          }
          required
        >
          <Input {...form.field('username')} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={50} />
        </Field>
        <Field label={d.common.password} error={form.errors.password} hint={<RuleList rules={PASSWORD_RULES} value={form.values.password} labels={d.passwordRules} />} required>
          <PasswordInput {...form.field('password')} autoComplete="new-password" maxLength={128} />
        </Field>
        {form.failure && <Note tone="danger">{form.failure}</Note>}
        <Button type="submit" variant="primary" size="lg" block loading={form.submitting}>
          {d.register.submit}
        </Button>
      </form>
    </AuthCard>
  )
}
