import { useLocation } from 'react-router-dom'
import { splitLocale, useLocale } from '../i18n'
import { Head } from '../head/Head'
import { isPublicLegalPath } from '../features/legal/publicRoutes'
import NotFound from './NotFound'

// Public information about the storage actually used by the site. The historical
// draft catalog remains unchanged and is not used to render public documents.
export default function Legal() {
  const en = useLocale() === 'en'
  const { path } = splitLocale(useLocation().pathname)
  if (!isPublicLegalPath(path)) return <NotFound />
  const title = en ? 'Cookies and local storage' : 'Cookies и локальное хранение'
  return <div className="container pp legal-page">
    <Head title={title} noindex />
    <header className="pp-head">
      <h1>{title}</h1>
      <p className="t-lead">{en ? 'The site uses necessary storage for sign-in, security and interface settings. Analytics is not connected.' : 'Сайт использует необходимое хранение для входа, безопасности и настроек интерфейса. Аналитика не подключена.'}</p>
    </header>
    <section className="pp-section legal-settings" aria-labelledby="necessary-storage">
      <h2 id="necessary-storage" className="pp-h2">{en ? 'Necessary storage' : 'Необходимое хранение'}</h2>
      <p>{en ? 'Authentication cookies keep your session active. HttpOnly cookies are managed by the server and are not available to page scripts. Browser storage also remembers your language, interface preferences and whether you dismissed the first-visit notice.' : 'Cookies авторизации поддерживают сеанс входа. Cookies с флагом HttpOnly управляются сервером и недоступны скриптам страницы. Хранилище браузера также запоминает язык, настройки интерфейса и закрытие уведомления первого визита.'}</p>
      <p>{en ? 'These functions do not have an optional toggle. Blocking or deleting this storage in your browser can sign you out or reset your settings. You can manage stored site data in your browser settings.' : 'Для этих функций нет отдельного переключателя. Блокировка или удаление данных сайта в браузере может завершить сеанс входа или сбросить настройки. Управлять сохранёнными данными сайта можно в настройках браузера.'}</p>
    </section>
    <section className="pp-section legal-settings" aria-labelledby="analytics-storage">
      <h2 id="analytics-storage" className="pp-h2">{en ? 'No optional analytics' : 'Без необязательной аналитики'}</h2>
      <p>{en ? 'No analytics trackers run. Closing the notice is not consent to future analytics. If optional analytics is introduced, it will be off by default and will require a separate choice.' : 'Трекеры аналитики не запускаются. Закрытие уведомления не означает согласия на будущую аналитику. Если необязательная аналитика появится, по умолчанию она будет выключена и потребует отдельного выбора.'}</p>
      <p>{en ? 'Open “Cookie settings” in the footer at any time to review the current storage settings.' : 'Открыть текущие настройки хранения можно в любой момент кнопкой «Настройки cookies» внизу страницы.'}</p>
    </section>
  </div>
}
