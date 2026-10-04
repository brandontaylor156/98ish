import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import youtubeHandler from './api/youtube.js'
import waybackHandler from './api/wayback.js'
import a11yCss from './postcss-a11y.js'
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

// Add/Remove Programs shows each program's size: its own code and styles, by chunk name
const programSizes = () => ({
  name: 'program-sizes',
  apply: 'build',
  generateBundle(options, bundle) {
    const sizes = {}
    for (const file of Object.values(bundle)) {
      if (file.type !== 'chunk' || !file.isDynamicEntry) continue
      let bytes = file.code.length
      for (const css of file.viteMetadata?.importedCss || []) bytes += bundle[css]?.source?.length || 0
      sizes[file.name] = (sizes[file.name] || 0) + bytes
    }
    this.emitFile({ type: 'asset', fileName: 'program-sizes.json', source: JSON.stringify(sizes) })
  },
})

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Server-only secrets (no VITE_ prefix) for the /api/youtube dev middleware
  process.env.YOUTUBE_KEY ??= loadEnv(mode, process.cwd(), '').YOUTUBE_KEY

  return {
    plugins: [
      react(),
      programSizes(),
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
      // Accessibility Options: text size, title bar height and less motion everywhere
      postcss: { plugins: [a11yCss()] },
    },
  }
})
