import { useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { Button, LoadError, Note } from '../../ui'
import { socialApi, type SocialIntent, type SocialProvider } from './socialApi'
import { useSocialDict } from './socialDict'
import './social-auth.css'

function ProviderIcon({ provider }: { provider: SocialProvider }) {
  return <svg className="social-provider-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    {provider === 'faceit'
      ? <path d="M24 2.7c0-.1-.1-.2-.1-.2-.1 0-.1 0-.2.1-2 3.1-4.1 6.2-6.1 9.4H.2c-.2 0-.3.3-.1.4 7.2 2.7 17.7 6.8 23.5 9.1.2.1.4-.1.4-.2V2.7z" />
      : <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015s1.35 3.015 3.015 3.015c1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266s-1.017 2.265-2.266 2.265c-1.253 0-2.265-1.014-2.265-2.265z" />}
  </svg>
}

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
        const disabled = (mode !== 'login' && !option.available) || (mode === 'link' && option.linked) || (mode === 'reauth' && !option.linked)
        return <Button key={provider} variant="soft" className={`social-provider social-provider-${provider}`} disabled={disabled || !!busy} loading={busy === provider}
          onClick={() => void start(provider)} title={mode !== 'login' && !option.available ? d.unavailable : undefined}>
          <ProviderIcon provider={provider} />
          <span>{mode === 'link' && option.linked ? d.linked : mode === 'login' ? d.continue : mode === 'link' ? d.link : d.verify} {provider === 'steam' ? 'Steam' : 'FACEIT'}</span>
        </Button>
      })}
    </div>}
    {error && <Note tone="danger">{error}</Note>}
  </div>
}
