// node --test client/src/components/applets/pickleball/park/surfaces.test.js
import test from "node:test"
import assert from "node:assert/strict"
import * as THREE from "three"
import { SURFACES, applySurfaces, setSurfacesOn, surfaced } from "./surfaces.js"

const compile = (material) => {
  const lib = material.isMeshStandardMaterial ? THREE.ShaderLib.standard : THREE.ShaderLib.lambert
  const shader = { uniforms: THREE.UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader }
  material.onBeforeCompile(shader, null)
  return shader
}

test("tagged materials get their surface; untagged and Low are left alone", () => {
  const g = new THREE.Group()
  const court = surfaced(new THREE.MeshStandardMaterial({ color: 0x1f5fbf }), "acrylic")
  const wall = surfaced(new THREE.MeshLambertMaterial({ color: 0xe8dcc6 }), "stucco")
  const plain = new THREE.MeshLambertMaterial({ color: 0x777777 })
  for (const m of [court, wall, plain, wall]) g.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m))
  assert.equal(applySurfaces(g, { quality: "low" }), 0)
  assert.equal(court.onBeforeCompile.toString().includes("surf"), false)
  assert.equal(applySurfaces(g, { quality: "high" }), 2) // each material once
  assert.equal(applySurfaces(g, { quality: "high" }), 0) // and never twice
  assert.match(court.customProgramCacheKey(), /surf:acrylic/)
  assert.match(wall.customProgramCacheKey(), /surf:stucco/)
  assert.equal(plain.userData.surfaced, undefined)
})

test("the shader patch: world position in, detail on the paint, bent normal, switch", () => {
  const g = new THREE.Group()
  const lam = surfaced(new THREE.MeshLambertMaterial({ color: 0xffffff }), "asphalt")
  const std = surfaced(new THREE.MeshStandardMaterial({ color: 0xffffff }), "acrylic")
  const ground = surfaced(new THREE.MeshLambertMaterial({ color: 0xffffff }), "ground")
  for (const m of [lam, std, ground]) g.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m))
  applySurfaces(g, { quality: "medium" })
  for (const m of [lam, std]) {
    const s = compile(m)
    assert.match(s.vertexShader, /vSurfW = \(modelMatrix \* surfP\)\.xyz/)
    assert.match(s.fragmentShader, /diffuseColor\.rgb \*= mix\(1\.0, surfD\.r \* 2\.0, surfK\)/)
    assert.match(s.fragmentShader, /surfBend\(surfD, vSurfN\)/)
    assert.ok(s.uniforms.surfTex && s.uniforms.surfOn, "its texture and the switch are uniforms")
  }
  const sg = compile(ground)
  assert.ok(sg.uniforms.surfA && sg.uniforms.surfB && sg.uniforms.surfC, "the ground blends grass, asphalt and concrete")
  assert.match(sg.fragmentShader, /surfGreen/)
  // the switch is one shared uniform
  setSurfacesOn(false)
  assert.equal(compile(lam).uniforms.surfOn.value, 0)
  setSurfacesOn(true)
  assert.equal(compile(lam).uniforms.surfOn.value, 1)
})

test("every surface kind has a texture file and sane numbers", async () => {
  const fs = await import("node:fs")
  const path = await import("node:path")
  const url = await import("node:url")
  const dir = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../../../../../public/assets/venue-tex")
  for (const [kind, k] of Object.entries(SURFACES)) {
    assert.ok(fs.existsSync(path.join(dir, `${kind}.webp`)), `${kind}.webp exists`)
    assert.ok(k.scale > 0 && k.strength >= 0 && k.strength <= 1, kind)
  }
  assert.ok(fs.existsSync(path.join(dir, "CREDITS.txt")))
})
