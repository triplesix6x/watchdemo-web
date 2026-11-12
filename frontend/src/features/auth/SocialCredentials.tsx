import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useLocale, useT } from '../../i18n'
import { useAsync } from '../../lib/useAsync'
import { useForm } from '../../lib/useForm'
import { Button, ConfirmModal, Field, Input, Note, Section, Switch } from '../../ui'
import { PasswordInput, RuleList, useAuthDict } from './parts'
import { emailError, PASSWORD_RULES, passwordError } from './rules'
import { SocialAuthButtons } from './SocialAuthButtons'
import { socialApi } from './socialApi'
import { useSocialDict } from './socialDict'

function useVerification() {
  const status = useAsync(() => socialApi.status().catch(() => null), [])
  return { ready: status.data?.stage === 'reauth_ready', reload: status.reload }
}

export function SocialConnections() {
  const d = useSocialDict()
  return <Section title={d.providers} lead={d.connections}><SocialAuthButtons mode="link" /></Section>
}

export function SocialCredentials() {
  const d = useSocialDict()
  const t = useT()
  const a = useAuthDict()
  const locale = useLocale()
  const { user } = useAuth()
  const verification = useVerification()
  const [message, setMessage] = useState<string | null>(null)
  const [others, setOthers] = useState(true)
  const email = useForm({ email: '' }, { email: (v) => emailError(v, t) })
  const password = useForm({ password: '' }, { password: (v) => passwordError(v, t) })
  const send = email.onSubmit(async (v) => {
    await socialApi.email(v.email.trim())
    email.reset()
    verification.reload()
    setMessage(d.sent)
  })
  const save = password.onSubmit(async (v) => {
    await socialApi.password(v.password, others)
    password.reset()
    // Reload refreshes account/session state after session revocation.
    window.location.reload()
  })
  return <Section title={d.credentials} lead={d.lead}>
    <div className="acc-stack">
      <SocialAuthButtons mode="reauth" />
      <Note>{verification.ready ? d.ready : d.verifyFirst}</Note>
      <form className="acc-form" onSubmit={send} noValidate>
        <Field label={d.email} error={email.errors.email} required>
          <Input {...email.field('email')} type="email" autoComplete="email" maxLength={254} />
        </Field>
        {email.failure && <Note tone="danger">{email.failure}</Note>}
        <Button variant="primary" type="submit" disabled={!verification.ready} loading={email.submitting}>{d.send}</Button>
      </form>
      <form className="acc-form" onSubmit={save} noValidate>
        <Field label={d.password} error={password.errors.password} hint={<RuleList rules={PASSWORD_RULES} value={password.values.password} labels={a.passwordRules} />} required>
          <PasswordInput {...password.field('password')} autoComplete="new-password" maxLength={128} />
        </Field>
        {!user?.email && <Note>{d.requireEmail}</Note>}
        <Switch label={locale === 'en' ? 'Sign out other devices' : 'Выйти на других устройствах'} checked={others} onChange={setOthers} />
        {password.failure && <Note tone="danger">{password.failure}</Note>}
        <Button variant="primary" type="submit" disabled={!verification.ready || !user?.email} loading={password.submitting}>{d.save}</Button>
      </form>
      {message && <Note>{message}</Note>}
    </div>
  </Section>
}

export function SocialDeleteAccount() {
  const d = useSocialDict()
  const t = useT()
  const { user, logout } = useAuth()
  const verification = useVerification()
  const [open, setOpen] = useState(false)
  const form = useForm({ username: '' }, { username: (v) => v.trim().toLowerCase() === user?.username ? null : t.authErrors.usernameMismatch })
  const submit = form.onSubmit(async (v) => {
    await socialApi.deleteAccount(v.username.trim())
    await logout()
    window.location.assign('/')
  })
  return <Section title={d.delete} lead={d.deleteLead} className="danger-zone">
    <SocialAuthButtons mode="reauth" />
    <Button variant="danger" disabled={!verification.ready} onClick={() => setOpen(true)}>{d.delete}</Button>
    <ConfirmModal open={open} title={d.delete} variant="danger" busy={form.submitting} confirmLabel={d.delete}
      onCancel={() => setOpen(false)} formId="social-delete-account" message={
        <form id="social-delete-account" className="auth-form" onSubmit={submit} noValidate>
          <p>{d.deleteLead}</p>
          <Field label={d.usernameConfirm} error={form.errors.username} required>
            <Input {...form.field('username')} autoComplete="off" autoCapitalize="none" spellCheck={false} data-autofocus />
          </Field>
          {form.failure && <Note tone="danger">{form.failure}</Note>}
        </form>
      } />
  </Section>
}
