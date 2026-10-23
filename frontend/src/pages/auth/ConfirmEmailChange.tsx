import { authApi } from '../../api/endpoints'
import { ButtonLink } from '../../ui'
import { useAuthDict } from '../../features/auth/parts'
import { TokenLinkPage } from '../../features/auth/TokenLinkPage'

export default function ConfirmEmailChange() {
  const d = useAuthDict()
  return (
    <TokenLinkPage
      kind="email-change"
      run={authApi.confirmEmailChange}
      title={d.confirmEmail.title}
      pending={d.confirmEmail.pending}
      failedTitle={d.confirmEmail.badTitle}
      noToken={d.verify.noToken}
      doneToast={d.confirmEmail.doneToast}
      signedInTo="/account/profile"
      signedOutNotice="emailChanged"
      recovery={
        <div className="auth-actions">
          <p className="auth-text">{d.confirmEmail.badHint}</p>
          <ButtonLink to="/account/profile" variant="primary" size="lg" block>
            {d.common.toProfile}
          </ButtonLink>
        </div>
      }
    />
  )
}
