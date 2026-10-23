// Home (SPEC §2): the site plays like a replay. A real round scrubs on the pinned radar
// while the chapters scroll; each chapter is anchored to one event of the round.
import { useRef, type CSSProperties } from 'react'
import { ArrowDown, Download } from 'lucide-react'
import { fmt, LocalLink, useDict, useLocale } from '../i18n'
import ru from '../i18n/pages/home.ru'
import en from '../i18n/pages/home.en'
import { Head } from '../head/Head'
import { softwareAppLd } from '../head/jsonld'
import { useLatestRelease } from '../lib/useLatestRelease'
import { ButtonLink } from '../ui'
import { Radar } from '../features/radar/Radar'
import { clock, EVENTS } from '../features/radar/round'
import { useStory } from '../features/home/useStory'
import '../features/home/cta.css'
import '../features/home/home.css'

type ChapterId = keyof typeof ru.chapters
// `crop`: the panel each chapter talks about, as the left and top edge of the visible
// region in percent of the 1280x800 screenshot, and the zoom that fits the panel's whole
// width in the frame (the frame shows 1/zoom of the image; keep top + 100/zoom <= 100).
const CHAPTERS: { id: ChapterId; t: number; mark: string; img: string; crop: [x: number, y: number, zoom: number] }[] = [
  { id: 'sets', t: EVENTS.plant, mark: 'plant', img: '/screens/app-set-panel.webp', crop: [42.8, 0, 1.75] },
  { id: 'moments', t: EVENTS.firstKill, mark: 'kill-ct', img: '/screens/app-moments.webp', crop: [30.5, 37.5, 1.6] },
  { id: 'replay', t: EVENTS.retake, mark: 'kill-t', img: '/screens/app-replay-live.webp', crop: [25.6, 19, 1.37] },
  { id: 'notes', t: EVENTS.defuse, mark: 'defuse', img: '/screens/app-info.webp', crop: [26.6, 21, 1.43] },
]

function DownloadMeta({ version, text }: { version?: string; text: string }) {
  const p = useDict({ ru, en })
  return (
    <p className="home-meta num">
      {text}
      {version && <> · {fmt(p.hero.version, { version })}</>}
    </p>
  )
}

export default function Home() {
  const p = useDict({ ru, en })
  const locale = useLocale()
  const latest = useLatestRelease()
  const version = latest.data?.version
  const storyRef = useRef<HTMLElement>(null)
  const radarRef = useRef<HTMLDivElement>(null)
  useStory(storyRef, radarRef)

  return (
    <>
      <Head description={p.meta.description} image="/og.png" jsonLd={softwareAppLd(locale, latest.data)} />
      <section ref={storyRef} className="story container">
        <div className="story-copy">
          <header className="hero">
            <h1 className="hero-title">{p.hero.title}</h1>
            <p className="hero-lead">{p.hero.lead}</p>
            <div className="hero-actions">
              <ButtonLink to="/download" variant="primary" size="lg" className="cta-scrub">
                <Download size={18} aria-hidden />
                {p.hero.download}
              </ButtonLink>
              <a href="#ch-sets" className="btn btn-ghost btn-lg cta-how" data-seek={EVENTS.plant}>
                {p.hero.how}
                <ArrowDown size={18} aria-hidden />
              </a>
            </div>
            <DownloadMeta version={version} text={p.hero.platform} />
          </header>

          {CHAPTERS.map(({ id, t, mark, img, crop }) => {
            const c = p.chapters[id]
            return (
              <article key={id} id={`ch-${id}`} className="chapter" data-t={t} aria-labelledby={`ch-${id}-title`}>
                <h2 id={`ch-${id}-title`} className="chapter-title">
                  {c.title}
                </h2>
                <p className="chapter-event num">
                  <span className={`chapter-mark ${mark}`} aria-hidden="true" />
                  <span>{clock(t)}</span> {c.event}
                </p>
                <p className="chapter-text">{c.text}</p>
                {id === 'sets' && (
                  <div className="keys">
                    <ul className="keys-list" role="list" aria-label={p.keysLabel}>
                      {p.keys.map((k) => (
                        <li key={k.key} className="keys-item" data-key>
                          <kbd className="keycap">{k.key}</kbd>
                          <span>{k.label}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="keys-hint">{p.keysHint}</p>
                  </div>
                )}
                <figure className="chapter-shot" data-reveal="up" style={{ '--crop-x': `${-crop[0]}%`, '--crop-y': `${-crop[1]}%`, '--zoom': crop[2] } as CSSProperties}>
                  <img src={img} width={1280} height={800} alt={c.alt} loading="lazy" decoding="async" />
                </figure>
              </article>
            )
          })}

          <section className="chapter chapter-final" aria-labelledby="final-title">
            <h2 id="final-title" className="final-title">
              {p.final.title}
            </h2>
            <p className="final-text">{p.final.text}</p>
            <div className="final-actions">
              <ButtonLink to="/download" variant="primary" size="lg" className="cta-scrub">
                <Download size={18} aria-hidden />
                {p.hero.download}
              </ButtonLink>
              <DownloadMeta version={version} text={p.hero.platform} />
            </div>
            <p className="pricing-teaser">
              {p.pricing.text}{' '}
              <LocalLink to="/pricing" className="link">
                {p.pricing.link}
              </LocalLink>
            </p>
          </section>
        </div>

        <div className="story-stage island">
          <Radar ref={radarRef} intro initial={EVENTS.hero} alt={p.radar.alt} caption={p.radar.caption} sliderLabel={p.radar.slider} />
        </div>
      </section>

    </>
  )
}
