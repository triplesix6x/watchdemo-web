import { useRef, useState } from 'react'
import { Globe, Monitor, Smartphone } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { meApi } from '../../api/endpoints'
import type { ApiError } from '../../api/errors'
import type { Session } from '../../api/types'
import { fmt, plural, useLocale, useT, type Locale } from '../../i18n'
import { formatRelative } from '../../lib/format'
import { deviceName, parseDevice } from '../../lib/userAgent'
import { useAsync } from '../../lib/useAsync'
import { useForm } from '../../lib/useForm'
import { Button, ButtonLink, ConfirmModal, DelayedReveal, EmptyState, Field, LoadError, Note, PageHead, Pill, Section, Skeleton, Switch, useToast } from '../../ui'
import { PasswordInput, RuleList, useAuthDict } from '../../features/auth/parts'
import { PASSWORD_RULES, passwordError } from '../../features/auth/rules'
import { useAccountDict } from '../../features/account/dict'

function DeviceIcon({ s }: { s: Session }) {
  const d = parseDevice(s.device_info)
  const Icon = d.kind === 'app' ? Monitor : d.mobile ? Smartphone : Globe
  return (
    <span className="device-icon" aria-hidden="true">
      <Icon size={17} />
    </span>
  )
}

function PasswordSection({ onSignedOutOthers }: { onSignedOutOthers: () => void }) {
  const a = useAccountDict()
  const d = useAuthDict()
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const [signOutOthers, setSignOutOthers] = useState(true)
  const form = useForm(
    { current_password: '', new_password: '' },
    { current_password: (v) => (v ? null : t.validation.required), new_password: (v) => passwordError(v, t) },
    { invalid_password: 'current_password', password_weak: 'new_password' },
  )

  const submit = form.onSubmit(async (v) => {
    await meApi.changePassword({ ...v, sign_out_others: signOutOthers })
    form.reset()
    toast(signOutOthers ? a.security.changedSignedOut : a.security.changed, { tone: 'success' })
    if (signOutOthers) onSignedOutOthers()
  })

  return (
    <Section title={a.security.passwordTitle}>
      <form className="acc-form" onSubmit={submit} noValidate>
        {/* Tells password managers which account the new password belongs to. */}
        <input type="text" name="username" autoComplete="username" value={user?.username ?? ''} readOnly hidden />
        <Field label={a.security.current} error={form.errors.current_password} required>
          <PasswordInput {...form.field('current_password')} autoComplete="current-password" />
        </Field>
        <Field label={a.security.next} error={form.errors.new_password} hint={<RuleList rules={PASSWORD_RULES} value={form.values.new_password} labels={d.passwordRules} />} required>
          <PasswordInput {...form.field('new_password')} autoComplete="new-password" maxLength={128} />
        </Field>
        <Switch label={a.security.signOutOthers} checked={signOutOthers} onChange={setSignOutOthers} />
        {form.failure && <Note tone="danger">{form.failure}</Note>}
        <Button type="submit" variant="primary" loading={form.submitting}>
          {a.security.submit}
        </Button>
      </form>
    </Section>
  )
}

function DeviceRow({ s, locale, onEnd }: { s: Session; locale: Locale; onEnd: (s: Session) => Promise<void> }) {
  const a = useAccountDict()
  const t = useT()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const name = deviceName(parseDevice(s.device_info), t)
  return (
    <li className="device">
      <DeviceIcon s={s} />
      <div>
        <p className="device-name">
          {name}
          {s.is_current && <Pill tone="brand">{t.device.thisDevice}</Pill>}
        </p>
        <p className="device-meta num">
          {fmt(a.security.lastUsed, { when: formatRelative(s.last_used_at, locale) })}
          {s.ip_address && <> · {s.ip_address}</>}
        </p>
      </div>
      {!s.is_current && !confirming && (
        <Button variant="ghost" onClick={() => setConfirming(true)} aria-label={`${a.security.signOutOne}: ${name}`}>
          {a.security.signOutOne}
        </Button>
      )}
      {confirming && (
        <div className="device-confirm" role="group" aria-label={name}>
          <span>{a.security.confirmOne}</span>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true)
              await onEnd(s).catch(() => setBusy(false))
            }}
          >
            {a.security.signOutOne}
          </Button>
          <Button variant="ghost" autoFocus onClick={() => setConfirming(false)} disabled={busy}>
            {a.security.keep}
          </Button>
        </div>
      )}
    </li>
  )
}

function DevicesSection({ sessions }: { sessions: ReturnType<typeof useSessions> }) {
  const a = useAccountDict()
  const t = useT()
  const locale = useLocale()
  const toast = useToast()
  const listRef = useRef<HTMLUListElement>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const [busyAll, setBusyAll] = useState(false)
  const { list, others, loading, error, reload, drop } = sessions
  const devices = (n: number) => plural(locale, n, { one: a.security.devicesOne, few: a.security.devicesMany, many: a.security.devicesMany, other: a.security.devicesMany })

  const endOne = async (s: Session) => {
    try {
      await meApi.revokeSession(s.id)
      drop([s.id])
      toast(fmt(a.security.signedOutOne, { device: deviceName(parseDevice(s.device_info), t) }), { tone: 'success' })
      listRef.current?.focus()
    } catch (e) {
      toast((e as ApiError).message, { tone: 'error' })
      throw e
    }
  }

  const endAll = async () => {
    setBusyAll(true)
    try {
      await meApi.revokeOtherSessions()
      drop(others.map((s) => s.id))
      setConfirmAll(false)
      toast(a.security.signedOutAll, { tone: 'success' })
    } catch (e) {
      toast((e as ApiError).message, { tone: 'error' })
    } finally {
      setBusyAll(false)
    }
  }

  return (
    <Section
      title={a.security.devicesTitle}
      lead={a.security.devicesLead}
      aside={
        others.length > 0 && (
          <Button variant="soft" onClick={() => setConfirmAll(true)}>
            {a.security.signOutAll}
          </Button>
        )
      }
    >
      {loading && !list ? (
        <DelayedReveal className="device-list">
          {[0, 1, 2].map((i) => (
            <div key={i} className="device">
              <Skeleton width="2.25rem" height="2.25rem" radius="var(--r-xl)" />
              <div className="skeleton-lines">
                <Skeleton width="40%" height="0.875rem" />
                <Skeleton width="28%" height="0.75rem" />
              </div>
            </div>
          ))}
        </DelayedReveal>
      ) : error && !list ? (
        <LoadError text={error.message} onRetry={reload} className="acc-empty" />
      ) : (
        <>
          <ul className="device-list" ref={listRef} tabIndex={-1} aria-label={a.security.devicesTitle}>
            {list!.map((s) => (
              <DeviceRow key={s.id} s={s} locale={locale} onEnd={endOne} />
            ))}
          </ul>
          {others.length === 0 && (
            <EmptyState
              className="acc-empty"
              title={a.security.onlyHere}
              text={a.security.onlyHereText}
              action={
                <ButtonLink to="/download" variant="soft">
                  {a.security.getApp}
                </ButtonLink>
              }
            />
          )}
        </>
      )}
      <ConfirmModal
        open={confirmAll}
        variant="danger"
        busy={busyAll}
        title={fmt(a.security.confirmAllTitle, { count: others.length, devices: devices(others.length) })}
        message={a.security.confirmAllText}
        confirmLabel={fmt(a.security.confirmAll, { count: others.length, devices: devices(others.length) })}
        onConfirm={endAll}
        onCancel={() => setConfirmAll(false)}
      />
    </Section>
  )
}

/** The session list, this device first. A revoked row leaves the loaded list without a refetch. */
function useSessions() {
  const s = useAsync(() => meApi.sessions(), [])
  const list = s.data
    ?.slice()
    .sort((x, y) => Number(!!y.is_current) - Number(!!x.is_current) || y.last_used_at.localeCompare(x.last_used_at))
  return {
    list,
    others: list?.filter((x) => !x.is_current) ?? [],
    loading: s.loading,
    error: s.error,
    reload: s.reload,
    drop: (ids: string[]) => s.mutate((xs) => xs.filter((x) => !ids.includes(x.id))),
  }
}

export default function AccountSecurity() {
  const a = useAccountDict()
  const sessions = useSessions()
  return (
    <>
      <PageHead title={a.security.title} lead={a.security.lead} />
      <div className="acc-stack">
        <PasswordSection onSignedOutOthers={() => sessions.drop(sessions.others.map((s) => s.id))} />
        <DevicesSection sessions={sessions} />
      </div>
    </>
  )
}
