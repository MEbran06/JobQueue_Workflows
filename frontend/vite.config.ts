import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/definitions': 'http://localhost:3000',
      '/runs': 'http://localhost:3000',
    },
    fs: {
      // allow importing shared types from ../src/types.ts (repo root's backend types)
      allow: ['..'],
    },
  },
})
