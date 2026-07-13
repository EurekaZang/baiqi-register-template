import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/chat/',
  server: {
    port: 5173,
    proxy: {
      '/chat/api': {
        target: 'http://127.0.0.1:8091',
        rewrite: (p) => p.replace(/^\/chat/, ''),
      },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
