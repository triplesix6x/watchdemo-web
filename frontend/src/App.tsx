import { AuthProvider } from './context/AuthContext'
import { LocaleSync } from './i18n'
import { Engine } from './engine/react'
import { ToastProvider } from './ui'
import { AppRoutes, isTransitionPath } from './router/routes'

/** The whole app, router-agnostic: main.tsx wraps it in BrowserRouter, the prerender in
 *  StaticRouter. */
export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <LocaleSync />
        <Engine isTransitionPath={isTransitionPath} />
        <AppRoutes />
      </ToastProvider>
    </AuthProvider>
  )
}
