// Roam: arriving somewhere fun, no Run button, life round the shops.
// node --test client/src/roam/life.test.js
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { tilesAround, townFrame } from "./geo.js"
import { DRIVABLE, decodeTile, tileSeaAt } from "./data/tile.js"
import { TOWNS, startSpot, startSpots } from "./towns/index.js"
import { createWalker, stepWalker, targetSpeed, SPEED } from "./sim/walker.js"
import { tableSpots, tableClear, EAT } from "./sim/tables.js"
import { VIEW_CLEAR, bestFacing, sightline } from "./sim/arrival.js"
import { createColliders } from "./sim/collide.js"
import { wallRings } from "./render/buildings.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))

// the decoded prebuilt tiles within r of a point
const tilesNear = (town, x, z, r = 300) => {
  const dir = path.join(HERE, "..", "..", "public", "roam", town.id)
  const ix = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"))
  const f = townFrame(town.origin)
  const out = []
  for (const t of tilesAround(f, x, z, r)) {
    const file = path.join(dir, "16", String(t.x), `${t.y}.json`)
    if (fs.existsSync(file)) out.push(decodeTile(JSON.parse(fs.readFileSync(file, "utf8")), f, ix.base))
  }
  return out
}
const inRing = (r, x, z) => {
  let ins = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i].z > z !== r[j].z > z && x < ((r[j].x - r[i].x) * (z - r[i].z)) / (r[j].z - r[i].z) + r[i].x) ins = !ins
  return ins
}
const segD = (pts, x, z) => {
  let best = Infinity
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const L2 = dx * dx + dz * dz || 1e-9
    const k = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2))
    best = Math.min(best, Math.hypot(x - a.x - dx * k, z - a.z - dz * k))
  }
  return best
}

for (const town of Object.values(TOWNS))
  test(`arriving (${town.name}): the liveliest real spot first, each start on open ground by the place it names`, () => {
    const list = startSpots(town)
    assert.ok(list.length >= 2, "a few to pick from")
    assert.notEqual(list[0].kind, "venue", "not the courts first: somewhere fun")
    assert.ok(list.some((s) => s.kind === "venue"), "the venue's courts are one of them")
    assert.equal(startSpot(town).id, list[0].id, "the first by default")
    assert.equal(startSpot(town, "nope").id, list[0].id)
    assert.equal(startSpot(town, list[1].id).id, list[1].id, "the one you picked")
    for (const s of list) {
      const sp = startSpot(town, s.id)
      assert.ok(Number.isFinite(sp.yaw))
      const tiles = tilesNear(town, sp.x, sp.z, 150)
      assert.ok(tiles.length, `${s.id} is in the prebuilt town`)
      for (const t of tiles) {
        for (const b of t.buildings) assert.ok(!inRing(b.ring, sp.x, sp.z), `${s.id} is outside every building`)
        for (const r of t.roads) if (DRIVABLE.has(r.cls)) assert.ok(segD(r.pts, sp.x, sp.z) > r.width / 2, `${s.id} is off ${r.name || "a road"}'s lanes`)
        assert.ok(!tileSeaAt(t, sp.x, sp.z), `${s.id} is on land`)
      }
      if (s.place) {
        const named = tiles.flatMap((t) => [...t.pois.filter((p) => p.name === s.place).map((p) => [p]), ...t.buildings.filter((b) => b.name === s.place).map((b) => b.ring)])
        assert.ok(named.length, `${s.id}: "${s.place}" is on the map`)
        const d = Math.min(...named.flat().map((p) => Math.hypot(p.x - sp.x, p.z - sp.z)))
        assert.ok(d < 140, `${s.id} is ${d.toFixed(0)} m from ${s.place}`)
      }
    }
  })

for (const town of Object.values(TOWNS))
  test(`arriving (${town.name}): every start faces an open view with life in it, never a wall within 25 m`, () => {
    for (const s of startSpots(town)) {
      if (s.kind === "venue") continue
      const sp = startSpot(town, s.id)
      const tiles = tilesNear(town, sp.x, sp.z, 220)
      const col = createColliders()
      for (const t of tiles) col.addTile(t.key, wallRings(t.buildings, () => 0))
      const segment = (ax, az, bx, bz) => col.segment(ax, az, bx, bz, -1e9)
      const f = bestFacing(sp.x, sp.z, { segment, tiles, prefer: sp.yaw })
      assert.ok(f.open, `${s.id}: an open heading exists`)
      // the whole middle of the view is clear for 25 m (no wall filling the screen)
      const v = sightline(sp.x, sp.z, f.yaw, segment)
      assert.ok(v.clear >= VIEW_CLEAR, `${s.id}: clear ${v.clear.toFixed(0)} m`)
      assert.ok(v.center >= 40, `${s.id}: a view down the street or across the plaza (${v.center.toFixed(0)} m)`)
      // something to see: shops, places, trees
      assert.ok(f.life >= 3, `${s.id}: life in view ${f.life.toFixed(1)}`)
    }
  })

test("arriving: the facing turns away from a wall in front to the open street beside it", () => {
  // a long wall 12 m north of the spot (z -12), a street running east with shops along it
  const col = createColliders()
  col.addTile("t", [{ ring: [{ x: -60, z: -12 }, { x: 60, z: -12 }, { x: 60, z: -40 }, { x: -60, z: -40 }] }])
  const segment = (ax, az, bx, bz) => col.segment(ax, az, bx, bz, -1e9)
  const shops = [40, 70, 100].map((x) => ({ kind: 5, area: 400, ring: [{ x, z: 10 }, { x: x + 15, z: 10 }, { x: x + 15, z: 25 }, { x, z: 25 }] }))
  const f = bestFacing(0, 0, { segment, tiles: [{ buildings: shops, pois: [], vegTrees: [], trees: [] }], prefer: Math.PI })
  assert.ok(f.open)
  assert.ok(Math.abs(Math.cos(f.yaw - Math.PI)) < 0.9, `not into the wall (yaw ${f.yaw.toFixed(2)})`)
  assert.ok(Math.sin(f.yaw) > 0.5, `toward the shops down the street (yaw ${f.yaw.toFixed(2)})`)
  const into = sightline(0, 0, Math.PI, segment)
  assert.ok(into.clear < 14, "facing the wall is blocked")
})

test("no Run button: pushing the stick all the way out runs; partway jogs and walks", () => {
  const hud = fs.readFileSync(path.join(HERE, "ui", "RoamHud.jsx"), "utf8")
  assert.ok(!/data-roam="sprint"/.test(hud) && !/>\s*Run\s*</.test(hud), "the HUD has no Run button")
  assert.equal(targetSpeed(0.1, false), 0, "the dead zone")
  assert.ok(targetSpeed(0.4, false) <= SPEED.walk + 1e-9, "a little push walks")
  const mid = targetSpeed(0.6, false)
  assert.ok(mid > SPEED.walk && mid <= SPEED.jog + 1e-9, `partway jogs (${mid})`)
  assert.ok(Math.abs(targetSpeed(1, false) - SPEED.sprint) < 1e-9, "all the way out runs")
  assert.equal(targetSpeed(0.5, true), SPEED.sprint, "Shift (desktop) sprints")
  // a walker held all the way out for a few seconds is running
  const w = createWalker()
  for (let i = 0; i < 120; i++) stepWalker(w, { x: 0, y: 1 }, 0, 1 / 60)
  assert.ok(w.speed > 6 && w.gait === "sprint", `${w.speed.toFixed(1)} m/s`)
  // and nothing moves you without the stick
  for (let i = 0; i < 120; i++) stepWalker(w, { x: 0, y: 0 }, 0, 1 / 60)
  assert.equal(w.speed, 0)
})

test("café tables: only by mapped places to eat, never in a building, on a road or a walk; the same everywhere", () => {
  const town = TOWNS.valencia
  const s = startSpot(town)
  const tiles = tilesNear(town, s.x, s.z, 300)
  let n = 0
  let people = 0
  for (const t of tiles) {
    const a = tableSpots(t)
    assert.deepEqual(a, tableSpots(t), "the same in every browser")
    for (const tb of a) {
      n++
      assert.ok(tableClear(t, tb.x, tb.z), "clear ground")
      const eat = t.pois.filter((p) => EAT.test(p.kind))
      assert.ok(eat.some((p) => Math.hypot(p.x - tb.x, p.z - tb.z) < 20), "by a mapped place to eat")
      assert.ok(tb.chairs.length >= 2 && tb.chairs.length <= 4)
      for (const c of tb.chairs) {
        assert.ok(Math.abs(Math.hypot(c.x - tb.x, c.z - tb.z) - 0.78) < 1e-6)
        // (each chair faces the table)
        assert.ok(Math.cos(c.yaw - Math.atan2(tb.x - c.x, tb.z - c.z)) > 0.999)
        if (c.person) people++
      }
    }
  }
  assert.ok(n >= 4 && people >= 4, `${n} tables, ${people} people sitting out at the Town Center`)
})
