// Pickleball 98 against PPA Tour footage (docs/ppa-reference.md): the numbers measured from
// broadcasts that the game was checked or tuned against. The simulator (tools/rallysim.mjs)
// measures the game the same way the footage was measured.
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { simulate, observedKind } from "./tools/rallysim.mjs"
import { REAL_ROUTINE, createMatch } from "./match.js"

const here = path.dirname(fileURLToPath(import.meta.url))

// one short run of computer Pro doubles with the real between-points routine (shared below)
let pro = null
const proRun = () => (pro ||= simulate({ level: "pro", games: 2, routine: "real" }))

test("between points: the real routine takes ~13 s from the last hit to the next serve (tour: 13.1 s, 90% CI 10.7-15.4, n=143)", () => {
  const L = proRun()
  const b = L.timing.betweenSec
  assert.ok(b.n >= 15, `points ${b.n}`)
  assert.ok(b.median >= 11.5 && b.median <= 15, `between ${b.median} s`)
  // the quick routine (Game speed Fast, practice, tests) stays quick
  const Q = simulate({ level: "pro", games: 1 })
  assert.ok(Q.timing.betweenSec.median < 7, `quick ${Q.timing.betweenSec.median} s`)
  assert.equal(REAL_ROUTINE.walk, 1.4)
})

test("singles: a longer routine between points (tour 16.8 s, CI 12.5-18.4, n=53) and the singles players' speed (4.07 m/s, CI 3.71-4.30)", () => {
  const S = simulate({ level: "pro", games: 2, doubles: false, routine: "real" })
  const b = S.timing.betweenSec.median
  assert.ok(b >= 13.5 && b <= 18, `singles between ${b} s`)
  assert.ok(S.movement.speed95.median >= 3.4 && S.movement.speed95.median <= 4.4, `singles speed95 ${S.movement.speed95.median}`)
})

test("movement at Pro matches the tour's players (95th-percentile speed 3.31 m/s, acceleration 4.9 m/s^2, the returning team at the line 1.6 s after the return)", () => {
  const M = proRun().movement
  assert.ok(M.speed95.median >= 2.9 && M.speed95.median <= 3.8, `speed95 ${M.speed95.median}`)
  assert.ok(M.acc95.median >= 4.0 && M.acc95.median <= 6.3, `acc95 ${M.acc95.median}`)
  assert.ok(M.kitchenReturner.median >= 1.2 && M.kitchenReturner.median <= 2.1, `kitchen ${M.kitchenReturner.median}`)
  assert.ok(M.reaction.median >= 0.15 && M.reaction.median <= 0.4, `reaction ${M.reaction.median}`)
})

test("shot speeds at Pro sit in the tour's measured bands (dinks ~14.5 mph, drives ~43 mph, firm volleys ~24.5 mph)", () => {
  const O = proRun().observed
  const med = (k) => O[k]?.mph?.[1]
  assert.ok(med("dink") >= 11 && med("dink") <= 18, `dink ${med("dink")}`)
  assert.ok(med("serve") >= 34 && med("serve") <= 50, `serve ${med("serve")}`)
  if (O["firm at net"]) assert.ok(med("firm at net") >= 20 && med("firm at net") <= 31, `firm ${med("firm at net")}`)
  if (O["third drive"]) assert.ok(med("third drive") >= 36 && med("third drive") <= 56, `third drive ${med("third drive")}`)
})

test("observedKind classes shots the way the footage was classed", () => {
  assert.equal(observedKind({ idx: 0, mph: 45, hitterZ: 7, y: 0.5, apex: 1.3, landZ: 5 }), "serve")
  assert.equal(observedKind({ idx: 2, mph: 22, hitterZ: 6.5, y: 0.6, apex: 1.9, landZ: 1.5 }), "third drop")
  assert.equal(observedKind({ idx: 2, mph: 45, hitterZ: 6.5, y: 0.7, apex: 1.1, landZ: 5 }), "third drive")
  assert.equal(observedKind({ idx: 6, mph: 14, hitterZ: 2.4, y: 0.5, apex: 1.1, landZ: 1.5 }), "dink")
  assert.equal(observedKind({ idx: 6, mph: 45, hitterZ: 2.4, y: 0.9, apex: 1.1, landZ: null }), "fast at net")
  assert.equal(observedKind({ idx: 6, mph: 50, hitterZ: 3, y: 2.1, apex: 2.1, landZ: 2 }), "overhead")
  assert.equal(observedKind({ idx: 6, mph: 25, hitterZ: 2.5, y: 0.6, apex: 4.2, landZ: 6 }), "lob")
})

test("a tap hurries the computer server's routine", () => {
  const m = createMatch({ doubles: true, level: "pro", seed: 3, routine: "real", roster: [
    { id: "you", team: 0, ctrl: "human", slot: 0 },
    { id: "a", team: 0, ctrl: "cpu" },
    { id: "b", team: 1, ctrl: "cpu" },
    { id: "c", team: 1, ctrl: "cpu" },
  ], firstServer: 1 })
  return import("./match.js").then(({ step, press }) => {
    // let them settle into the serve, then tap: the serve comes well before the routine's end
    let n = 0
    while (m.phase !== "serve" && n < 240 * 20) step(m), n++
    assert.equal(m.phase, "serve")
    const server = m.players.find((p) => p.id === m.ball.held)
    assert.ok(server.ctrl === "cpu" && server.serveAt > 1.5, `serveAt ${server.serveAt}`)
    press(m, 0)
    let k = 0
    while (m.phase === "serve" && k < 240 * 10) step(m), k++
    assert.ok(k / 240 < 1.2, `served after ${(k / 240).toFixed(2)} s`)
  })
})

test("Game speed: Medium (real life) is the default; Slow and Fast scale the clock", () => {
  const menus = fs.readFileSync(path.join(here, "menus.jsx"), "utf8")
  const page = fs.readFileSync(path.join(here, "Pickleball.jsx"), "utf8")
  const engine = fs.readFileSync(path.join(here, "engine.js"), "utf8")
  assert.match(menus, /export const PACE = \{ slow: 0\.8, medium: 1, fast: 1\.2 \}/)
  assert.match(engine, /const PACE_SCALE = \{ slow: 0\.8, medium: 1, fast: 1\.2 \}/)
  assert.match(page, /pace: "medium",/)
  assert.match(menus, /"Medium \(real life\)"/)
  // the real routine at Medium and Slow, not on Fast
  assert.match(engine, /routine: !demo && settings\.pace !== "fast" \? "real" : "quick"/)
})
