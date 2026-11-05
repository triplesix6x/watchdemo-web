import { defineConfig } from 'vite';
export default defineConfig({
  base: '/',
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 4402, strictPort: true },
  preview: { host: '127.0.0.1', port: 4402, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
