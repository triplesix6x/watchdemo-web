// Shared body of the pages an email link opens (verify email, confirm email change):
// spend the token on arrival behind the logo loader, then hand off to the next page.
import { useEffect, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useLp } from '../../i18n'
import { DelayedReveal, LogoLoader, useToast } from '../../ui'
import { Head } from '../../head/Head'
import { AuthCard } from './parts'
import { useTokenLink } from './useTokenLink'

export function TokenLinkPage({
  kind,
  run,
  title,
  pending,
  failedTitle,
  noToken,
  doneToast,
  signedInTo,
  signedOutNotice,
  recovery,
}: {
  kind: string
  run: (token: string) => Promise<unknown>
  title: string
  pending: string
  failedTitle: string
  /** Shown when the URL has no token at all. */
  noToken: string
  doneToast: string
  /** Where a signed-in visitor lands after success. */
  signedInTo: string
  /** The login notice for a visitor who is not signed in. */
  signedOutNotice: string
  /** The way out of a failed link: one action, sometimes with a hint. */
  recovery: ReactNode
}) {
  const token = useSearchParams()[0].get('token')
  const state = useTokenLink(kind, token, run)
  const { user, isLoading, refreshUser } = useAuth()
  const navigate = useNavigate()
  const lp = useLp()
  const toast = useToast()

  useEffect(() => {
    if (state?.status !== 'done' || isLoading) return
    if (user) {
      refreshUser().catch(() => {})
      toast(doneToast, { tone: 'success' })
      navigate(lp(signedInTo), { replace: true })
    } else navigate(lp('/login'), { replace: true, state: { notice: signedOutNotice } })
    // Runs once when the link resolves and the session check has finished.
  }, [state?.status, isLoading])

  if (!state || state.status === 'failed')
    return (
      <AuthCard title={failedTitle} lead={state ? state.error.message : noToken}>
        {recovery}
      </AuthCard>
    )
  return (
    <div className="auth-page">
      <Head title={title} noindex />
      <h1 className="sr-only">{title}</h1>
      <DelayedReveal delay={150}>
        <LogoLoader size={56} label={pending} />
      </DelayedReveal>
    </div>
  )
}
