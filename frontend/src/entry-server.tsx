// Server render for the prerender step (scripts/prerender.mjs). Built with `vite build --ssr`.
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import App from './App'
import { HeadCollector, headToHtml } from './head/Head'
export { appShellHeadHtml } from './head/Head'
import { localizedPath, LOCALES, splitLocale } from './i18n'
import { PRERENDER_PATHS } from './router/routes'

export { PRERENDER_PATHS, LOCALES, localizedPath }
export { SITE_URL } from './config'

export function render(url: string) {
  const sink: { data: Parameters<typeof headToHtml>[0] | null } = { data: null }
  const html = renderToString(
    <HeadCollector.Provider value={sink}>
      <StaticRouter location={url}>
        <App />
      </StaticRouter>
    </HeadCollector.Provider>,
  )
  if (!sink.data) throw new Error(`No <Head> rendered for ${url}: every prerendered page needs one`)
  return { html, head: headToHtml(sink.data), lang: splitLocale(url).locale }
}
