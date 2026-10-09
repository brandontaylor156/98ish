// My Park's draw budget (docs/pickleball-log.md "My Park at 30 on a phone"): each venue built as
// the browser builds it (Node: no canvas pictures), counted as draws: every mesh, instanced mesh
// and point cloud the renderer would submit, see-through double-sided ones once.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as THREE from "three"
import { venueLayoutSpec } from "./venuegen.js"
import { makeLayout, setLayout } from "./layout.js"
import { buildPark } from "./build.js"
import { lookKey, mergeByLook, programSort, singlePass } from "./perf.js"

// (a stand-in canvas: the venue's pictures are drawn on canvases; here they draw nothing)
const ctx2d = () =>
  new Proxy(
    {},
    {
      get: (t, k) => {
        if (k in t) return t[k]
        if (k === "createRadialGradient" || k === "createLinearGradient" || k === "createPattern") return () => ({ addColorStop() {} })
        if (k === "measureText") return () => ({ width: 10 })
        if (k === "getImageData" || k === "createImageData") return (x, y, w = 1, h = 1) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h) * 4) })
        return () => {}
      },
      set: (t, k, v) => ((t[k] = v), true),
    }
  )
if (typeof document === "undefined")
  globalThis.document = {
    createElement: () => ({ width: 1, height: 1, style: {}, getContext: () => ctx2d(), toDataURL: () => "", addEventListener() {}, removeEventListener() {} }),
    // (image loads never finish here)
    createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {} }),
  }

const IDS = ["loscab", "newport", "wolfbear", "whittier", "paseo", "sinaloa", "smash", "bouquet"]
const spec = (id) => JSON.parse(readFileSync(new URL(`./venues/${id}.json`, import.meta.url), "utf8"))

// what a venue costs to draw if all of it were in view: draws (two for a two-pass material) and triangles
const census = (group) => {
  let draws = 0
  let tris = 0
  let materials = new Set()
  group.traverse((o) => {
    if (!(o.isMesh || o.isPoints || o.isLine)) return
    const m = o.material
    const pass = m && !Array.isArray(m) && m.transparent && m.side === THREE.DoubleSide && !m.forceSinglePass ? 2 : 1
    draws += pass
    materials.add(m)
    const g = o.geometry
    const n = g.index ? g.index.count / 3 : (g.attributes.position?.count || 0) / 3
    tris += n * (o.isInstancedMesh ? o.count : 1)
  })
  return { draws, tris: Math.round(tris), materials: materials.size }
}

const build = (id, quality = "medium") => {
  const layout = makeLayout(venueLayoutSpec(spec(id)))
  setLayout(layout)
  const scene = new THREE.Scene()
  const park = buildPark(scene, { quality, layout, phone: true })
  return { park, scene, ...census(park.group) }
}

// draws for the whole venue at once (Node build, Medium), measured 2026-10-09 after the merge by
// look and single-pass see-through things, with ~8% room: before them Los Cab was 403, Newport
// 288, Wolf + Bear 155, Whittier 175, Paseo 362, Sinaloa 131, SMASH 193, Bouquet 101. A venue
// past its budget is a new cost on phones (docs/pickleball-log.md "My Park at 30 on a phone").
const BUDGET = { loscab: 330, newport: 215, wolfbear: 117, whittier: 115, paseo: 283, sinaloa: 85, smash: 160, bouquet: 96 }
const TRIS = 450_000

test("every venue builds within its phone draw budget", () => {
  const rows = {}
  for (const id of IDS) {
    const b = build(id)
    rows[id] = { draws: b.draws, tris: b.tris, materials: b.materials }
    b.park.dispose?.()
  }
  console.log(JSON.stringify(rows))
  for (const [id, r] of Object.entries(rows)) {
    assert.ok(r.draws <= BUDGET[id], `${id}: ${r.draws} draws (budget ${BUDGET[id]})`)
    assert.ok(r.tris <= TRIS, `${id}: ${r.tris} triangles`)
  }
})

test("merge by look: same look apart from color is one mesh with the colors as vertex colors", () => {
  const g = new THREE.Group()
  const box = new THREE.BoxGeometry(1, 1, 1)
  const red = new THREE.MeshLambertMaterial({ color: 0xff0000 })
  const blue = new THREE.MeshLambertMaterial({ color: 0x0000ff })
  const shiny = new THREE.MeshLambertMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5 })
  const live = new THREE.MeshLambertMaterial({ color: 0xffff00 })
  live.userData.live = true
  const live2 = new THREE.MeshLambertMaterial({ color: 0xffff00 })
  live2.userData.live = true
  for (const [m, x] of [[red, 0], [blue, 2], [shiny, 4], [live, 6], [live2, 8]]) {
    const o = new THREE.Mesh(box, m)
    o.position.x = x
    g.add(o)
  }
  assert.equal(lookKey(red), lookKey(blue))
  assert.notEqual(lookKey(red), lookKey(shiny))
  assert.equal(lookKey(live), null)
  const saved = mergeByLook(g)
  assert.equal(saved, 1)
  const merged = g.children.find((o) => o.material.userData.mergedLook)
  assert.ok(merged && merged.material.vertexColors)
  assert.equal(merged.material.color.getHex(), 0xffffff)
  // (the red box's vertices red, the blue box's blue, in world space)
  const c = merged.geometry.attributes.color
  const p = merged.geometry.attributes.position
  for (let i = 0; i < p.count; i++) {
    const isRed = p.getX(i) < 1
    assert.equal(c.getX(i), isRed ? 1 : 0)
    assert.equal(c.getZ(i), isRed ? 0 : 1)
  }
  // (the see-through one and the live ones left alone)
  assert.equal(g.children.length, 4)
})

test("see-through double-sided materials drawn in one pass; the opaque list sorted by program", () => {
  const g = new THREE.Group()
  const net = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false })
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(), net))
  assert.equal(singlePass(g), 1)
  assert.equal(net.forceSinglePass, true)
  // programs: a (id 2), b (id 1); materials in id order would switch a, b, a
  const mats = [new THREE.MeshLambertMaterial(), new THREE.MeshLambertMaterial(), new THREE.MeshLambertMaterial()]
  const prog = new Map([[mats[0], 2], [mats[1], 1], [mats[2], 2]])
  const sort = programSort({ properties: { get: (m) => ({ currentProgram: { id: prog.get(m) } }) } })
  const items = mats.map((m, i) => ({ id: i, groupOrder: 0, renderOrder: 0, material: m, materialVariant: 0, z: i }))
  const order = items.slice().sort(sort).map((it) => prog.get(it.material))
  assert.deepEqual(order, [1, 2, 2])
  // (render order still first)
  items[1].renderOrder = 5
  assert.equal(items.slice().sort(sort).at(-1).material, mats[1])
})
