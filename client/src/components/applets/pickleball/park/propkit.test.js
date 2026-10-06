// node --test client/src/components/applets/pickleball/park/propkit.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { PROPS, ROOM_LOOK, furnishRoom, propSolid, roomRect } from "./propkit.js"

const inPoly = (x, z, p) => {
  let inside = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i]
    const [xj, zj] = p[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}
// a box's corners (propSolid: { cx, cz, hx, hz, ux, uz })
const corners = (b) => [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
].map(([i, j]) => [b.cx + b.ux * i * b.hx - b.uz * j * b.hz, b.cz + b.uz * i * b.hx + b.ux * j * b.hz])
const inBox = (b, x, z, pad = 0) => {
  const dx = x - b.cx
  const dz = z - b.cz
  return Math.abs(dx * b.ux + dz * b.uz) < b.hx + pad && Math.abs(-dx * b.uz + dz * b.ux) < b.hz + pad
}
// a 14 x 9 room turned 25 degrees, a door on its south side
const turn = (a, [x, z]) => [x * Math.cos(a) - z * Math.sin(a) + 40, x * Math.sin(a) + z * Math.cos(a) - 12]
const A = (25 * Math.PI) / 180
const P = [[-7, -4.5], [7, -4.5], [7, 4.5], [-7, 4.5]].map((q) => turn(A, q))
const door = turn(A, [0, 4.5])
const room = (type) => ({ id: `t-${type}`, type, p: P, doors: [{ x: door[0], z: door[1], w: 1.8 }] })

test("propkit: every room type furnishes deterministically, inside its walls", () => {
  for (const type of Object.keys(ROOM_LOOK)) {
    const a = furnishRoom(room(type))
    const b = furnishRoom(room(type))
    assert.deepEqual(a, b, `${type}: deterministic`)
    if (type !== "corridor" && type !== "hall") assert.ok(a.length >= 1, `${type}: furnished (${a.length})`)
    for (const pr of a) {
      assert.ok(PROPS[pr.t], `${type}: known prop ${pr.t}`)
      assert.ok(inPoly(pr.x, pr.z, P), `${type}: ${pr.t} inside the room`)
      const s = propSolid(pr)
      if (s && !s.r) for (const [x, z] of corners(s)) assert.ok(inPoly(x, z, P) || Math.hypot(x - pr.x, z - pr.z) < 0.6, `${type}: ${pr.t} footprint inside`)
    }
  }
})

test("propkit: solid furniture doesn't overlap, and the way in from the door stays clear", () => {
  for (const type of ["lobby", "cafe", "bar", "gym", "locker", "restroom", "lounge", "proshop", "studio", "spa", "kids"]) {
    const list = furnishRoom(room(type))
    const solids = list.map(propSolid).filter((s) => s && !s.r)
    for (let i = 0; i < solids.length; i++)
      for (let j = i + 1; j < solids.length; j++) {
        const a = solids[i]
        const b = solids[j]
        // (centres can't sit inside each other's boxes)
        assert.ok(!inBox(a, b.cx, b.cz, -0.05) && !inBox(b, a.cx, a.cz, -0.05), `${type}: ${list.indexOf(list.find((p) => propSolid(p) === a))} overlaps`)
      }
    // walk from the doorway toward the middle of the room: nothing solid in the first 2.5 m
    const c = P.reduce((s, q) => [s[0] + q[0] / 4, s[1] + q[1] / 4], [0, 0])
    const L = Math.hypot(c[0] - door[0], c[1] - door[1])
    for (let t = 0.3; t <= 2.5; t += 0.2) {
      const x = door[0] + ((c[0] - door[0]) * t) / L
      const z = door[1] + ((c[1] - door[1]) * t) / L
      assert.ok(!solids.some((s) => inBox(s, x, z, 0.25)), `${type}: the way in is clear at ${t.toFixed(1)} m`)
    }
  }
})

test("propkit: presets put the expected things in", () => {
  const has = (type, t) => furnishRoom(room(type)).some((p) => p.t === t)
  assert.ok(has("gym", "treadmill") && has("gym", "powerrack") && has("gym", "mirror"))
  assert.ok(has("locker", "lockers") && has("locker", "shower") && has("locker", "sink"))
  assert.ok(has("restroom", "stall") && has("restroom", "sink"))
  assert.ok(has("cafe", "counter") && has("cafe", "backbar") && has("cafe", "stool"))
  assert.ok(has("lobby", "desk") && has("sauna", "saunabench") && has("sauna", "heater"))
  // furnish: false keeps only the room's own props
  const own = furnishRoom({ ...room("lobby"), furnish: false, props: [{ t: "plant", x: 40, z: -12, a: 0 }] })
  assert.deepEqual(own.map((p) => p.t), ["plant"])
})

test("propkit: footprints and the room rectangle", () => {
  const s = propSolid({ t: "vending", x: 3, z: 4, a: Math.PI / 2 })
  // turned a quarter: its width now runs along z
  assert.ok(Math.abs(s.ux) < 1e-9 && Math.abs(Math.abs(s.uz) - 1) < 1e-9)
  assert.equal(propSolid({ t: "rug", x: 0, z: 0 }), null)
  assert.ok(propSolid({ t: "bin", x: 1, z: 2 }).r > 0)
  const R = roomRect(P)
  assert.ok(Math.abs(R.L - 14) < 1e-6 && Math.abs(R.W - 9) < 1e-6)
})
