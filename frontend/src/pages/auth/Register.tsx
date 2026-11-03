import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { authApi, legalApi } from '../../api/endpoints'
import { LocalLink, useLocale, useLp, useT } from '../../i18n'
import { useAsync } from '../../lib/useAsync'
import { ApiError } from '../../api/errors'
import { legalCatalog } from '../../features/legal/catalog'
import { displayedTerms, legalAcceptance } from '../../features/legal/signupPolicy'
import { EmailDisclosure } from '../../features/legal/LegalChrome'
import { useForm } from '../../lib/useForm'
import { Button, ButtonLink, Checkbox, Field, Input, Note } from '../../ui'
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
  const [resending, setResending] = useState(false)
  const [resendError, setResendError] = useState('')
  const policy = useAsync(() => legalApi.signupPolicy(), [])
  const [acceptedPolicy, setAcceptedPolicy] = useState<string | null>(null)
  const [policyMessage, setPolicyMessage] = useState('')
  const [stale, setStale] = useState(false)
  const en = locale === 'en'
  const currentPolicy = !policy.loading && !policy.error && !stale ? policy.data : undefined
  const terms = currentPolicy ? displayedTerms(currentPolicy, legalCatalog.documents) : undefined
  const checked = currentPolicy?.mode === 'enforced' && acceptedPolicy === currentPolicy.policy_id
  const ready = !!currentPolicy && (currentPolicy.mode === 'draft' || (!!terms && checked))
  const reloadPolicy = () => {
    setAcceptedPolicy(null)
    setStale(false)
    policy.reload()
  }
  const resend = async () => {
    if (!sentTo || resending) return
    setResending(true)
    setResendError('')
    try { await authApi.resendVerification(sentTo); setResent(true) }
    catch (e) { setResendError(e instanceof ApiError ? e.message : t.errors.unknown) }
    finally { setResending(false) }
  }
  const form = useForm(
    { email: '', username: '', password: '' },
    { email: (v) => emailError(v, t), username: (v) => usernameError(v, t), password: (v) => passwordError(v, t) },
    { email_taken: 'email', username_taken: 'username', password_weak: 'password' },
  )

  if (user) return <Navigate to={lp('/account')} replace />

  const submit = form.onSubmit(async (v) => {
    const email = v.email.trim()
    if (!ready || !currentPolicy) return
    const acceptance = legalAcceptance(currentPolicy, checked, legalCatalog.documents)
    try {
      await authApi.register({ email, username: v.username.trim(), password: v.password, locale, ...(acceptance ? { legal_acceptance: acceptance } : {}) })
      setSentTo(email)
    } catch (e) {
      if (e instanceof ApiError && (
        (e.status === 409 && e.code !== 'email_taken' && e.code !== 'username_taken') ||
        (e.status === 422 && e.code === 'validation_failed' && e.reason === 'legal_acceptance_required')
      )) {
        setStale(true)
        setAcceptedPolicy(null)
        setPolicyMessage(en ? 'The signup documents changed. Your fields are saved. Reload the policy, review the required revision and accept it again. If the text is not available, reload the page after saving your fields.' : 'Документы регистрации изменились. Поля сохранены. Обновите условия, прочитайте требуемую редакцию и подтвердите её заново. Если текста нет, сохраните поля и перезагрузите страницу.')
        return
      }
      throw e
    }
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
              loading={resending}
              onClick={resend}
            >
              <MailCheck size={15} aria-hidden />
              {d.register.resend}
            </Button>
          )}
          {resendError && <Note tone="danger">{resendError}</Note>}
          <EmailDisclosure />
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
        <div className="signup-policy">
          {policy.loading ? <p role="status">{en ? 'Loading signup policy…' : 'Загружаем условия регистрации…'}</p> : null}
          {policy.error && <Note tone="danger">{en ? 'Could not load the signup policy. Registration is unavailable until it loads.' : 'Не удалось загрузить условия регистрации. Регистрация недоступна до загрузки.'}</Note>}
          {currentPolicy?.mode === 'draft' && <Note tone="warning">{en ? 'The legal documents are drafts and are not in force. No acceptance of drafts is requested.' : 'Правовые документы — черновики и пока не действуют. Принятие черновиков не запрашивается.'} <LocalLink to="/legal" target="_blank" rel="noopener noreferrer" className="link">{en ? 'Read drafts (new tab)' : 'Читать черновики (новая вкладка)'}</LocalLink></Note>}
          {currentPolicy?.mode === 'enforced' && terms && <>
            <Checkbox checked={checked} onChange={(value) => setAcceptedPolicy(value ? currentPolicy.policy_id : null)} label={<>{en ? 'I accept the ' : 'Я принимаю '}<LocalLink to={terms.url} target="_blank" rel="noopener noreferrer" className="link">{en ? 'Terms of Use (new tab)' : 'Условия использования (новая вкладка)'}</LocalLink></>} />
            <p className="signup-revision">{en ? 'Required revision' : 'Требуемая редакция'}: {terms.revision}<br />SHA-256: {terms.sha256}</p>
          </>}
          {currentPolicy?.mode === 'enforced' && !terms && <Note tone="danger">{en ? 'The required revision is not available in this version of the site. Registration is blocked; save your fields and reload the page to get the updated text.' : 'Требуемой редакции нет в этой версии сайта. Регистрация заблокирована: сохраните поля и перезагрузите страницу для обновления текста.'}</Note>}
          {currentPolicy && <LocalLink to={currentPolicy.privacy_url.replace(/^\/en\//, '/')} target="_blank" rel="noopener noreferrer" className="link">{en ? 'Privacy policy — information on processing (new tab)' : 'Политика конфиденциальности — сведения об обработке (новая вкладка)'}</LocalLink>}
          {policyMessage && <Note tone="warning">{policyMessage}</Note>}
          {(policy.error || stale) && <Button variant="soft" onClick={reloadPolicy}>{en ? 'Reload signup policy' : 'Обновить условия регистрации'}</Button>}
          <EmailDisclosure />
        </div>
        {form.failure && <Note tone="danger">{form.failure}</Note>}
        <Button type="submit" variant="primary" size="lg" block loading={form.submitting} disabled={!ready}>
          {d.register.submit}
        </Button>
      </form>
    </AuthCard>
  )
}
