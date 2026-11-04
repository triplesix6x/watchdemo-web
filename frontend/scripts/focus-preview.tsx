// Dev-only component harness. Vite's production entry does not include this file.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import '../src/styles/index.css'
import { FocusHero } from '../src/features/focus/FocusHero'

const english = new URLSearchParams(location.search).get('lang') === 'en'
document.documentElement.lang = english ? 'en' : 'ru'
const root = document.getElementById('root')
if (!root) throw new Error('Missing Focus verification root')
createRoot(root).render(
  <StrictMode>
    <MemoryRouter initialEntries={[english ? '/en' : '/']}>
      <main>
        <FocusHero version="0.8.4" />
        <section id="focus-cs2" style={{ minHeight: '200vh', padding: '4rem' }}>
          <h2>{english ? 'Anchor verification' : 'Проверка перехода по ссылке'}</h2>
        </section>
      </main>
    </MemoryRouter>
  </StrictMode>,
)
