import { useEffect, useState } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { authApi } from '../../api/endpoints'
import { ApiError, Code } from '../../api/errors'
import { LocalLink, useLp, useT } from '../../i18n'
import { useForm } from '../../lib/useForm'
import { Button, ButtonLink, Field, Input, Note } from '../../ui'
import { AuthCard, PasswordInput, fill, useAuthDict } from '../../features/auth/parts'
import { isEmail, requiredError, safeNext } from '../../features/auth/rules'

type Notice = 'verified' | 'reset' | 'emailChanged'
/** What the last attempt ran into. A lockout carries its end time for the countdown. */
type Problem =
  | { kind: 'locked'; until: number }
  | { kind: 'unlocked' }
  | { kind: 'unverified'; resent: boolean }
  | { kind: 'error'; message: string }

function toProblem(err: ApiError): Problem {
  if ((err.code === Code.TOO_MANY_ATTEMPTS || err.code === Code.RATE_LIMITED) && err.retryAfter) return { kind: 'locked', until: Date.now() + err.retryAfter * 1000 }
  if (err.code === Code.EMAIL_NOT_VERIFIED) return { kind: 'unverified', resent: false }
  return { kind: 'error', message: err.message }
}

/** "4:59" until `until`, then onEnd. A seconds counter, not an animation. */
function Countdown({ until, onEnd }: { until: number; onEnd: () => void }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const left = Math.max(0, Math.ceil((until - now) / 1000))
  useEffect(() => {
    if (left === 0) onEnd()
  }, [left, onEnd])
  return <span className="num">{`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</span>
}

export default function Login() {
  const d = useAuthDict()
  const t = useT()
  const lp = useLp()
  const { user, login } = useAuth()
  const { state } = useLocation()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const notice = ((state as { notice?: Notice } | null)?.notice ?? params.get('notice')) as Notice | null
  const [problem, setProblem] = useState<Problem | null>(null)
  const form = useForm(
    { login: '', password: '' },
    { login: (v) => requiredError(v, t), password: (v) => (v ? null : t.validation.required) },
  )

  if (user) return <Navigate to={next ?? lp('/account')} replace />

  // Every failure here is a Problem with its own UI, so nothing reaches form.failure.
  const submit = form.onSubmit(async (v) => {
    setProblem(null)
    try {
      await login(v.login.trim(), v.password)
    } catch (e) {
      if (!(e instanceof ApiError)) throw e
      setProblem(toProblem(e))
    }
  })

  const resend = async () => {
    await authApi.resendVerification(form.values.login.trim()).catch(() => {})
    setProblem({ kind: 'unverified', resent: true })
  }

  return (
    <AuthCard
      title={d.login.title}
      lead={d.login.lead}
      foot={
        <>
          <span>{d.login.noAccount}</span>
          <LocalLink to="/register" className="link">
            {d.login.register}
          </LocalLink>
        </>
      }
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        {notice && d.login.notices[notice] && !problem && <Note tone="success">{d.login.notices[notice]}</Note>}
        <Field label={d.login.login} error={form.errors.login} required>
          <Input {...form.field('login')} autoComplete="username" autoCapitalize="none" spellCheck={false} />
        </Field>
        <div className="field-with-link">
          <Field label={d.common.password} error={form.errors.password} required>
            <PasswordInput {...form.field('password')} autoComplete="current-password" />
          </Field>
          <LocalLink to="/forgot-password" className="link">
            {d.login.forgot}
          </LocalLink>
        </div>

        {problem?.kind === 'error' && <Note tone="danger">{problem.message}</Note>}
        {problem?.kind === 'locked' && (
          <Note tone="warning">
            <span>{fill(d.login.lockedIn, { time: <Countdown until={problem.until} onEnd={() => setProblem({ kind: 'unlocked' })} /> })}</span>
          </Note>
        )}
        {problem?.kind === 'unlocked' && <Note>{d.login.unlocked}</Note>}
        {problem?.kind === 'unverified' && (
          <Note tone={problem.resent ? 'success' : 'warning'}>
            {problem.resent ? (
              d.login.resent
            ) : (
              <>
                <span>{d.login.unverified}</span>
                {isEmail(form.values.login) ? (
                  <Button variant="soft" onClick={resend}>
                    {d.login.resend}
                  </Button>
                ) : (
                  <ButtonLink variant="soft" to="/resend-verification">
                    {d.login.resend}
                  </ButtonLink>
                )}
              </>
            )}
          </Note>
        )}

        <Button type="submit" variant="primary" size="lg" block loading={form.submitting}>
          {!form.submitting && <LogIn size={15} aria-hidden />}
          {d.login.submit}
        </Button>
      </form>
    </AuthCard>
  )
}
