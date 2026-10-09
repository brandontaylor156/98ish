// Roam: the vegetation from the aerial (data/veg.js). node --test client/src/roam/veg.test.js
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { VEG, VEG_N, SHRUB_R, canopyTrees, classifyImage, classifyPixel, decodeVeg, encodeVeg, fromB64, ndviOf, onLanes, toB64, vegAt, vegRaster } from "./data/veg.js"
import { treeSpots } from "./render/ground.js"
import { AREA, ROAD, areaClassOf, decodeTile, ringArea } from "./data/tile.js"
import { settleCrown } from "./data/settle.js"
import { KEEP_TAGS } from "./data/osm.js"
import { areaColor } from "./render/paint.js"
import { SPECIES, hedgeArrays, speciesArrays, speciesSize } from "./render/treekit.js"
import { townFrame } from "./geo.js"
import { TOWNS } from "./towns/index.js"
import { autumnOf, crownTint, kitKindOf, speciesOf } from "./render/trees.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))

test("vegetation: sample pixels from the aerial (NIR, red, green; natural colour)", () => {
  // (values as read from NAIP colour-infrared at Valencia's Town Center)
  assert.equal(classifyPixel(190, 70, 80, 25, 70, 95, 60), VEG.canopy, "a street tree: very green, lumpy")
  assert.equal(classifyPixel(140, 60, 70, 6, 60, 90, 55), VEG.canopy, "a crown in shade: very green, dark in NIR")
  assert.equal(classifyPixel(215, 95, 110, 5, 95, 140, 70), VEG.green, "a watered lawn: green, smooth, bright")
  // (the young street trees along Town Center Drive: weakly green in NIR, dark and green from above)
  assert.equal(classifyPixel(148, 97, 102, 10, 85, 97, 75), VEG.canopy, "a young street tree")
  assert.equal(classifyPixel(117, 81, 93, 8, 81, 87, 73), VEG.canopy, "a grey-green street tree")
  assert.equal(classifyPixel(121, 127, 115, 6, 138, 124, 113), VEG.dry, "bare planting bed: not a tree")
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

// ---- the look round (2026-10-09): trees that follow the aerial, dry rivers, the tree kit ----

const prebuilt = (town) => {
  const dir = path.join(HERE, "..", "..", "public", "roam", town.id)
  if (!fs.existsSync(path.join(dir, "index.json"))) return null
  const ix = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"))
  const f = townFrame(town.origin)
  const files = []
  for (const x of fs.readdirSync(path.join(dir, "16"))) for (const file of fs.readdirSync(path.join(dir, "16", x))) files.push(path.join(dir, "16", x, file))
  return { ix, f, files, decode: (file) => decodeTile(JSON.parse(fs.readFileSync(file, "utf8")), f, ix.base) }
}

test("trees follow the aerial's canopy: more canopy, more trees; none where it shows no plants; the street trees kept", { skip: !prebuilt(TOWNS.valencia) }, () => {
  const p = prebuilt(TOWNS.valencia)
  const rows = []
  let onPlants = 0
  let all = 0
  let kept = 0
  let stored = 0
  p.files.forEach((file, i) => {
    if (i % 4) return
    const t = p.decode(file)
    if (!t.veg) return
    const canopy = t.veg.raster.reduce((n, c) => n + (c === VEG.canopy), 0) / t.veg.raster.length
    const spots = treeSpots(t, { max: 2000 })
    const veg = spots.filter((s) => s.r && !t.trees.some((m) => Math.abs(m.x - s.x) < 0.01 && Math.abs(m.z - s.z) < 0.01))
    const trees = veg.filter((s) => s.kind !== 2)
    rows.push({ canopy, trees: trees.length })
    stored += t.vegTrees.length
    kept += veg.length
    // (every tree the aerial gave stands where it shows plants: its cell or a neighbour green or canopy)
    const { x0, x1, z0, z1 } = t.rect
    for (const s of veg) {
      all++
      const u = (s.x - x0) / (x1 - x0)
      const v = (s.z - z0) / (z1 - z0)
      const d = 1 / t.veg.n
      let ok = false
      for (const du of [-d, 0, d]) for (const dv of [-d, 0, d]) if (vegAt(t.veg, u + du, v + dv) >= VEG.green) ok = true
      if (ok) onPlants++
    }
  })
  rows.sort((a, b) => a.canopy - b.canopy)
  const q = Math.floor(rows.length / 4)
  const mean = (list) => list.reduce((s, r) => s + r.trees, 0) / Math.max(1, list.length)
  const low = mean(rows.slice(0, q))
  const high = mean(rows.slice(-q))
  assert.ok(high > 3 * low + 20, `the leafiest quarter of tiles has far more trees (${high.toFixed(0)} vs ${low.toFixed(0)})`)
  assert.ok(onPlants / all > 0.93, `${((100 * onPlants) / all).toFixed(1)}% stand on the aerial's plants (a lone lot tree's 8 m cell can read as paving)`)
  assert.ok(kept / stored > 0.9, `the drawn trees keep the aerial's crowns (${kept} of ${stored})`)
})

test("onLanes: no tree on a road's lanes; a divided road's median and a wide street's verge keep theirs", () => {
  const narrow = { width: 10 }
  const wide = { width: 16 }
  const divided = { width: 22 }
  assert.ok(onLanes(narrow, 0.5) && onLanes(narrow, 4.6) && !onLanes(narrow, 5.2), "a residential street: all lanes")
  assert.ok(onLanes(wide, 2) && onLanes(wide, 5) && !onLanes(wide, 7), "a wide street: lanes, then its outer verge keeps its trees")
  assert.ok(!onLanes(wide, 0.8), "the aerial's crown on a wide street's middle is a planted median")
  assert.ok(!onLanes(divided, 0.8) && onLanes(divided, 3) && !onLanes(divided, 10), "a divided road's median and verge")
  assert.ok(onLanes(divided, 0.8, true), "a one-way's middle is lanes")
})

test("dry rivers: intermittent or seasonal water is a wash (sand, gravel, scrub), real lakes and pools stay water", () => {
  assert.equal(areaClassOf({ natural: "water", water: "river", intermittent: "yes" }), AREA.wash, "the Santa Clara River")
  assert.equal(areaClassOf({ natural: "water", water: "basin", intermittent: "yes" }), AREA.wash, "a debris basin")
  assert.equal(areaClassOf({ waterway: "riverbank", seasonal: "yes" }), AREA.wash)
  assert.equal(areaClassOf({ natural: "water", water: "lake" }), AREA.water, "a lake is blue")
  assert.equal(areaClassOf({ natural: "water", intermittent: "no", water: "pond" }), AREA.water)
  assert.equal(areaClassOf({ leisure: "swimming_pool", natural: "water" }), AREA.pool)
  assert.ok(KEEP_TAGS.has("intermittent") && KEEP_TAGS.has("seasonal"), "the tags are kept in new builds")
  // the wash's colour is sand, not water
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [r, , b] = hex(areaColor(AREA.wash))
  assert.ok(r > b + 25 && r > 150, "sand-coloured")
  const [wr, , wb] = hex(areaColor(AREA.water))
  assert.ok(wb > wr, "water stays blue")
})

test("dry rivers (Valencia): the Santa Clara River is a wash in the prebuilt tiles, not a blue lake", { skip: !prebuilt(TOWNS.valencia) }, () => {
  const p = prebuilt(TOWNS.valencia)
  assert.ok(p.ix.washes && p.ix.washes.areas > 50, "marked")
  let wash = 0
  let water = 0
  let washArea = 0
  for (const file of p.files) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"))
    for (const a of raw.a || []) {
      if (a[0] === AREA.wash) wash++
      if (a[0] === AREA.water) water++
    }
    if (!(raw.a || []).some((a) => a[0] === AREA.wash)) continue
    const t = p.decode(file)
    for (const a of t.areas) if (a.cls === AREA.wash) washArea += Math.abs(ringArea(a.ring.map((q) => [q.x, q.z])))
  }
  assert.ok(wash > water, `${wash} wash pieces, ${water} water`)
  assert.ok(washArea > 1e6, `${(washArea / 1e6).toFixed(1)} km² of dry riverbed`)
})

test("tree kit: every species is a trunk and leaf cards facing out of the crown, real sizes, one geometry", () => {
  for (const sp of ["plane", "oak", "round", "pine", "shrub"]) {
    const a = speciesArrays(sp, 1)
    assert.equal(a.position.length / 3, a.leafy.length)
    assert.ok(a.position.every(Number.isFinite) && a.normal.every(Number.isFinite))
    assert.ok(a.index.length / 3 < (sp === "pine" ? 1100 : 700), `${sp}: ${a.index.length / 3} triangles`)
    let top = 0
    for (let i = 1; i < a.position.length; i += 3) top = Math.max(top, a.position[i])
    assert.ok(top > SPECIES[sp].h * 0.8 && top < SPECIES[sp].h * 1.35, `${sp} is about ${SPECIES[sp].h} m (${top.toFixed(1)})`)
    // the cards' normals point out of the crown (they light like a volume) or up
    const c = sp === "pine" ? null : SPECIES[sp].env
    if (c) {
      let out = 0
      for (const k of a.cards) if (k.p[0] * k.n[0] + (k.p[1] - c.y) * k.n[1] + k.p[2] * k.n[2] > 0 || k.n[1] > 0.3) out++
      assert.ok(out / a.cards.length > 0.9, `${sp}: ${out}/${a.cards.length} cards face out`)
    }
    if (sp !== "shrub") assert.ok(a.limbs.length >= 2, `${sp} has a trunk and limbs`)
  }
  // sizes from the aerial's crowns: a bigger crown is a bigger tree; real proportions
  for (const sp of ["plane", "oak", "round", "pine"]) {
    assert.ok(speciesSize(sp, 5).h > speciesSize(sp, 3).h)
    const s = speciesSize(sp, 4)
    assert.ok(s.h >= 7 && s.h <= 24, `${sp} with a 4 m crown radius is ${s.h.toFixed(1)} m`)
  }
  assert.ok(speciesSize("plane", 4).h > speciesSize("oak", 4).h, "a sycamore stands taller than an oak as wide")
  assert.ok(speciesSize("pine", 3).h > 14, "pines are tall")
  // the hedge box faces out
  const h = hedgeArrays()
  for (let t = 0; t < h.index.length; t += 3) {
    const [i, j, k] = [h.index[t], h.index[t + 1], h.index[t + 2]].map((q) => [h.position[q * 3], h.position[q * 3 + 1], h.position[q * 3 + 2]])
    const u = [j[0] - i[0], j[1] - i[1], j[2] - i[2]]
    const v = [k[0] - i[0], k[1] - i[1], k[2] - i[2]]
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const m = [(i[0] + j[0] + k[0]) / 3, (i[1] + j[1] + k[1]) / 3 - 0.5, (i[2] + j[2] + k[2]) / 3]
    assert.ok(n[0] * m[0] + n[1] * m[1] + n[2] * m[2] > 0, "every hedge face is wound to face out")
  }
})

test("tree species by place: lots and streets mostly sycamores and planes, offices with pines, the hills oaks", { skip: !prebuilt(TOWNS.valencia) }, () => {
  const p = prebuilt(TOWNS.valencia)
  const count = {}
  let hedges = 0
  p.files.forEach((file, i) => {
    if (i % 6) return
    for (const s of treeSpots(p.decode(file), { max: 2000 })) {
      if (s.kind === 2) hedges += s.hedge ? 1 : 0
      else {
        const sp = s.kind === 1 ? "palm" : speciesOf(s)
        count[sp] = (count[sp] || 0) + 1
      }
    }
  })
  for (const sp of ["plane", "oak", "round", "pine"]) assert.ok(count[sp] > 100, `${sp}: ${count[sp]}`)
  assert.ok(count.palm > 30, `palms along the arterials: ${count.palm}`)
  assert.ok(hedges > 50, `${hedges} hedges in lots and by offices`)
  // autumn: in October and November the planes turn, the evergreens don't
  const t = { x: 10.3, z: 20.7, kind: 0, sp: "plane" }
  const green = crownTint(t, 0, "plane")
  const fall = crownTint(t, autumnOf(10), "plane")
  assert.ok(fall[0] - fall[1] > green[0] - green[1], "a plane turns yellow-orange")
  assert.deepEqual(crownTint({ ...t, sp: "oak" }, autumnOf(10), "oak"), crownTint({ ...t, sp: "oak" }, 0, "oak"), "an oak stays green")
})

test("settling a crown: a little inside a road's lanes or a wall's line it stands at the curb or outside; deep in, it's dropped", () => {
  const road = { cls: ROAD.residential, width: 10, flags: 0, pts: [{ x: -100, z: 0 }, { x: 100, z: 0 }] }
  const house = { ring: [{ x: 20, z: 20 }, { x: 40, z: 20 }, { x: 40, z: 40 }, { x: 20, z: 40 }] }
  const at = settleCrown(0, 3.5, [house], [road])
  assert.ok(at && at.z >= 5.5 && Math.abs(at.x) < 0.01, "to the curb on its own side")
  assert.equal(settleCrown(0, 0.5, [house], [road]), null, "in the middle of the street: not a tree we can draw")
  const out = settleCrown(30, 21, [house], [road])
  assert.ok(out && out.z < 20 && out.z > 19, "just outside the wall")
  assert.equal(settleCrown(30, 30, [house], [road]), null, "deep in a building")
  assert.deepEqual(settleCrown(0, 12, [house], [road]), { x: 0, z: 12 }, "a crown in the clear stays where it is")
})
