import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles/index.css'
import App from './App'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

// iOS Safari applies :active (the press feedback) only when a touch listener exists.
document.addEventListener('touchstart', () => {}, { passive: true })

const app = (
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)

// Prerendered public pages arrive with markup: hydrate it. SPA routes get the empty
// shell (app.html): render from scratch.
if (root.hasChildNodes()) hydrateRoot(root, app)
else createRoot(root).render(app)
