import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Mock API mode: `--mode mock` reads .env.mock (VITE_MOCK_API=1), or set the variable in
// the shell. __MOCK__ is a compile-time constant, so normal builds drop src/api/mock.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
  return {
    plugins: [react()],
    define: { __MOCK__: JSON.stringify(env.VITE_MOCK_API === '1') },
    // gsap has no "exports" map, so Node cannot resolve 'gsap/SplitText' in the server
    // bundle; bundle it instead.
    ssr: { noExternal: ['gsap'] },
    server: {
      proxy: { '/api': 'https://watchdemo.pro' },
    },
  }
})
