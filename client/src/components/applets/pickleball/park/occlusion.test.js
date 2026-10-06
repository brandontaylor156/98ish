// node --test client/src/components/applets/pickleball/park/occlusion.test.js
import test from "node:test"
import assert from "node:assert/strict"
import * as THREE from "three"
import { aoUniforms, bakeVenueAO, clearBakedAO, makeGrid, rasterize } from "./occlusion.js"

const box = (w, h, d, x, y, z, mat = new THREE.MeshLambertMaterial()) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y, z)
  return m
}
const at = (grid, x, z) => {
  const i = Math.floor((x - grid.x0) / grid.cell)
  const j = Math.floor((z - grid.z0) / grid.cell)
  return grid.A[j * grid.nx + i]
}

test("a wall shades the ground at its foot, open ground stays at 1, under a car is dark", () => {
  const root = new THREE.Group()
  root.add(new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial())) // the ground: ignored
  root.add(box(20, 4, 0.3, 0, 2, -5)) // a wall along x, at z = -5
  root.add(box(4.5, 1.4, 1.8, 10, 0.7, 10)) // a car
  root.add(box(20, 0.3, 20, 0, 9, 0)) // a roof high overhead: not a ground occluder
  let grid
  bakeVenueAO(root, { x0: -25, x1: 25, z0: -25, z1: 25 }, { sync: true, onDone: (g) => (grid = g) })
  assert.ok(grid, "baked")
  const foot = at(grid, 0, -4.6)
  const near = at(grid, 0, -3)
  const open = at(grid, -15, 15)
  const under = at(grid, 10, 10)
  const beside = at(grid, 10, 11.4)
  assert.ok(open > 0.98, `open ground ${open}`)
  assert.ok(foot < 0.7, `the wall's foot ${foot}`)
  assert.ok(near > foot && near < open, `farther from the wall is lighter (${near})`)
  assert.ok(under <= 0.5, `under the car ${under}`)
  assert.ok(beside < open && beside > under, `beside the car ${beside}`)
  // published to the shaders
  assert.equal(aoUniforms.surfAOOn.value, 1)
  assert.ok(aoUniforms.surfAOTex.value.image.width === grid.nx)
  clearBakedAO()
  assert.equal(aoUniforms.surfAOOn.value, 0)
})

test("see-through things and the court's paint don't occlude; leaf cards add canopy shade", () => {
  const root = new THREE.Group()
  root.add(box(20, 3, 0.05, 0, 1.5, 0, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4 }))) // chain-link
  root.add(box(13, 0.02, 6, 0, 0.01, 10)) // court paint
  const leaves = new THREE.MeshLambertMaterial({ alphaTest: 0.5, map: new THREE.Texture() })
  root.add(new THREE.Mesh(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2).translate(0, 5, -12), leaves))
  const grid = makeGrid({ x0: -20, x1: 20, z0: -20, z1: 20 })
  rasterize(root, grid)
  let maxH = 0
  for (const h of grid.H) maxH = Math.max(maxH, h)
  assert.equal(maxH, 0, "nothing solid drawn")
  const k = Math.floor((-12 - grid.z0) / grid.cell) * grid.nx + Math.floor((0 - grid.x0) / grid.cell)
  assert.ok(grid.C[k] > 0, "canopy under the crown")
})
