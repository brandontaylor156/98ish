import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import youtubeHandler from './api/youtube.js'
import waybackHandler from './api/wayback.js'
import a11yCss from './postcss-a11y.js'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { releaseNotes } from './releaseNotes.mjs'

// one version per build: the service worker's cache name, the app's own idea of its version
// (__BUILD_VERSION__) and 98ish Update's "is there a newer one?" all use it
const BUILD_VERSION = String(Date.now())

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
    // (Venue Finder's index, megabytes of shards, loads only when someone searches; Floppy's
    // brain, the AI worker and its 27 MB WebAssembly runtime, only for people who opt in; and
    // LAN Party 98's game bundles and disk images under /emu/, loaded when a game starts; and
    // Spark, the 2.6 MB splat renderer, only for people who add a photoreal backdrop; and
    // Pickleball's High skins (KTX2, about 450 KB each, fetched per skin tone on High, with
    // their transcoder's .wasm): not precached)
    // (and Pickleball's photographed faces, about 0.7 MB each, fetched per face a match shows)
    const onDemand = (f) => f.startsWith('/assets/pickleball/pl-face-') || f.startsWith('/venues/idx/') || f.startsWith('/emu/') || f.startsWith('/vendor/lam/') || f.endsWith('.wasm') || f.endsWith('.ktx2') || /\/brain\.worker-[^/]+\.js$/.test(f) || /\/spark\.module-[^/]+\.js$/.test(f)
    const all = [...new Set([...files, ...walk('public')])].filter((f) => !skip.has(f) && !f.endsWith('.map') && !onDemand(f))
    this.emitFile({
      type: 'asset',
      fileName: 'sw-manifest.json',
      source: JSON.stringify({ version: BUILD_VERSION, files: all }),
    })
  },
})

// 98ish Update's "what's new": the recent feature merges (releaseNotes.mjs), stamped with
// this build's version and time
const releaseNotesFile = () => ({
  name: 'release-notes',
  apply: 'build',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'release-notes.json',
      source: JSON.stringify({ version: BUILD_VERSION, builtAt: Number(BUILD_VERSION), notes: releaseNotes() }),
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
      releaseNotesFile(),
      {
        // Serve the Vercel function locally so `npm run dev` matches production
        name: 'dev-api',
        configureServer(server) {
          server.middlewares.use('/api/youtube', youtubeHandler)
          server.middlewares.use('/api/wayback', waybackHandler)
        },
      },
    ],
    define: { __BUILD_VERSION__: JSON.stringify(mode === 'production' ? BUILD_VERSION : 'dev') },
    css: {
      // 98.css ships `@media (not(hover))`, which Lightning CSS rejects
      lightningcss: { errorRecovery: true },
      // Accessibility Options: text size, title bar height and less motion everywhere
      postcss: { plugins: [a11yCss()] },
    },
  }
})
