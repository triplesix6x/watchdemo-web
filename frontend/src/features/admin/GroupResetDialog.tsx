import { useId } from 'react'
import { adminApi } from '../../api/endpoints'
import type { AdminUserDetail } from '../../api/types'
import { fmt, useT } from '../../i18n'
import { useForm } from '../../lib/useForm'
import { Button, Dialog, Field, Input, Note, Textarea } from '../../ui'
import { groupResets, type GroupResetState, type ResetConfirmation } from './groupResetController'
import { useAdminDict } from './useAdmin'

type Props = {
  u: AdminUserDetail
  confirmation: ResetConfirmation
  state: GroupResetState
  onClose: () => void
  onNewConfirmation: (confirmation: ResetConfirmation) => void
}

export function GroupResetDialog({ u, confirmation, state, onClose, onNewConfirmation }: Props) {
  const p = useAdminDict()
  const t = useT()
  const formId = useId()
  const busy = state.kind === 'pending'
  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title={<span className="adm-group-reset-title">{fmt(p.user.groupsResetTitle, { name: u.username })}</span>}
      role="alertdialog"
      footer={
        <>
          <Button data-autofocus variant="soft" onClick={onClose} disabled={busy}>{t.actions.cancel}</Button>
          {state.kind === 'unknown' ? (
            <Button variant="soft" onClick={() => {
              const fresh = groupResets.verifyOutcome(confirmation, state)
              if (fresh) onNewConfirmation(fresh)
            }}>{p.user.groupsResetVerified}</Button>
          ) : (
            <Button type="submit" form={formId} variant="danger" loading={busy} className="adm-group-reset-confirm">
              {fmt(p.user.groupsResetConfirm, { name: u.username })}
            </Button>
          )}
        </>
      }
    >
      {state.kind === 'unknown' ? (
        <Note tone="danger">{p.user.groupsResetUnknown}</Note>
      ) : (
        <ResetForm key={confirmation.identity} u={u} confirmation={confirmation} state={state} formId={formId} busy={busy} />
      )}
    </Dialog>
  )
}

function ResetForm({ u, confirmation, state, formId, busy }: Pick<Props, 'u' | 'confirmation' | 'state'> & { formId: string; busy: boolean }) {
  const p = useAdminDict()
  const t = useT()
  const form = useForm(
    { reason: '', username: '' },
    {
      reason: (v) => !v.trim() ? t.validation.required : v.trim().length > 2000 ? fmt(t.validation.maxLength, { max: 2000 }) : null,
      username: (v) => v === u.username ? null : t.authErrors.usernameMismatch,
    },
  )
  const failure = state.kind === 'rejected' && state.request.confirmation === confirmation ? state.error.message : null
  return (
    <form id={formId} className="adm-group-reset" noValidate onSubmit={form.onSubmit(async ({ reason }) => {
      await groupResets.submit(confirmation, reason, adminApi.resetGroups)
    })}>
      <p>{fmt(p.user.groupsResetText, { name: u.username })}</p>
      <Note tone="warning">{p.user.groupsResetWarning}</Note>
      {busy && <Note>{p.user.groupsResetPending}</Note>}
      <Field label={p.user.groupsResetReason} required hint={p.user.groupsResetReasonHint} error={form.errors.reason}>
        <Textarea rows={4} maxLength={2000} disabled={busy} {...form.field('reason')} />
      </Field>
      <Field label={fmt(p.user.groupsResetUsername, { name: u.username })} required error={form.errors.username}>
        <Input autoComplete="off" spellCheck={false} disabled={busy} {...form.field('username')} />
      </Field>
      {failure && <Note tone="danger">{failure}</Note>}
    </form>
  )
}
