import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLocale, useLp, useT } from '../../i18n'
import { useAsync } from '../../lib/useAsync'
import { useForm } from '../../lib/useForm'
import { Button, Field, Input, LoadError, Note } from '../../ui'
import { AuthCard } from './parts'
import { usernameError } from './rules'
import { socialApi } from './socialApi'
import { useSocialDict } from './socialDict'

/** Public callback landing: the pending identity exists only in HttpOnly cookies. */
export default function SocialOnboarding() {
  const d = useSocialDict()
  const t = useT()
  const locale = useLocale()
  const lp = useLp()
  const [failure, setFailure] = useState<string | null>(null)
  const [approved, setApproved] = useState(false)
  const [busy, setBusy] = useState(false)
  const status = useAsync(() => {
    if (new URLSearchParams(window.location.search).has('failed')) return Promise.reject(new Error(d.failed))
    return socialApi.status()
  }, [])
  const desktop = status.data?.destination === 'desktop'
  const finish = async () => {
    if (!status.data) return
    if (desktop) {
      await socialApi.approveDesktop(status.data.flow_id)
      setApproved(true)
      return
    }
    await socialApi.finish(status.data.flow_id)
    window.location.replace(lp('/account'))
  }
  const form = useForm({ username: '' }, { username: (v) => usernameError(v, t) }, { username_taken: 'username' })
  const submit = form.onSubmit(async ({ username }) => {
    if (!status.data) return
    await socialApi.register(username, locale, status.data.flow_id)
    if (desktop) status.reload()
    else await finish()
  })
  const proceed = async () => {
    setBusy(true)
    setFailure(null)
    try {
      if (status.data?.stage === 'login_ready') await finish()
      else window.location.replace(lp('/account/security'))
    } catch (e) {
      setFailure(e instanceof Error ? e.message : d.failed)
      setBusy(false)
    }
  }
  return <AuthCard title={desktop ? d.desktop : d.title}>
    {desktop && !approved && <Note>{d.desktopLead}</Note>}
    {approved && <p role="status">{d.desktopDone}</p>}
    {status.loading && <p role="status">{d.loading}</p>}
    {status.error && <><LoadError text={status.error.message} onRetry={status.reload} /><Link to={lp('/login')}>{d.retry}</Link></>}
    {status.data?.stage === 'pending_registration' && <form className="auth-form" onSubmit={submit} noValidate>
      <p>{d.choose}</p>
      <Field label={d.username} error={form.errors.username} required>
        <Input {...form.field('username')} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={50} autoFocus />
      </Field>
      {form.failure && <Note tone="danger">{form.failure}</Note>}
      <Button variant="primary" type="submit" loading={form.submitting}>{d.create}</Button>
    </form>}
    {!approved && status.data && status.data.stage !== 'pending_registration' && <>
      {status.data.stage === 'linked' && <Note>{d.done}</Note>}
      {status.data.stage === 'reauth_ready' && <Note>{d.ready}</Note>}
      <Button variant="primary" loading={busy} onClick={() => void proceed()}>{desktop ? d.desktopApprove : t.pagination.next}</Button>
    </>}
    {failure && <Note tone="danger">{failure}</Note>}
  </AuthCard>
}
