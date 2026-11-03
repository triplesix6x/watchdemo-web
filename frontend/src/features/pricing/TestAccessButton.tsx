import { useAuth } from '../../context/AuthContext'
import { SUPPORT_BOT_URL } from '../../config'
import { useT } from '../../i18n'
import { ButtonLink } from '../../ui'
import type { ButtonVariant } from '../../ui/Button'

/** Sales are closed. Use the existing support channel, never a checkout or a guest form. */
export function TestAccessButton({ variant = 'soft', size = 'md', block }: { variant?: ButtonVariant; size?: 'md' | 'lg'; block?: boolean }) {
  const { user } = useAuth()
  const t = useT()
  const props = { variant, size, block }
  return user ? <ButtonLink to="/help#support-chat" {...props}>{t.actions.getAccess}</ButtonLink> : <ButtonLink href={SUPPORT_BOT_URL} {...props}>{t.actions.getAccess}</ButtonLink>
}
