import { useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { Button, LoadError, Note } from '../../ui'
import { socialApi, type SocialIntent, type SocialProvider } from './socialApi'
import { useSocialDict } from './socialDict'
import './social-auth.css'

export function SocialAuthButtons({ mode = 'login', onError }: { mode?: SocialIntent; onError?: (message: string) => void }) {
  const d = useSocialDict()
  const [busy, setBusy] = useState<SocialProvider | null>(null)
  const [error, setError] = useState<string | null>(null)
  const options = useAsync(async () => {
    if (mode === 'login') {
      const providers = await socialApi.providers()
      return { steam: { available: providers.steam, linked: false }, faceit: { available: providers.faceit, linked: false } }
    }
    return socialApi.connections()
  }, [mode])
  const start = async (provider: SocialProvider) => {
    setBusy(provider)
    setError(null)
    try {
      const result = await socialApi.start(provider, mode)
      window.location.assign(result.authorization_url)
    } catch (e) {
      const message = e instanceof Error ? e.message : d.failed
      setError(message)
      onError?.(message)
      setBusy(null)
    }
  }
  const data = options.data
  return <div className="social-auth" aria-busy={!!busy || options.loading}>
    {options.loading && <p role="status">{d.loading}</p>}
    {options.error && <LoadError text={options.error.message} onRetry={options.reload} />}
    {data && <div className="social-auth-actions">
      {(['steam', 'faceit'] as const).map((provider) => {
        const option = data[provider]
        const disabled = !option.available || (mode === 'link' && option.linked) || (mode === 'reauth' && !option.linked)
        return <Button key={provider} variant="soft" disabled={disabled || !!busy} loading={busy === provider}
          onClick={() => void start(provider)} title={!option.available ? d.unavailable : undefined}>
          {mode === 'link' && option.linked ? d.linked : mode === 'login' ? d.continue : mode === 'link' ? d.link : d.verify} {provider === 'steam' ? 'Steam' : 'FACEIT'}
        </Button>
      })}
    </div>}
    {data && !Object.values(data).some((option) => option.available) && <Note>{d.unavailable}</Note>}
    {error && <Note tone="danger">{error}</Note>}
  </div>
}
