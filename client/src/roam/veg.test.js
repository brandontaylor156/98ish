// Roam: the vegetation from the aerial (data/veg.js). node --test client/src/roam/veg.test.js
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { VEG, VEG_N, SHRUB_R, canopyTrees, classifyImage, classifyPixel, decodeVeg, encodeVeg, fromB64, ndviOf, toB64, vegAt, vegRaster } from "./data/veg.js"
import { treeSpots } from "./render/ground.js"
import { decodeTile } from "./data/tile.js"
import { townFrame } from "./geo.js"
import { TOWNS } from "./towns/index.js"
import { kitKindOf } from "./render/trees.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))

test("vegetation: sample pixels from the aerial (NIR, red, green; natural colour)", () => {
  // (values as read from NAIP colour-infrared at Valencia's Town Center)
  assert.equal(classifyPixel(190, 70, 80, 25, 70, 95, 60), VEG.canopy, "a street tree: very green, lumpy")
  assert.equal(classifyPixel(140, 60, 70, 6, 60, 90, 55), VEG.canopy, "a crown in shade: very green, dark in NIR")
  assert.equal(classifyPixel(215, 95, 110, 5, 95, 140, 70), VEG.green, "a watered lawn: green, smooth, bright")
  assert.equal(classifyPixel(150, 110, 110, 22, 120, 110, 85), VEG.dry, "chaparral on the hills: weakly green and lumpy")
  assert.equal(classifyPixel(175, 165, 150, 4, 190, 170, 140), VEG.dry, "dry grass: tan, not green")
  assert.equal(classifyPixel(140, 150, 150, 3, 150, 150, 152), VEG.none, "a car park: grey")
  assert.equal(classifyPixel(200, 210, 205, 2, 215, 212, 208), VEG.none, "a pale roof")
  assert.ok(ndviOf(200, 60) > 0.5 && ndviOf(100, 100) === 0)
})

// a synthetic image: lawn everywhere, two round crowns (6 m and 2.5 m across at 1 m a pixel),
// a grey road, a dry corner
const synth = () => {
  const w = 80
  const h = 80
  const cir = new Uint8Array(w * h * 3)
  const rgb = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      let px = [215, 95, 110] // lawn
      let col = [110, 150, 80]
      if (y >= 60 && y < 66) {
        px = [140, 150, 150]
        col = [150, 150, 152]
      } else if (x > 66 && y > 66) {
        px = [175, 165, 150]
        col = [190, 170, 140]
      }
      if (Math.hypot(x - 20, y - 20) < 6) {
        px = [(x + y) % 2 ? 120 : 175, 60, 70] // a crown: lumpy, dark from above
        col = [60, 85, 55]
      }
      if (Math.hypot(x - 50, y - 30) < 1.1) {
        px = [130, 55, 65]
        col = [62, 88, 56]
      }
      cir.set(px, i)
      rgb.set(col, i)
    }
  return { cir, rgb, w, h }
}

test("vegetation: classes, the ground raster and the crowns from an image", () => {
  const img = synth()
  const cls = classifyImage(img)
  assert.equal(cls[20 * 80 + 20], VEG.canopy)
  assert.equal(cls[5 * 80 + 60], VEG.green)
  assert.equal(cls[62 * 80 + 10], VEG.none)
  assert.equal(cls[75 * 80 + 75], VEG.dry)
  const ras = vegRaster(cls, 80, 80, 8)
  assert.equal(ras[0 * 8 + 6], VEG.green, "a lawn cell")
  assert.equal(ras[7 * 8 + 7], VEG.dry, "the dry corner")
  const trees = canopyTrees(cls, 80, 80, 1)
  const big = trees.find((t) => Math.hypot(t.x - 20, t.y - 20) < 2)
  assert.ok(big, "the big crown is found")
  assert.ok(big.r > 4.5 && big.r < 7.6, `its radius ${big.r.toFixed(1)} m (6 m drawn)`)
  assert.equal(trees.filter((t) => Math.hypot(t.x - 20, t.y - 20) < 4).length, 1, "one tree, not a cluster")
  const small = trees.find((t) => Math.hypot(t.x - 50, t.y - 30) < 2)
  assert.ok(small && small.r < SHRUB_R + 0.6, "the small one is a shrub-sized crown")
  assert.ok(!trees.some((t) => t.y >= 60 && t.y < 66), "nothing on the road")
  assert.ok(!trees.some((t) => t.x > 66 && t.y > 66), "nothing on the dry ground")
})

test("vegetation: packs small and comes back the same", () => {
  const raster = new Uint8Array(VEG_N * VEG_N).map((_, i) => i % 4)
  const trees = [
    { u: 0.1, v: 0.2, r: 3.25 },
    { u: 0.9, v: 0.5, r: 1.25 },
    { u: 0, v: 0.999, r: 8.25 },
  ]
  const g = encodeVeg({ raster, trees })
  assert.ok(g.c.length < 1400 && g.t.length === 12, "64 x 64 cells in under 1.4 KB, 4 characters a tree")
  // (a hillside of one class: a few runs)
  const flat = encodeVeg({ raster: new Uint8Array(VEG_N * VEG_N).fill(1), trees: [] })
  assert.ok(flat.r && flat.r.length < 120, "runs when shorter")
  assert.ok(decodeVeg(flat).raster.every((v) => v === 1))
  const back = decodeVeg(JSON.parse(JSON.stringify(g)))
  assert.deepEqual([...back.raster], [...raster])
  for (let i = 0; i < trees.length; i++) {
    assert.ok(Math.abs(back.trees[i].u - trees[i].u) < 1 / 1024 + 1e-9)
    assert.ok(Math.abs(back.trees[i].v - trees[i].v) < 1 / 1024 + 1e-9)
    assert.ok(Math.abs(back.trees[i].r - trees[i].r) < 0.26)
  }
  assert.equal(vegAt(back, 0.0, 0.0), raster[0])
  assert.deepEqual([...fromB64(toB64(new Uint8Array([1, 2, 3, 250, 0])))], [1, 2, 3, 250, 0])
  assert.equal(decodeVeg(null), null)
  assert.equal(decodeVeg({ n: 64, c: "!!!" }).trees.length, 0, "broken data is nothing, not a crash")
})

for (const town of Object.values(TOWNS))
  test(`vegetation (${town.name}): every prebuilt tile has the aerial's layer, trees where it's green, the town still small`, { skip: !fs.existsSync(path.join(HERE, "..", "..", "public", "roam", town.id, "index.json")) }, () => {
    const dir = path.join(HERE, "..", "..", "public", "roam", town.id)
    const ix = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"))
    assert.ok(ix.veg && /NAIP/.test(ix.veg.source), "the source is recorded")
    assert.ok(ix.bytes < 12.5 * 1024 * 1024, `${(ix.bytes / 1e6).toFixed(1)} MB`)
    const f = townFrame(town.origin)
    let tiles = 0
    let withVeg = 0
    let trees = 0
    let checked = 0
    for (const x of fs.readdirSync(path.join(dir, "16")))
      for (const file of fs.readdirSync(path.join(dir, "16", x))) {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, "16", x, file), "utf8"))
        tiles++
        if (!raw.g) continue
        withVeg++
        if (checked > 30 || tiles % 7) continue
        checked++
        const t = decodeTile(raw, f, ix.base)
        trees += t.vegTrees.length
        // the trees drawn: the aerial's crowns on top of the map's, none on a lane, kinds the
        // renderer knows
        const spots = treeSpots(t, { max: 2000 })
        assert.ok(spots.length >= t.trees.length)
        for (const s of spots) assert.ok([0, 1, 2, 3].includes(s.kind))
        for (const s of spots.filter((q) => q.kind === 3 || q.kind === 2)) assert.equal(kitKindOf(s), null)
      }
    assert.equal(withVeg, tiles, "every tile")
    assert.ok(trees > 50, `${trees} crowns in the tiles checked`)
  })
