// Compare a My Park venue with its references (the fidelity workflow, docs/pickleball-venues.md).
//
//   node tools/venues/compare.mjs <venue> [modes...] [--refs DIR] [--out DIR] [--base URL] [--hour H]
//
// modes (default: topdown photo color):
//   truth    color cards of known colors laid in the venue under its own light, read back off
//            the screen: Delta E (CIE76) per card, flat and upright, for the current tone curve
//   topdown  an orthographic picture with the same box, north up, as refs/<venue>/aerial.json;
//            writes side-by-side, 50% overlay and edge overlay PNGs, and (with layout.json) the
//            error of every court: centre distance (m) and angle (deg) to the traced court
//   photo    every pose in refs/<venue>/photos.json rendered at the photo's aspect, side by side
//   color    every labeled region in refs/<venue>/colors.json sampled in the top-down render
//            (flat things) against the reference color: Delta E per region
//
// Needs vite (dev build: the window.__park hooks) on --base (default http://localhost:5210)
// and Chrome; playwright-core from PLAYWRIGHT_CORE (a path to its index.mjs) or node_modules.
// Reference images stay outside the repo (they're only for comparing).
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PARK = path.join(HERE, "../../client/src/components/applets/pickleball/park")
const args = process.argv.slice(2)
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`)
  return i >= 0 ? args[i + 1] : d
}
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")))
const id = positional[0]
if (!id) {
  console.log("usage: node tools/venues/compare.mjs <venue> [truth|topdown|photo|color ...] [--refs DIR] [--out DIR] [--base URL]")
  process.exit(1)
}
const modes = positional.slice(1).length ? positional.slice(1) : ["topdown", "photo", "color"]
const REFS = path.resolve(opt("refs", process.env.VENUE_REFS || "venues/refs"), id)
const OUT = path.resolve(opt("out", process.env.VENUE_COMPARE || "venues/compare"), id)
const BASE = opt("base", "http://localhost:5210")
const HOUR = Number(opt("hour", 13))
fs.mkdirSync(OUT, { recursive: true })
const spec = JSON.parse(fs.readFileSync(path.join(PARK, "venues", `${id}.json`), "utf8"))
const readJson = (f) => (fs.existsSync(path.join(REFS, f)) ? JSON.parse(fs.readFileSync(path.join(REFS, f), "utf8")) : null)
const dataUrl = (file) => `data:image/${/\.png$/i.test(file) ? "png" : "jpeg"};base64,${fs.readFileSync(file).toString("base64")}`
const savePng = (name, url) => {
  fs.writeFileSync(path.join(OUT, name), Buffer.from(url.split(",")[1], "base64"))
  return path.join(OUT, name)
}

// the venue's own projection (build-venues.mjs makeProj, origin = spec.origin)
const M = 111320
const [lat0, lon0] = spec.origin
const K = Math.cos((lat0 * Math.PI) / 180)
const toXZ = (la, lo) => [(lo - lon0) * M * K, -(la - lat0) * M]

const pw = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : "playwright-core")
const browser = await pw.chromium.launch({ channel: "chrome", headless: true })
const report = { venue: id, at: new Date().toISOString(), modes: {} }
try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } })
  await ctx.addInitScript(() => {
    localStorage.setItem("98ish.bootScreen", "off")
    localStorage.setItem("98ish.helper", "off")
  })
  const page = await ctx.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto(`${BASE}/?open=program&name=${encodeURIComponent("Pickleball 98")}`)
  await page.waitForSelector('[data-menu="park"]', { timeout: 90000 })
  await page.click('[data-menu="park"]')
  await page.waitForSelector('[data-park="venues"]', { timeout: 60000 })
  await page.click(`[data-venue="${id}"]`)
  await page.waitForFunction((v) => window.__park && window.__park.venue === v && window.__park.devShot && !document.querySelector('[data-park="loading"]'), id, { timeout: 90000 })
  await page.waitForTimeout(800)
  const intro = await page.$('[data-park="intro"] button')
  if (intro) await intro.click()
  await page.evaluate((h) => window.__park.setHour(h), HOUR)
  if (opt("tone")) await page.evaluate((t) => (window.__park.toneMapping = t), Number(opt("tone")))
  await page.waitForTimeout(500)

  // ---------- in-page helpers: images, Lab, compositing ----------
  await page.evaluate(() => {
    const H = (window.__cmp = {})
    H.img = (src) => new Promise((ok, no) => Object.assign(new Image(), { onload() { ok(this) }, onerror: no, src }))
    H.canvas = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h })
    const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    H.lab = ([r, g, b]) => {
      const R = lin(r), G = lin(g), B = lin(b)
      const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
      const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047)
      const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B)
      const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883)
      return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
    }
    H.dE = (a, b) => {
      const A = H.lab(a), B = H.lab(b)
      return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2])
    }
    H.rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
    H.hex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")
    // the median color in a box of an image (robust to lines and figures)
    H.sample = (data, W, x, y, r) => {
      const ch = [[], [], []]
      for (let j = Math.max(0, Math.round(y - r)); j <= Math.round(y + r); j++)
        for (let i = Math.max(0, Math.round(x - r)); i <= Math.round(x + r); i++) {
          const k = (j * W + i) * 4
          if (data[k + 3] === undefined) continue
          for (let c = 0; c < 3; c++) ch[c].push(data[k + c])
        }
      return ch.map((a) => a.sort((p, q) => p - q)[a.length >> 1] ?? 0)
    }
    H.pixels = async (src, w, h) => {
      const im = await H.img(src)
      const c = H.canvas(w || im.width, h || im.height)
      const g = c.getContext("2d")
      g.drawImage(im, 0, 0, c.width, c.height)
      return { c, g, data: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height }
    }
    // Sobel edge strength (0..255) of a canvas
    H.edges = (P) => {
      const { data, w, h } = P
      const gray = new Float32Array(w * h)
      for (let i = 0; i < w * h; i++) gray[i] = 0.3 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2]
      const out = new Float32Array(w * h)
      for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
          const g = (dx, dy) => gray[(y + dy) * w + x + dx]
          const gx = -g(-1, -1) - 2 * g(-1, 0) - g(-1, 1) + g(1, -1) + 2 * g(1, 0) + g(1, 1)
          const gy = -g(-1, -1) - 2 * g(0, -1) - g(1, -1) + g(-1, 1) + 2 * g(0, 1) + g(1, 1)
          out[y * w + x] = Math.min(255, Math.hypot(gx, gy) / 4)
        }
      return out
    }
    H.compose = async (refSrc, renSrc, w, h, { overlay = true, edges = true } = {}) => {
      const A = await H.pixels(refSrc, w, h)
      const B = await H.pixels(renSrc, w, h)
      const side = H.canvas(w * 2 + 8, h)
      const sg = side.getContext("2d")
      sg.fillStyle = "#fff"
      sg.fillRect(0, 0, side.width, h)
      sg.drawImage(A.c, 0, 0)
      sg.drawImage(B.c, w + 8, 0)
      const out = { side: side.toDataURL("image/png") }
      if (overlay) {
        const o = H.canvas(w, h)
        const og = o.getContext("2d")
        og.drawImage(A.c, 0, 0)
        og.globalAlpha = 0.5
        og.drawImage(B.c, 0, 0)
        out.overlay = o.toDataURL("image/png")
      }
      if (edges) {
        const ea = H.edges(A)
        const eb = H.edges(B)
        const e = H.canvas(w, h)
        const eg = e.getContext("2d")
        const id = eg.createImageData(w, h)
        for (let i = 0; i < w * h; i++) {
          const a = ea[i] > 40 ? 255 : 0
          const b = eb[i] > 40 ? 255 : 0
          id.data[i * 4] = Math.max(a, 20)
          id.data[i * 4 + 1] = b ? 220 : 20
          id.data[i * 4 + 2] = b ? 255 : 20
          id.data[i * 4 + 3] = 255
        }
        eg.putImageData(id, 0, 0)
        out.edges = e.toDataURL("image/png")
      }
      return out
    }
  })

  // ---------- truth: known colors, back off the screen ----------
  if (modes.includes("truth")) {
    const L = await page.evaluate(() => {
      const b = window.__park.layout.BOUNDS
      const s = window.__park.layout.SPAWN
      return { b, s, indoor: !!window.__park.layout.spec.indoor }
    })
    const HEX = ["#2f6fb8", "#9fd0e6", "#3f7a4f", "#1f9ad6", "#f39a1e", "#2f5590", "#d8b98c", "#22337a", "#f1f0ec", "#b5583a", "#7a7a7a", "#c94a3a", "#5d6166", "#e8e2d4"]
    const rows = []
    for (const kind of ["std", "lambert"]) {
      // cards in a strip near the entrance (flat), and the same cards standing up facing south
      const cards = HEX.map((hex, i) => ({ x: L.s.x - 14 + (i % 7) * 4, z: L.s.z + 6 + Math.floor(i / 7) * 4, y: 30, hex, size: 2.6, kind }))
      const up = HEX.map((hex, i) => ({ x: L.s.x - 14 + (i % 7) * 4, z: L.s.z + 16 + Math.floor(i / 7) * 5, y: 9 + Math.floor(i / 7) * 3, hex, size: 2.6, kind, up: true }))
      await page.evaluate((list) => window.__park.devSwatches(list), [...cards, ...up])
      const flat = await page.evaluate(async ({ cards, s }) => {
        const box = { x0: s.x - 17, x1: s.x + 13, z0: s.z + 3, z1: s.z + 13 }
        const W = 600
        const Hh = 200
        const url = window.__park.devShot({ w: W, h: Hh, ortho: box })
        const P = await __cmp.pixels(url)
        return cards.map((c) => {
          const px = ((c.x - box.x0) / (box.x1 - box.x0)) * W
          const py = ((c.z - box.z0) / (box.z1 - box.z0)) * Hh
          const got = __cmp.sample(P.data, W, px, py, 6)
          return { hex: c.hex, got: __cmp.hex(got), dE: +__cmp.dE(__cmp.rgb(c.hex), got).toFixed(1) }
        })
      }, { cards, s: L.s })
      const standing = await page.evaluate(async ({ up, s }) => {
        // a front view looking north at the standing cards (their fronts face south)
        const box = { x0: s.x - 17, x1: s.x + 13, y0: 7, y1: 15, z: s.z + 30 }
        const W = 600
        const Hh = 160
        const url = window.__park.devShot({ w: W, h: Hh, ortho: box })
        const P = await __cmp.pixels(url)
        const rows = up.map((c) => {
          const got = __cmp.sample(P.data, W, ((c.x - box.x0) / (box.x1 - box.x0)) * W, ((box.y1 - c.y) / (box.y1 - box.y0)) * Hh, 5)
          return { hex: c.hex, got: __cmp.hex(got), dE: +__cmp.dE(__cmp.rgb(c.hex), got).toFixed(1) }
        })
        return { url, rows }
      }, { up, s: L.s })
      savePng(`truth-${kind}-upright.png`, standing.url)
      rows.push({ kind, flat, upright: standing.rows, meanFlat: +(flat.reduce((a, b) => a + b.dE, 0) / flat.length).toFixed(1), meanUp: +(standing.rows.reduce((a, b) => a + b.dE, 0) / standing.rows.length).toFixed(1) })
    }
    await page.evaluate(() => window.__park.devSwatches([]))
    report.modes.truth = { toneMapping: await page.evaluate(() => window.__park.toneMapping), exposure: await page.evaluate(() => window.__park.exposure), rows }
    for (const r of rows) {
      console.log(`truth ${r.kind}: mean dE flat ${r.meanFlat}, upright (facing south) ${r.meanUp}`)
      for (let i = 0; i < r.flat.length; i++) console.log(`  ${r.flat[i].hex} -> flat ${r.flat[i].got} dE ${r.flat[i].dE}   upright ${r.upright[i].got} dE ${r.upright[i].dE}`)
    }
  }

  // ---------- top-down against the aerial ----------
  const aerial = readJson("aerial.json")
  let box = null
  let TW = 0
  let TH = 0
  if (aerial) {
    const [nwLa, nwLo] = aerial.corners_latlon.nw
    const [seLa, seLo] = aerial.corners_latlon.se
    const [x0, z0] = toXZ(nwLa, nwLo)
    const [x1, z1] = toXZ(seLa, seLo)
    box = { x0, x1, z0, z1 }
    TW = Math.min(1600, aerial.size_px[0])
    TH = Math.round((TW * aerial.size_px[1]) / aerial.size_px[0])
  }
  let topUrl = null
  if (aerial && (modes.includes("topdown") || modes.includes("color"))) topUrl = await page.evaluate(({ box, TW, TH }) => window.__park.devShot({ w: TW, h: TH, ortho: box }), { box, TW, TH })
  // (indoors the colors are read from under the ceiling)
  const hallH = spec.halls?.length ? Math.min(...spec.halls.map((h) => h.h || 9)) : null
  const floorUrl = aerial && hallH && modes.includes("color") ? await page.evaluate(({ box, TW, TH, y }) => window.__park.devShot({ w: TW, h: TH, ortho: { ...box, y } }), { box, TW, TH, y: hallH - 1.7 }) : topUrl
  if (aerial && modes.includes("topdown")) {
    const ref = dataUrl(path.join(REFS, "aerial.jpg"))
    const out = await page.evaluate(({ ref, topUrl, TW, TH }) => __cmp.compose(ref, topUrl, TW, TH), { ref, topUrl, TW, TH })
    const files = { render: savePng("topdown-render.png", topUrl), side: savePng("topdown-side.png", out.side), overlay: savePng("topdown-overlay.png", out.overlay), edges: savePng("topdown-edges.png", out.edges) }
    const res = { box, files }
    // court errors against the traced layout
    const lay = readJson("layout.json")
    if (lay) res.courts = courtErrors(lay, aerial)
    report.modes.topdown = res
    if (res.courts) console.log(`topdown: ${res.courts.matched}/${res.courts.ref} courts matched, mean ${res.courts.meanM} m / ${res.courts.meanDeg} deg, worst ${res.courts.worstM} m, over 1 m: ${res.courts.over1m}, unmatched render: ${res.courts.extraRender}`)
    console.log(`topdown: ${files.side}`)
  }

  // ---------- colors: every court's surfaces, and any labeled regions ----------
  // Each court's service area, kitchen, surround (and a tennis court's alleys) sampled in the
  // top-down render against the court's paint (the spec's palette: the reference pack's albedo
  // via ingest-refs.mjs); colors.json "regions" ({ label, hex, en | ll | xz | px }) add more.
  const colors = readJson("colors.json")
  if (aerial && modes.includes("color")) {
    const pts = []
    const P = (x, z) => ({ px: ((x - box.x0) / (box.x1 - box.x0)) * TW, py: ((z - box.z0) / (box.z1 - box.z0)) * TH })
    spec.courts.forEach((c, i) => {
      const paint = { court: spec.colors?.court, kitchen: spec.colors?.kitchen, surround: spec.colors?.surround, ...(c.s === "t" ? { court: spec.colors?.tennis || spec.colors?.court, surround: spec.colors?.tennisSurround || spec.colors?.surround } : {}), ...(c.col !== undefined ? spec.palettes[c.col] : {}) }
      const a = (c.a * Math.PI) / 180
      const u = [Math.cos(a), Math.sin(a)]
      const w = [-Math.sin(a), Math.cos(a)]
      const at = (al, ac) => P(c.x + u[0] * al + w[0] * ac, c.z + u[1] * al + w[1] * ac)
      const add = (label, hex, q) => hex && hex[0] === "#" && pts.push({ label: `${c.s}${i} ${label}`, hex, ...q, r: 2 })
      if (c.s === "p") {
        add("service", paint.court, at(4.4, 1.5))
        add("kitchen", paint.kitchen || paint.court, at(1.1, 1.5))
        add("surround", paint.surround, at(0, 4.35))
      } else if (c.s === "t" && !c.pb) {
        add("court", paint.court, at(3.2, 2.0))
        if (paint.alley) add("alley", paint.alley, at(6, 4.8))
        add("surround", paint.surround, at(14.2, 0))
      }
    })
    for (const r of colors?.regions || []) {
      let x, z
      if (r.xz) [x, z] = r.xz
      else if (r.ll) [x, z] = toXZ(r.ll[0], r.ll[1])
      else if (r.en) {
        const [ax, az] = toXZ(aerial.anchor.lat, aerial.anchor.lon)
        ;[x, z] = [ax + r.en[0], az - r.en[1]]
      } else continue
      pts.push({ ...r, ...P(x, z) })
    }
    const rows = await page.evaluate(async ({ pts, topUrl, TW }) => {
      const R = await __cmp.pixels(topUrl)
      return pts.map((p) => {
        const got = __cmp.sample(R.data, TW, p.px, p.py, p.r || 3)
        return { label: p.label, ref: p.hex, got: __cmp.hex(got), dE: +__cmp.dE(__cmp.rgb(p.hex), got).toFixed(1) }
      })
    }, { pts, topUrl: floorUrl, TW })
    if (floorUrl !== topUrl) savePng("topdown-floor.png", floorUrl)
    const by = {}
    for (const r of rows) {
      const k = r.label.split(" ").slice(1).join(" ")
      ;(by[k] = by[k] || []).push(r.dE)
    }
    report.modes.color = { rows, mean: +(rows.reduce((a2, b2) => a2 + b2.dE, 0) / Math.max(1, rows.length)).toFixed(1), over12: rows.filter((r) => r.dE > 12).length, bySurface: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, +(v.reduce((a2, b2) => a2 + b2, 0) / v.length).toFixed(1)])) }
    console.log(`color: ${rows.length} samples, mean dE ${report.modes.color.mean}, over 12: ${report.modes.color.over12}; by surface ${JSON.stringify(report.modes.color.bySurface)}`)
    for (const r of rows.filter((q) => q.dE > 12).slice(0, 12)) console.log(`  ${r.label.padEnd(18)} ref ${r.ref} got ${r.got} dE ${r.dE}`)
  }

  // ---------- photos from their poses ----------
  const photos = readJson("photos.json")
  if (photos && modes.includes("photo")) {
    const list = photos.photos || photos
    const res = []
    for (const p of list) {
      const file = /^photos[\/]/.test(p.file) ? path.join(REFS, p.file) : path.join(REFS, "photos", p.file)
      if (!fs.existsSync(file)) continue
      const im = await page.evaluate((src) => __cmp.img(src).then((i) => ({ w: i.width, h: i.height })), dataUrl(file))
      const W = 640
      const Hh = Math.round((W * im.h) / im.w)
      let x, z
      // (the reference pack's form: pose { x, y (metres east, north of the aerial's anchor), h,
      // yaw (compass), pitch, hfov })
      if (p.pose && aerial) {
        const [ax, az] = toXZ(aerial.anchor.lat, aerial.anchor.lon)
        p.en = [p.pose.x, p.pose.y]
        p.height = p.pose.h
        p.heading = p.pose.yaw
        p.pitch = p.pose.pitch
        if (p.pose.hfov) p.vfov = (2 * Math.atan(Math.tan((p.pose.hfov * Math.PI) / 360) * (Hh / W)) * 180) / Math.PI
        p.fov = p.vfov
      }
      if (p.xz) [x, z] = p.xz
      else if (p.ll) [x, z] = toXZ(p.ll[0], p.ll[1])
      else if (p.en && aerial) {
        const [ax, az] = toXZ(aerial.anchor.lat, aerial.anchor.lon)
        ;[x, z] = [ax + p.en[0], az - p.en[1]]
      } else continue
      const cam = { x, z, y: p.height ?? p.y ?? 1.7, heading: p.heading ?? p.yaw ?? 0, pitch: p.pitch ?? 0, fov: p.vfov ?? p.fov ?? 55 }
      const url = await page.evaluate(({ W, Hh, cam }) => window.__park.devShot({ w: W, h: Hh, cam }), { W, Hh, cam })
      const out = await page.evaluate(({ ref, url, W, Hh }) => __cmp.compose(ref, url, W, Hh, { overlay: false, edges: false }), { ref: dataUrl(file), url, W, Hh })
      const name = `photo-${path.basename(p.file).replace(/\.\w+$/, "")}.png`
      res.push({ file: p.file, cam, side: savePng(name, out.side) })
      console.log(`photo: ${path.join(OUT, name)}`)
    }
    report.modes.photo = res
  }
  report.errors = errors
  if (errors.length) console.log("page errors:", errors.slice(0, 5))
} finally {
  await browser.close()
}
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1))
console.log(`report: ${path.join(OUT, "report.json")}`)

// every traced court against the nearest built court of the same kind
function courtErrors(lay, aerial) {
  const [ax, az] = toXZ(aerial.anchor.lat, aerial.anchor.lon)
  const refCourts = (lay.courts || lay).map((c) => {
    let x, z
    if (c.xz) [x, z] = c.xz
    else if (c.ll) [x, z] = toXZ(c.ll[0], c.ll[1])
    else if (c.en) [x, z] = [ax + c.en[0], az - c.en[1]]
    else if (c.center) [x, z] = [ax + c.center[0], az - c.center[1]]
    else if (c.x !== undefined && c.y !== undefined) [x, z] = [ax + c.x, az - c.y]
    const bearing = c.bearing ?? c.angle_deg ?? (c.deg !== undefined ? c.deg + 90 : null)
    const sp = c.sport || c.type || c.s || "p"
    return { id: c.id, sport: /^t/.test(sp) ? "t" : /^b/.test(sp) ? "b" : "p", x, z, bearing }
  })
  // built courts: the long axis as a compass bearing (spec a: 0 = east, 90 = south)
  const built = spec.courts.map((c, i) => ({ i, s: c.s, x: c.x, z: c.z, bearing: (c.a + 90 + 360) % 180 }))
  const used = new Set()
  const rows = []
  for (const r of refCourts) {
    let best = null
    for (const b of built) {
      if (b.s !== r.sport || used.has(b.i)) continue
      const d = Math.hypot(b.x - r.x, b.z - r.z)
      if (!best || d < best.d) best = { b, d }
    }
    if (!best || best.d > 12) {
      rows.push({ id: r.id, sport: r.sport, missing: true })
      continue
    }
    used.add(best.b.i)
    let da = null
    if (r.bearing !== null && r.bearing !== undefined) {
      da = Math.abs((((r.bearing - best.b.bearing) % 180) + 270) % 180 - 90)
    }
    rows.push({ id: r.id, sport: r.sport, m: +best.d.toFixed(2), deg: da === null ? null : +da.toFixed(1) })
  }
  const ok = rows.filter((r) => !r.missing)
  return {
    ref: refCourts.length,
    matched: ok.length,
    missing: rows.filter((r) => r.missing).map((r) => r.id),
    extraRender: built.length - used.size,
    meanM: +(ok.reduce((a, b) => a + b.m, 0) / Math.max(1, ok.length)).toFixed(2),
    worstM: +Math.max(0, ...ok.map((r) => r.m)).toFixed(2),
    meanDeg: +(ok.filter((r) => r.deg !== null).reduce((a, b) => a + b.deg, 0) / Math.max(1, ok.filter((r) => r.deg !== null).length)).toFixed(1),
    over1m: ok.filter((r) => r.m > 1).length,
    over2deg: ok.filter((r) => r.deg > 2).length,
    rows,
  }
}
