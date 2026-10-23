import { useState } from 'react'
import { LocalLink, useT } from '../../i18n'
import { useForm } from '../../lib/useForm'
import { Button, Field, Input, Note } from '../../ui'
import { AuthCard, fill, useAuthDict } from './parts'
import { emailError } from './rules'

/** One email field, then a neutral "sent" state: the server never says whether the address exists. */
export function EmailLinkForm({
  title,
  lead,
  submitLabel,
  doneTitle,
  doneText,
  send,
  initialEmail = '',
}: {
  title: string
  lead: string
  submitLabel: string
  doneTitle: string
  doneText: string
  send: (email: string) => Promise<unknown>
  initialEmail?: string
}) {
  const d = useAuthDict()
  const t = useT()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const form = useForm({ email: initialEmail }, { email: (v) => emailError(v, t) })
  const back = (
    <LocalLink to="/login" className="link">
      {d.common.backToLogin}
    </LocalLink>
  )

  if (sentTo) return <AuthCard title={doneTitle} lead={fill(doneText, { email: <strong>{sentTo}</strong> })} foot={back} />

  const submit = form.onSubmit(async (v) => {
    await send(v.email.trim())
    setSentTo(v.email.trim())
  })

  return (
    <AuthCard title={title} lead={lead} foot={back}>
      <form className="auth-form" onSubmit={submit} noValidate>
        <Field label={d.common.email} error={form.errors.email} required>
          <Input {...form.field('email')} type="email" autoComplete="email" placeholder={d.common.emailHint} spellCheck={false} />
        </Field>
        {form.failure && <Note tone="danger">{form.failure}</Note>}
        <Button type="submit" variant="primary" size="lg" block loading={form.submitting}>
          {submitLabel}
        </Button>
      </form>
    </AuthCard>
  )
}
