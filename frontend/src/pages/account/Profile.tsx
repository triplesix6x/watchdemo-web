import { useId, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { meApi } from '../../api/endpoints'
import type { ApiError } from '../../api/errors'
import type { User } from '../../api/types'
import { LOCALES, fmt, localizedPath, splitLocale, useLocale, useLp, useT, type Locale } from '../../i18n'
import { formatDate } from '../../lib/format'
import { useForm } from '../../lib/useForm'
import { Button, ConfirmModal, Dialog, Field, IconButton, InlineRename, Input, MiniLoader, Note, PageHead, Section, Select, useToast } from '../../ui'
import { PasswordInput, fill } from '../../features/auth/parts'
import { emailError, usernameError } from '../../features/auth/rules'
import { accountDicts, useAccountDict } from '../../features/account/dict'

function UsernameRow({ user }: { user: User }) {
  const a = useAccountDict()
  const t = useT()
  const toast = useToast()
  const { setUser } = useAuth()
  const editRef = useRef<HTMLButtonElement>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const commit = async (name: string) => {
    const invalid = usernameError(name, t)
    if (invalid) return setError(invalid)
    setError(null)
    setSaving(name.trim().toLowerCase())
    try {
      setUser(await meApi.update({ username: name }))
      toast(a.profile.renamed, { tone: 'success' })
    } catch (e) {
      const err = e as ApiError
      setError(err.fields.username ?? err.message)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="def-row">
      <dt>{a.profile.username}</dt>
      <dd>
        <div className="def-main">
          <div className="edit-cell">
            {editing ? (
              <InlineRename
                value={user.username}
                label={a.profile.newUsername}
                onCommit={commit}
                onDone={(byKey) => {
                  setEditing(false)
                  if (byKey) requestAnimationFrame(() => editRef.current?.focus())
                }}
              />
            ) : (
              <span className="def-value row">
                {saving ?? user.username}
                {saving && <MiniLoader size={12} label={t.state.loading} />}
              </span>
            )}
          </div>
          <span className="def-sub" data-tone={error ? 'danger' : undefined} role={error ? 'alert' : undefined}>
            {error ?? a.profile.usernameHint}
          </span>
        </div>
        <IconButton
          ref={editRef}
          label={a.profile.rename}
          icon={<Pencil size={15} />}
          onClick={() => {
            setError(null)
            setEditing(true)
          }}
          disabled={editing || !!saving}
        />
      </dd>
    </div>
  )
}

function EmailRow({ user }: { user: User }) {
  const a = useAccountDict()
  const t = useT()
  const formId = useId()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const form = useForm(
    { new_email: '', password: '' },
    { new_email: (v) => emailError(v, t), password: (v) => (v ? null : t.validation.required) },
    { invalid_password: 'password', email_taken: 'new_email', email_unchanged: 'new_email' },
  )
  const close = () => {
    setOpen(false)
    form.reset()
  }

  const submit = form.onSubmit(async (v) => {
    await meApi.changeEmail({ new_email: v.new_email.trim(), password: v.password })
    setPending(v.new_email.trim())
    close()
  })

  return (
    <div className="def-row">
      <dt>{a.profile.email}</dt>
      <dd>
        <div className="def-main">
          <span className="def-value">{user.email}</span>
          {pending && <span className="def-sub">{fill(a.profile.pending, { email: <strong>{pending}</strong> })}</span>}
        </div>
        <Button variant="soft" onClick={() => setOpen(true)}>
          {a.profile.changeEmail}
        </Button>
      </dd>
      <Dialog
        open={open}
        onClose={close}
        busy={form.submitting}
        title={a.profile.emailDialog}
        size="sm"
        footer={
          <>
            <Button variant="soft" onClick={close} disabled={form.submitting}>
              {t.actions.cancel}
            </Button>
            <Button type="submit" form={formId} variant="primary" loading={form.submitting}>
              {a.profile.sendLink}
            </Button>
          </>
        }
      >
        <form id={formId} className="auth-form" onSubmit={submit} noValidate>
          <p className="section-lead">{a.profile.emailDialogText}</p>
          <Field label={a.profile.newEmail} error={form.errors.new_email} required>
            <Input {...form.field('new_email')} type="email" autoComplete="email" placeholder="name@example.com" data-autofocus spellCheck={false} />
          </Field>
          <Field label={a.profile.passwordToConfirm} error={form.errors.password} required>
            <PasswordInput {...form.field('password')} autoComplete="current-password" />
          </Field>
          {form.failure && <Note tone="danger">{form.failure}</Note>}
        </form>
      </Dialog>
    </div>
  )
}

function LanguageRow({ user }: { user: User }) {
  const a = useAccountDict()
  const t = useT()
  const id = useId()
  const locale = useLocale()
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const toast = useToast()
  const { setUser } = useAuth()
  const [busy, setBusy] = useState(false)
  const value = user.locale ?? locale

  const change = async (next: Locale) => {
    setBusy(true)
    try {
      setUser(await meApi.update({ locale: next }))
      navigate(localizedPath(splitLocale(pathname).path, next) + search, { replace: true })
      toast(accountDicts[next].profile.languageSaved, { tone: 'success' })
    } catch (e) {
      toast((e as ApiError).message, { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="def-row">
      <dt>
        <label htmlFor={id}>{a.profile.language}</label>
      </dt>
      <dd>
        <div className="def-main">
          <span className="row">
            <Select id={id} value={value} disabled={busy} aria-describedby={`${id}-hint`} onChange={(e) => change(e.target.value as Locale)}>
              {LOCALES.map((l) => (
                <option key={l} value={l} lang={l}>
                  {t.lang[l]}
                </option>
              ))}
            </Select>
            {busy && <MiniLoader size={13} label={t.state.loading} />}
          </span>
          <span className="def-sub" id={`${id}-hint`}>
            {a.profile.languageHint}
          </span>
        </div>
      </dd>
    </div>
  )
}

function DeleteAccount({ user }: { user: User }) {
  const a = useAccountDict()
  const t = useT()
  const lp = useLp()
  const navigate = useNavigate()
  const toast = useToast()
  const { logout } = useAuth()
  const formId = useId()
  const [open, setOpen] = useState(false)
  const form = useForm(
    { password: '', username: '' },
    {
      password: (v) => (v ? null : t.validation.required),
      username: (v) => (!v.trim() ? t.validation.required : v.trim().toLowerCase() === user.username ? null : t.authErrors.usernameMismatch),
    },
    { invalid_password: 'password', username_mismatch: 'username' },
  )
  const close = () => {
    setOpen(false)
    form.reset()
  }

  const submit = form.onSubmit(async (v) => {
    await meApi.deleteAccount({ password: v.password, username: v.username.trim() })
    await logout()
    navigate(lp('/'), { replace: true })
    toast(a.profile.deleted, { tone: 'success' })
  })

  return (
    <Section title={a.profile.dangerTitle} lead={a.profile.dangerText} className="danger-zone">
      <div className="acc-actions">
        <Button variant="danger" onClick={() => setOpen(true)}>
          {a.profile.delete}
        </Button>
      </div>
      <ConfirmModal
        open={open}
        variant="danger"
        busy={form.submitting}
        title={fmt(a.profile.deleteTitle, { username: user.username })}
        confirmLabel={a.profile.delete}
        onCancel={close}
        formId={formId}
        message={
          <form id={formId} className="auth-form" onSubmit={submit} noValidate>
            <p className="section-lead">{a.profile.deleteText}</p>
            <Field label={a.profile.passwordToConfirm} error={form.errors.password} required>
              <PasswordInput {...form.field('password')} autoComplete="current-password" data-autofocus />
            </Field>
            <Field label={fmt(a.profile.typeUsername, { username: user.username })} error={form.errors.username} required>
              <Input {...form.field('username')} autoComplete="off" autoCapitalize="none" spellCheck={false} />
            </Field>
            {form.failure && <Note tone="danger">{form.failure}</Note>}
          </form>
        }
      />
    </Section>
  )
}

export default function AccountProfile() {
  const a = useAccountDict()
  const locale = useLocale()
  const { user } = useAuth()
  if (!user) return null
  return (
    <>
      <PageHead title={a.profile.title} lead={user.created_at ? fmt(a.memberSince, { date: formatDate(user.created_at, locale) }) : undefined} />
      <div className="acc-stack">
        <Section title={a.profile.accountTitle}>
          <dl className="def-list">
            <UsernameRow user={user} />
            <EmailRow user={user} />
            <LanguageRow user={user} />
          </dl>
        </Section>
        <DeleteAccount user={user} />
      </div>
    </>
  )
}
