// 404 (SPEC §2): the radar of an empty round. No players, nothing on the timeline, the
// clock at 0:00. nginx serves this page's prerendered HTML with a real 404 status.
import { useDict, useT } from '../i18n'
import ru from '../i18n/pages/home.ru'
import en from '../i18n/pages/home.en'
import { Head } from '../head/Head'
import { Download } from 'lucide-react'
import { ButtonLink } from '../ui'
import { Radar } from '../features/radar/Radar'
import '../features/home/cta.css'
import '../features/home/lost.css'

export default function NotFound() {
  const t = useT()
  const p = useDict({ ru, en })
  return (
    <section className="lost container">
      <Head title={t.notFound.title} description={t.notFound.description} noindex />
      <div className="lost-copy">
        <h1 className="lost-title">{t.notFound.heading}</h1>
        <p className="lost-text">{t.notFound.text}</p>
        <div className="hero-actions">
          <ButtonLink to="/" variant="primary" size="lg" className="cta-scrub">
            {t.actions.goHome}
          </ButtonLink>
          <ButtonLink to="/download" variant="ghost" size="lg" className="cta-how">
            {p.hero.download}
            <Download size={18} aria-hidden />
          </ButtonLink>
        </div>
      </div>
      <div className="lost-stage">
        <Radar empty alt={p.radar.emptyAlt} caption={p.radar.emptyCaption} />
      </div>
    </section>
  )
}
