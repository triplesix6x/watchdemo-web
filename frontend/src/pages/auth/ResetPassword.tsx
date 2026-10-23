import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { authApi } from '../../api/endpoints'
import { ApiError, Code } from '../../api/errors'
import { useLp, useT } from '../../i18n'
import { useForm } from '../../lib/useForm'
import { Button, ButtonLink, Field, Note } from '../../ui'
import { AuthCard, PasswordInput, RuleList, useAuthDict } from '../../features/auth/parts'
import { PASSWORD_RULES, passwordError } from '../../features/auth/rules'

export default function ResetPassword() {
  const d = useAuthDict()
  const t = useT()
  const lp = useLp()
  const navigate = useNavigate()
  const token = useSearchParams()[0].get('token')
  // A spent or expired token is not a form error: the whole link is dead, offer a new one.
  const [deadLink, setDeadLink] = useState<string | null>(token ? null : d.reset.noToken)
  const form = useForm({ new_password: '' }, { new_password: (v) => passwordError(v, t) }, { password_weak: 'new_password' })

  if (deadLink)
    return (
      <AuthCard title={d.reset.badTitle} lead={deadLink}>
        <ButtonLink to="/forgot-password" variant="primary" size="lg" block>
          {d.reset.requestNew}
        </ButtonLink>
      </AuthCard>
    )

  const submit = form.onSubmit(async (v) => {
    try {
      await authApi.resetPassword(token!, v.new_password)
    } catch (e) {
      if (e instanceof ApiError && (e.code === Code.TOKEN_INVALID || e.code === Code.TOKEN_EXPIRED)) return setDeadLink(e.message)
      throw e
    }
    navigate(lp('/login'), { replace: true, state: { notice: 'reset' } })
  })

  return (
    <AuthCard title={d.reset.title} lead={d.reset.lead}>
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field label={d.reset.newPassword} error={form.errors.new_password} hint={<RuleList rules={PASSWORD_RULES} value={form.values.new_password} labels={d.passwordRules} />} required>
          <PasswordInput {...form.field('new_password')} autoComplete="new-password" maxLength={128} />
        </Field>
        {form.failure && <Note tone="danger">{form.failure}</Note>}
        <Button type="submit" variant="primary" size="lg" block loading={form.submitting}>
          {d.reset.submit}
        </Button>
      </form>
    </AuthCard>
  )
}
