// Pickleball 98, players v2 (docs/players-v2.md): the modeled kits. The builder's pure math
// (tools/players/kit.mjs: delete_verts, pieces, cuts, hems, image helpers), which pieces each
// look wears (kitmap.js), and the shipped assets themselves (public/assets/pickleball/
// players.json and the mh-*.glb bodies: the same skeleton in every level of detail, every kit
// piece and the teeth in each, the body's hide bits, size and triangle budgets).
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { boundaryLoops, boxBlur, cleanPrint, clipFaces, components, drawSegments, heightToNormal, parseDeleteVerts, tankField } from "./tools/players/kit.mjs"
import { kitPiecesFor, PIECE_PART, REPLACES } from "./kitmap.js"
import { CHARACTERS } from "./looks.js"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ASSETS = path.join(HERE, "../../../../public/assets/pickleball")
const PIECES = ["tee", "tank", "shorts", "briefs", "shoes", "socks", "anklesocks"]

test("kit files: delete_verts ranges and singles, until the next keyword", () => {
  const s = parseDeleteVerts("name x\nverts 0\n1 2 3 0.3 0.3 0.4 0 0 0\ndelete_verts\n5 - 8 10\n12 - 13 \nmaterial x\n99\n")
  assert.deepEqual([...s].sort((a, b) => a - b), [5, 6, 7, 8, 10, 12, 13])
  assert.equal(parseDeleteVerts("verts 0\n1 2 3\n").size, 0)
})

// a strip of quads up the y axis: 2 columns of vertices, rows at y = 0, 1, 2, 3
const strip = () => {
  const pos = []
  const vt = []
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 2; c++) {
      pos.push(c, r, 0)
      vt.push(c, r / 3)
    }
  const faces = []
  for (let r = 0; r < 3; r++) {
    const a = r * 2
    faces.push({ v: [a, a + 1, a + 3, a + 2], t: [a, a + 1, a + 3, a + 2] })
  }
  const weights = pos.map((_, i) => (i % 3 === 0 ? [[pos[i + 1] < 1.5 ? "thigh_l" : "pelvis", 1]] : null)).filter(Boolean)
  return { pos, vt, faces, weights }
}

test("kit pieces: connected pieces by size; a cut by a field makes vertices on the cut with blended UVs and weights", () => {
  const m = strip()
  const comp = components(8, m.faces)
  assert.equal(comp.count, 1)
  assert.equal(comp.faces[0], 3)
  // keep y >= 1.5: the middle quad is cut in half, the bottom one dropped
  const field = []
  for (let i = 0; i < 8; i++) field.push(m.pos[i * 3 + 1] - 1.5)
  const out = clipFaces(m, field)
  assert.equal(out.faces.length, 2)
  assert.equal(out.cut.size, 2)
  for (const v of out.cut) {
    assert.ok(Math.abs(out.pos[v * 3 + 1] - 1.5) < 1e-12)
    // (the cut's UV halfway between the rows' v = 1/3 and 2/3)
    const f = out.faces.find((f) => f.v.includes(v))
    const t = f.t[f.v.indexOf(v)]
    assert.ok(Math.abs(out.vt[t * 2 + 1] - 0.5) < 1e-12)
    // (weights: half thigh, half pelvis, normalized)
    const w = Object.fromEntries(out.weights[v])
    assert.ok(Math.abs(w.thigh_l - 0.5) < 1e-9 && Math.abs(w.pelvis - 0.5) < 1e-9)
  }
  // the cut shares its new vertices between the faces either side (no cracks)
  const loops = boundaryLoops(out.faces)
  assert.equal(loops.length, 1)
  assert.equal(loops[0].length, 6)
})

test("kit cuts: a tank keeps the torso and straps, loses the sleeves and the front above the scoop", () => {
  const m = { cx: 0, cz: 0, shoulderX: 0.19, shoulderY: 1.42 }
  assert.ok(tankField([0, 1.2, 0.1], m) > 0) // the chest
  assert.ok(tankField([0.26, 1.4, 0], m) < 0) // a sleeve
  assert.ok(tankField([0.095, 1.45, 0], m) > 0) // a strap over the shoulder
  assert.ok(tankField([0, 1.4, 0.1], m) < 0) // the front above the scoop
  assert.ok(tankField([0, 1.4, -0.1], m) < 0) // the back between the straps (a racer back)
})

test("kit textures: prints removed from the cloth's shading, folds kept; bindings drawn; normals from heights", () => {
  const w = 64
  const lum = new Float32Array(w * w)
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) lum[y * w + x] = 0.8 + 0.05 * Math.sin(x / 9)
  // a dark logo in the middle
  for (let y = 28; y < 36; y++) for (let x = 24; x < 40; x++) lum[y * w + x] = 0.2
  const c = cleanPrint(lum, w, w, { r: 6, tol: 0.08 })
  assert.ok(c.lum[32 * w + 32] > 0.7, "the logo is gone")
  assert.ok(Math.abs(c.lum[5 * w + 5] - lum[5 * w + 5]) < 1e-6, "the cloth elsewhere is untouched")
  const blurred = boxBlur(lum, w, w, 2)
  assert.ok(blurred[32 * w + 32] > 0.2 && blurred[32 * w + 32] < 0.8)
  const mask = drawSegments(new Float32Array(w * w), w, w, [[10, 10, 50, 10, 2]])
  assert.equal(mask[10 * w + 30], 1)
  assert.equal(mask[20 * w + 30], 0)
  const n = heightToNormal(new Float32Array(w * w).fill(0.5), w, w, 4)
  assert.deepEqual([n[0], n[1], n[2]], [128, 128, 255])
})

test("outfit mapping: which modeled pieces each roster look wears, the rest still grown", () => {
  for (const c of CHARACTERS) {
    const { pieces, replaced } = kitPiecesFor(c.look, PIECES)
    const top = { tee: "tee", polo: "tee", tank: "tank" }[c.look.shirtStyle || "tee"]
    assert.ok(pieces.includes(top), `${c.id} wears the ${top}`)
    assert.ok(pieces.includes(c.look.bottom === "skirt" ? "briefs" : "shorts"), `${c.id}'s bottoms`)
    assert.ok(pieces.includes("shoes"), `${c.id}'s shoes`)
    for (const p of pieces) for (const k of REPLACES[p]) assert.ok(replaced.has(k))
    for (const p of pieces) assert.ok(PIECE_PART[p] >= 0 && PIECE_PART[p] <= 4)
  }
  // kinds the kits don't model stay grown; sock heights; one-pieces have no bottoms
  assert.deepEqual(kitPiecesFor({ shirtStyle: "rash", bottom: "pants", sockStyle: "knee" }, PIECES).pieces, ["shoes"])
  assert.deepEqual(kitPiecesFor({ shirtStyle: "tee", bottom: "shorts", sockStyle: "none" }, PIECES).pieces, ["tee", "shorts", "shoes"])
  assert.deepEqual(kitPiecesFor({ shirtStyle: "onepiece", sockStyle: "ankle" }, PIECES).pieces, ["anklesocks", "shoes"])
  // a body file without kits: nothing modeled
  assert.deepEqual(kitPiecesFor({ shirtStyle: "tee" }, []).pieces, [])
})

// ---- the shipped assets ----
// a GLB's JSON chunk (no dependencies)
const glbJson = (file) => {
  const b = fs.readFileSync(file)
  assert.equal(b.readUInt32LE(0), 0x46546c67, "glTF magic")
  const len = b.readUInt32LE(12)
  return JSON.parse(b.subarray(20, 20 + len).toString("utf8"))
}
const skinJoints = (j) => j.skins[0].joints.map((i) => j.nodes[i].name)
const meshTris = (j, name) => {
  const m = j.meshes.find((x) => x.name === name)
  if (!m) return 0
  return j.accessors[m.primitives[0].indices].count / 3
}

test("assets: players.json lists every body, skin family and file, within the download budgets", () => {
  const mf = JSON.parse(fs.readFileSync(path.join(ASSETS, "players.json"), "utf8"))
  assert.equal(mf.version, 2)
  for (const kind of ["m", "f"]) {
    const B = mf.bodies[kind]
    for (const fam of ["light", "mid", "dark"]) assert.match(B.skins[fam].ref, /^#[0-9a-f]{6}$/)
    // Medium: 1024 JPEGs (the light one is in the body file); High: 2048 KTX2 (Basis ETC1S)
    for (const fam of ["mid", "dark"]) {
      const f = B.skins[fam].med
      assert.ok(fs.existsSync(path.join(ASSETS, f)), f)
      assert.ok(fs.statSync(path.join(ASSETS, f)).size < 120e3, f)
    }
    for (const fam of ["light", "mid", "dark"]) {
      const f = B.skins[fam].hi
      assert.match(f, /\.ktx2$/)
      const b = fs.readFileSync(path.join(ASSETS, f))
      assert.equal(b.subarray(1, 7).toString("ascii"), "KTX 20", f)
      assert.equal(b.readUInt32LE(20), 2048, `${f} width`)
      assert.ok(b.length < 600e3, f)
    }
    // the dark family really is darker than the light one
    const lum = (hex) => [1, 3, 5].reduce((s, i, k) => s + parseInt(hex.slice(i, i + 2), 16) * [0.2126, 0.7152, 0.0722][k], 0)
    assert.ok(lum(B.skins.dark.ref) < lum(B.skins.light.ref) * 0.6)
  }
  // the bodies: Medium about 0.85 MB each, High under 1.7 MB
  for (const [file, cap] of [["mh-m.glb", 0.9e6], ["mh-f.glb", 0.9e6], ["mh-m-hi.glb", 1.7e6], ["mh-f-hi.glb", 1.7e6]]) assert.ok(fs.statSync(path.join(ASSETS, file)).size < cap, `${file} under ${cap}`)
})

test("assets: every level of detail has the same skeleton, every kit piece, the teeth and the hide bits", () => {
  const MUST = ["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "Head", "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l", "thigh_l", "calf_l", "foot_l", "ball_l", "index_04_leaf_l", "ball_leaf_r"]
  for (const kind of ["m", "f"]) {
    const med = glbJson(path.join(ASSETS, `mh-${kind}.glb`))
    const hi = glbJson(path.join(ASSETS, `mh-${kind}-hi.glb`))
    assert.deepEqual(skinJoints(med), skinJoints(hi), "the same bones, in the same order")
    for (const b of MUST) assert.ok(skinJoints(med).includes(b), b)
    for (const j of [med, hi]) {
      for (const p of PIECES) assert.ok(meshTris(j, "Kit_" + p) > 100, `Kit_${p}`)
      assert.ok(meshTris(j, "Teeth") > 200)
      const body = j.meshes.find((m) => m.name === "Body")
      assert.ok(body.primitives[0].attributes._KIT !== undefined, "the body's hide bits")
      // every kit piece is skinned on the body's own skin
      const bodyNode = j.nodes.find((n) => n.mesh === j.meshes.indexOf(body))
      for (const n of j.nodes) if (n.name?.startsWith("Kit_")) assert.equal(n.skin, bodyNode.skin)
      // the kit material: a normal map and the detail atlas
      const kitMat = j.materials.find((m) => m.name === "Kit")
      assert.ok(kitMat.normalTexture && kitMat.occlusionTexture)
    }
    // triangle budgets: a player in a tee, shorts, socks and shoes (the body as drawn is less:
    // the skin under the clothes is dropped)
    const worn = (j) => meshTris(j, "Body") + ["tee", "shorts", "socks", "shoes"].reduce((s, p) => s + meshTris(j, "Kit_" + p), 0) + meshTris(j, "Teeth")
    assert.ok(worn(med) < 24000, `Medium ${worn(med)} triangles`)
    assert.ok(worn(hi) < 40000, `High ${worn(hi)} triangles`)
    // Medium is lighter than High
    assert.ok(meshTris(med, "Body") < meshTris(hi, "Body") * 0.6)
  }
})

test("assets: texture budgets (GPU memory): the kit atlas and skins at their sizes", () => {
  // an embedded image's width and height (WebP: VP8 / VP8L / VP8X; JPEG: SOF)
  const dims = (buf) => {
    if (buf.toString("ascii", 1, 4) === "PNG") return [buf.readUInt32BE(16), buf.readUInt32BE(20)]
    if (buf.toString("ascii", 0, 4) === "RIFF") {
      const kind = buf.toString("ascii", 12, 16)
      if (kind === "VP8X") return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)]
      if (kind === "VP8L") {
        const b = buf.readUInt32LE(21)
        return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]
      }
      return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff]
    }
    for (let i = 2; i < buf.length; ) {
      const marker = buf[i + 1]
      const len = buf.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xc2) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)]
      i += 2 + len
    }
    return null
  }
  for (const kind of ["m", "f"])
    for (const [file, hi] of [[`mh-${kind}.glb`, false], [`mh-${kind}-hi.glb`, true]]) {
      const b = fs.readFileSync(path.join(ASSETS, file))
      const j = glbJson(path.join(ASSETS, file))
      const binStart = 20 + b.readUInt32LE(12) + 8
      let bytes = 0
      for (const img of j.images) {
        const bv = j.bufferViews[img.bufferView]
        const d = dims(b.subarray(binStart + (bv.byteOffset || 0), binStart + (bv.byteOffset || 0) + bv.byteLength))
        assert.ok(d, `${file} ${img.name || img.mimeType}`)
        assert.ok(d[0] <= 3072 && d[1] <= 2048, `${file}: ${d}`)
        bytes += d[0] * d[1] * 4 * 1.33 // (RGBA with mipmaps, as decoded)
      }
      // decoded: Medium under 22 MB a body, High under 48 MB (High's 2048 skins are KTX2,
      // about 2.8 MB each on the GPU, beside the file)
      assert.ok(bytes < (hi ? 48e6 : 22e6), `${file} ${Math.round(bytes / 1e6)} MB decoded`)
    }
})
