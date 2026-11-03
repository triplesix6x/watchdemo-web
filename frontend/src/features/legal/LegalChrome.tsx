import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { LocalLink, useLocale } from '../../i18n'
import { Button, Dialog } from '../../ui'

const CookieSettings = createContext<(() => void) | null>(null)
const NOTICE_KEY = 'wd-necessary-notice-dismissed'

export function LegalProvider({ children }: { children: ReactNode }) {
  const en = useLocale() === 'en'
  const [notice, setNotice] = useState(false)
  const [settings, setSettings] = useState(false)
  useEffect(() => {
    try { setNotice(localStorage.getItem(NOTICE_KEY) !== '1') } catch { setNotice(true) }
  }, [])
  const dismiss = () => {
    setNotice(false)
    try { localStorage.setItem(NOTICE_KEY, '1') } catch { /* Dismissal can remain session-only when storage is blocked. */ }
  }
  return (
    <CookieSettings.Provider value={() => setSettings(true)}>
      {children}
      {notice && <aside className="cookie-notice card-raised" aria-label={en ? 'Necessary storage' : 'Необходимые cookies'}>
        <p>{en ? 'We use necessary cookies and local storage for sign-in and site settings. Analytics is not connected.' : 'Мы используем необходимые cookies и локальное хранилище для входа и настроек сайта. Аналитика не подключена.'} <LocalLink to="/legal/cookies" className="link">{en ? 'Details' : 'Подробнее'}</LocalLink></p>
        <div className="legal-actions"><Button variant="soft" onClick={() => setSettings(true)}>{en ? 'Settings' : 'Настройки'}</Button><Button variant="primary" onClick={dismiss}>{en ? 'Got it' : 'Понятно'}</Button></div>
      </aside>}
      <Dialog open={settings} onClose={() => setSettings(false)} title={en ? 'Cookie settings' : 'Настройки cookies'} size="sm" footer={<Button variant="primary" onClick={() => setSettings(false)}>{en ? 'Close' : 'Закрыть'}</Button>}>
        <div className="legal-settings">
          <h3>{en ? 'Necessary storage — always active' : 'Необходимое хранение — всегда активно'}</h3>
          <p>{en ? 'Used for authentication, security, language and interface preferences. The first-visit notice dismissal is saved locally.' : 'Для авторизации, безопасности, языка и настроек интерфейса. Закрытие уведомления первого визита сохраняется локально.'}</p>
          <h3>{en ? 'Analytics — not connected' : 'Аналитика — не подключена'}</h3>
          <p>{en ? 'No analytics trackers run. Dismissing this notice is not consent to future analytics. Connecting analytics will require a separate choice; it will be off by default.' : 'Трекеры аналитики не запускаются. Закрытие уведомления не означает согласия на будущую аналитику. Для её подключения потребуется отдельный выбор; по умолчанию она будет выключена.'}</p>
          <LocalLink to="/legal/cookies" className="link" onClick={() => setSettings(false)}>{en ? 'Cookies and local storage document' : 'Документ о cookies и локальном хранении'}</LocalLink>
        </div>
      </Dialog>
    </CookieSettings.Provider>
  )
}

export function LegalFooter() {
  const en = useLocale() === 'en'
  const open = useContext(CookieSettings)
  const links = [
    ['/legal', en ? 'Documents' : 'Документы'],
    ['/legal/terms', en ? 'Terms' : 'Условия'],
    ['/legal/offer', en ? 'Offer' : 'Оферта'],
    ['/legal/privacy', en ? 'Privacy' : 'Конфиденциальность'],
    ['/legal/cookies', 'Cookies'],
    ['/legal/details', en ? 'Operator details' : 'Реквизиты'],
  ]
  return <nav className="legal-footer" aria-label={en ? 'Legal documents' : 'Правовые документы'}>
    {links.map(([to, label]) => <LocalLink to={to} key={to} className="footer-link">{label}</LocalLink>)}
    <button type="button" className="footer-link" onClick={open ?? undefined}>{en ? 'Cookie settings' : 'Настройки cookies'}</button>
  </nav>
}

export function EmailDisclosure() {
  const en = useLocale() === 'en'
  return <p className="legal-email t-muted t-s">{en ? 'Service emails are sent through Resend. ' : 'Сервисные письма отправляются через Resend. '}<LocalLink to="/legal/privacy" target="_blank" rel="noopener noreferrer" className="link">{en ? 'About email processing (opens in a new tab)' : 'Об обработке почты (новая вкладка)'}</LocalLink></p>
}
