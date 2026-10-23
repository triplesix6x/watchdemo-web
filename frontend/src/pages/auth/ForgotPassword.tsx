import { authApi } from '../../api/endpoints'
import { EmailLinkForm } from '../../features/auth/EmailLinkForm'
import { useAuthDict } from '../../features/auth/parts'

export default function ForgotPassword() {
  const d = useAuthDict()
  return (
    <EmailLinkForm
      title={d.forgot.title}
      lead={d.forgot.lead}
      submitLabel={d.forgot.submit}
      doneTitle={d.forgot.doneTitle}
      doneText={d.forgot.doneText}
      send={authApi.forgotPassword}
    />
  )
}
