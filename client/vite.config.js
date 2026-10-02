import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import youtubeHandler from './api/youtube.js'
import waybackHandler from './api/wayback.js'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Lists every built file and public asset for the service worker (public/sw.js) to
// save for offline use. A new version string each build gives each deploy its own cache.
const swManifest = () => ({
  name: 'sw-manifest',
  apply: 'build',
  generateBundle(options, bundle) {
    const files = Object.keys(bundle).map((f) => '/' + f)
    const walk = (dir) =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name)
        return statSync(full).isDirectory() ? walk(full) : ['/' + relative('public', full).replace(/[\\/]+/g, '/')]
      })
    const skip = new Set(['/sw.js', '/sw-manifest.json'])
    const all = [...new Set([...files, ...walk('public')])].filter((f) => !skip.has(f) && !f.endsWith('.map'))
    this.emitFile({
      type: 'asset',
      fileName: 'sw-manifest.json',
      source: JSON.stringify({ version: String(Date.now()), files: all }),
    })
  },
})

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Server-only secrets (no VITE_ prefix) for the /api/youtube dev middleware
  process.env.YOUTUBE_KEY ??= loadEnv(mode, process.cwd(), '').YOUTUBE_KEY

  return {
    plugins: [
      react(),
      swManifest(),
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
