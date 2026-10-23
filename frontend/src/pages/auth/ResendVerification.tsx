import { useSearchParams } from 'react-router-dom'
import { authApi } from '../../api/endpoints'
import { EmailLinkForm } from '../../features/auth/EmailLinkForm'
import { useAuthDict } from '../../features/auth/parts'

export default function ResendVerification() {
  const d = useAuthDict()
  const [params] = useSearchParams()
  return (
    <EmailLinkForm
      title={d.resend.title}
      lead={d.resend.lead}
      submitLabel={d.resend.submit}
      doneTitle={d.resend.doneTitle}
      doneText={d.resend.doneText}
      send={authApi.resendVerification}
      initialEmail={params.get('email') ?? ''}
    />
  )
}
