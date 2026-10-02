import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import youtubeHandler from './api/youtube.js'
import waybackHandler from './api/wayback.js'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Server-only secrets (no VITE_ prefix) for the /api/youtube dev middleware
  process.env.YOUTUBE_KEY ??= loadEnv(mode, process.cwd(), '').YOUTUBE_KEY

  return {
    plugins: [
      react(),
      {
        // Serve the Vercel function locally so `npm run dev` matches production
        name: 'dev-api',
        configureServer(server) {
          server.middlewares.use('/api/youtube', youtubeHandler)
          server.middlewares.use('/api/wayback', waybackHandler)
        },
      },
    ],
    css: {
      // 98.css ships `@media (not(hover))`, which Lightning CSS rejects
      lightningcss: { errorRecovery: true },
    },
  }
})
