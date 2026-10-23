import { authApi } from '../../api/endpoints'
import { ButtonLink } from '../../ui'
import { useAuthDict } from '../../features/auth/parts'
import { TokenLinkPage } from '../../features/auth/TokenLinkPage'

export default function VerifyEmail() {
  const d = useAuthDict()
  return (
    <TokenLinkPage
      kind="verify"
      run={authApi.verifyEmail}
      title={d.verify.title}
      pending={d.verify.pending}
      failedTitle={d.verify.badTitle}
      noToken={d.verify.noToken}
      doneToast={d.verify.doneToast}
      signedInTo="/account"
      signedOutNotice="verified"
      recovery={
        <ButtonLink to="/resend-verification" variant="primary" size="lg" block>
          {d.verify.requestNew}
        </ButtonLink>
      }
    />
  )
}
