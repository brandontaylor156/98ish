// Adds the real vegetation to a town's prebuilt tiles (docs/open-world.md "Vegetation"): for
// each tile, the USGS NAIP aerial imagery (public domain; The National Map's USGSNAIPImagery
// ImageServer, 0.6 m, four bands) is sampled at ~1.2 m a pixel twice (colour-infrared: NIR, red,
// green; and natural colour), classified (data/veg.js: green lawn and landscaping, dry ground,
// tree crowns), and written into the tile as `g` (a 64 x 64 ground raster and the trees with
// their crown sizes). Crowns standing in a building or on a road's lanes are dropped.
// Sequential and polite (our User-Agent, a pause between tiles, back-off on errors); the images
// are cached in tools/roam/cache/naip/<town>/ (not committed), so a rerun is offline.
//
//   node tools/roam/add-vegetation.mjs valencia [--refetch] [--limit N]

import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { townById } from "../../client/src/roam/towns/index.js"
import { DRIVABLE, F, decodeTile } from "../../client/src/roam/data/tile.js"
import { MAX_TREES, VEG_N, canopyTrees, classifyImage, encodeVeg, vegRaster } from "../../client/src/roam/data/veg.js"
import { TILE_ZOOM, tileBounds, townFrame } from "../../client/src/roam/geo.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, "..", "..")
const sharp = createRequire(path.join(ROOT, "client", "package.json"))("sharp")
const UA = "98ish-roam-build/1.0 (98ish open world; https://98ish.vercel.app)"
const NAIP = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage"
const PX = 416 // pixels a tile side (~1.2 m at z16 in Southern California)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const id = process.argv[2] || "valencia"
const refetch = process.argv.includes("--refetch")
const li = process.argv.indexOf("--limit")
const limit = li > 0 ? Number(process.argv[li + 1]) : Infinity
const town = townById(id)
if (!town) throw new Error(`no town ${id}`)
const OUT = path.join(ROOT, "client", "public", town.prebuilt.replace(/^\//, ""))
const CACHE = path.join(HERE, "cache", "naip", id)
fs.mkdirSync(CACHE, { recursive: true })

const fetchImage = async (b, bands, file) => {
  if (!refetch && fs.existsSync(file) && fs.statSync(file).size > 1000) return fs.readFileSync(file)
  const url = `${NAIP}?bbox=${b.west},${b.south},${b.east},${b.north}&bboxSR=4326&imageSR=4326&size=${PX},${PX}&bandIds=${bands}&format=jpg&compressionQuality=90&interpolation=RSP_BilinearInterpolation&f=image`
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } })
      const type = res.headers.get("content-type") || ""
      if (!res.ok || !type.includes("image")) throw new Error(`HTTP ${res.status} ${type}`)
      const buf = Buffer.from(await res.arrayBuffer())
      fs.writeFileSync(file, buf)
      return buf
    } catch (e) {
      console.log(`  ${path.basename(file)}: ${e.message}, retrying in ${10 * (attempt + 1)} s`)
      await sleep(10000 * (attempt + 1))
    }
  }
  throw new Error(`NAIP failed for ${file}`)
}
const raw = async (buf) => {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height }
}

const index = JSON.parse(fs.readFileSync(path.join(OUT, "index.json"), "utf8"))
const frame = townFrame(town.origin)
const dir = path.join(OUT, String(TILE_ZOOM))
const list = []
for (const x of fs.readdirSync(dir)) for (const f of fs.readdirSync(path.join(dir, x))) list.push({ x: Number(x), y: Number(f.replace(/\.json$/, "")), file: path.join(dir, x, f) })
list.sort((a, b) => a.y - b.y || a.x - b.x)
let bytes = 0
let added = 0
let trees = 0
const counts = [0, 0, 0, 0]
const t0 = Date.now()
let n = 0
for (const t of list) {
  const tile = JSON.parse(fs.readFileSync(t.file, "utf8"))
  if (n < limit) {
    n++
    const b = tileBounds(TILE_ZOOM, t.x, t.y)
    const cached = fs.existsSync(path.join(CACHE, `${t.x}_${t.y}_cir.jpg`))
    const cir = await raw(await fetchImage(b, "3,0,1", path.join(CACHE, `${t.x}_${t.y}_cir.jpg`)))
    const rgb = await raw(await fetchImage(b, "0,1,2", path.join(CACHE, `${t.x}_${t.y}_rgb.jpg`)))
    if (!cached) await sleep(250)
    const cls = classifyImage({ cir: cir.data, rgb: rgb.data, w: cir.w, h: cir.h })
    const raster = vegRaster(cls, cir.w, cir.h, VEG_N)
    const d = decodeTile(tile, frame, index.base)
    const mpp = (d.rect.x1 - d.rect.x0) / cir.w
    // (no crown standing in a building or on a road's lanes)
    const blocked = (px, pz) => {
      for (const bd of d.buildings) {
        const r = bd.ring
        let ins = false
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i].z > pz !== r[j].z > pz && px < ((r[j].x - r[i].x) * (pz - r[i].z)) / (r[j].z - r[i].z) + r[i].x) ins = !ins
        if (ins) return true
      }
      for (const r of d.roads) {
        if (!DRIVABLE.has(r.cls) || r.flags & (F.tunnel | F.bridge)) continue
        for (let i = 0; i + 1 < r.pts.length; i++) {
          const a = r.pts[i]
          const c = r.pts[i + 1]
          const dx = c.x - a.x
          const dz = c.z - a.z
          const L2 = dx * dx + dz * dz || 1e-9
          const k = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / L2))
          if (Math.hypot(px - a.x - dx * k, pz - a.z - dz * k) < r.width / 2 - 0.5) return true
        }
      }
      return false
    }
    const crowns = canopyTrees(cls, cir.w, cir.h, mpp, { max: MAX_TREES * 2 })
      .map((c) => ({ u: c.x / cir.w, v: c.y / cir.h, r: c.r }))
      .filter((c) => !blocked(d.rect.x0 + c.u * (d.rect.x1 - d.rect.x0), d.rect.z0 + c.v * (d.rect.z1 - d.rect.z0)))
      // (the hills: the oaks and the biggest scrub, fewer of them; streets get the full count)
      .slice(0, d.buildings.length < 25 ? Math.round(MAX_TREES * 0.55) : MAX_TREES)
    tile.g = encodeVeg({ raster, trees: crowns })
    for (const v of raster) counts[v]++
    trees += crowns.length
    added++
    fs.writeFileSync(t.file, JSON.stringify(tile))
    if (added % 25 === 0) console.log(`  ${added}/${Math.min(list.length, limit)} tiles, ${trees} trees, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  }
  bytes += fs.statSync(t.file).size
}
index.bytes = bytes
index.counts = { ...index.counts, vegTrees: trees }
index.veg = { source: "USGS NAIP imagery (public domain), The National Map USGSNAIPImagery", built: new Date().toISOString().slice(0, 10), px: PX, cells: VEG_N }
index.source = "© OpenStreetMap contributors (ODbL); AWS Terrain Tiles (USGS 3DEP); vegetation from USGS NAIP imagery (public domain)"
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index))
const all = counts.reduce((a, b) => a + b, 0) || 1
console.log(`${town.name}: ${added} tiles, ${trees} trees; ground ${counts.map((c) => ((100 * c) / all).toFixed(0) + "%").join(" / ")} (none/dry/green/canopy); ${(bytes / 1024 / 1024).toFixed(2)} MB`)
