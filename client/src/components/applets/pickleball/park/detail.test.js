// node --test client/src/components/applets/pickleball/park/detail.test.js
import { test } from "node:test"
import assert from "node:assert/strict"
import * as THREE from "three"
import { buildCars, buildDecals, buildTrees, planDecals, skyEnvironment, windowMaps, chainLink, windscreenTex } from "./detail.js"

const seeded = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647)

test("trees: every kind builds instanced trunks and swaying leaf crowns with cut-out alpha", () => {
  const g = new THREE.Group()
  const at = (n, kind) => Array.from({ length: n }, (_, i) => ({ x: i * 6, z: i * 3, s: 1, kind }))
  buildTrees(g, { broadleaf: at(5), eucalyptus: at(2), palm: at(4), conifer: at(3) }, { rand: seeded(7) })
  const meshes = g.children.filter((o) => o.isInstancedMesh)
  assert.ok(meshes.length >= 9, `meshes: ${meshes.length}`)
  const leaves = meshes.filter((m) => m.material.alphaTest > 0)
  assert.ok(leaves.length >= 5)
  for (const m of leaves) {
    assert.ok(m.geometry.attributes.wind, "leaf crowns carry wind weights")
    assert.equal(m.material.side, THREE.DoubleSide)
  }
  // every placed tree is drawn (trunks and crowns together cover all 14)
  const trunkCount = meshes.filter((m) => !m.material.alphaTest).reduce((s, m) => s + m.count, 0)
  assert.equal(trunkCount, 14)
  // budget: a broad-leaf crown stays a few hundred triangles
  const crown = leaves[0].geometry
  assert.ok(crown.attributes.position.count / 3 < 800)
})

test("cars: three shapes, a body, glass and wheels each; only bodies throw shadows; few triangles", () => {
  const g = new THREE.Group()
  const cars = Array.from({ length: 30 }, (_, i) => ({ x: i * 3, z: 0, yaw: 0, c: (i % 10) / 10 }))
  buildCars(g, cars, [0xffffff, 0x222222], { rand: seeded(3) })
  const m = g.children.filter((o) => o.isInstancedMesh)
  assert.equal(m.length % 3, 0)
  assert.equal(m.filter((o) => o.material.isMeshStandardMaterial && o.material.metalness > 0.4).reduce((s, o) => s + o.count, 0), 30)
  assert.ok(m.filter((o) => o.userData.noCast).length >= 2)
  for (const o of m) {
    const tris = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3
    assert.ok(tris < 260, `per-car triangles ${tris}`)
  }
})

test("decals: wear by the kitchen lines and baselines, ball marks, oil in stalls, leaves under trees", () => {
  const plan = planDecals({
    courts: [{ x: 0, z: 0, rot: 0, s: "p" }, { x: 30, z: 0, rot: Math.PI / 2, s: "t", W: 10.97, L: 23.77 }, { x: 60, z: 0, rot: 0, s: "b" }],
    stalls: Array.from({ length: 100 }, (_, i) => ({ x: i, z: 50 })),
    lots: [[[0, 40], [100, 40], [100, 60], [0, 60]]],
    trees: [{ x: 5, z: 5, s: 1 }],
    rand: seeded(11),
  })
  // pickleball: 4 kitchen scuffs a side (none behind its baselines: 2026-10-09, clean courts); tennis: 3 baseline scuffs a side; none on basketball
  assert.equal(plan.scuff.length, 8 + 6)
  assert.equal(plan.ball.length, 16)
  assert.ok(plan.oil.length > 15 && plan.oil.length < 60)
  assert.equal(plan.leaves.length, 2)
  // kitchen wear sits just outside the kitchen line (2.13 m) on the pickleball court
  const near = plan.scuff.filter((d) => Math.abs(d.x) < 4).map((d) => Math.abs(d.z))
  assert.ok(near.some((z) => z > 2.1 && z < 3.5))
  const g = new THREE.Group()
  plan.under = [{ x: 0, z: 0, w: 2, l: 4 }]
  assert.ok(buildDecals(g, plan) > 0)
  for (const o of g.children) {
    assert.equal(o.material.depthWrite, false)
    assert.ok(o.material.polygonOffset)
  }
})

test("pictures fall back quietly without a canvas (Node): sky, windows, chain-link, windscreens", () => {
  const sky = skyEnvironment({ indoor: false })
  assert.equal(sky.mapping, THREE.EquirectangularReflectionMapping)
  assert.equal(windowMaps("windows"), null)
  const wire = chainLink(0x223344)
  assert.ok(wire.depth.isMeshDepthMaterial && wire.depth.alphaTest > 0)
  assert.ok(windscreenTex())
})
