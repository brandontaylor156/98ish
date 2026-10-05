// Pickleball 98, pb7: the one banner slot, the Swipe controls (gesture -> shot), the move
// pad's side, the camera's clear view, and that nothing moves your player for you.
// Run: node --test client/src/components/applets/pickleball/pb7.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { LIFE, clearBanners, emptyBanners, nextBannerAt, pushBanner, tickBanners } from "./banner.js"
import { SWIPE, layoutKey, padRects, readSwipe, swipeServe, swipeTarget, touchControlsFor, touchPrefs } from "./touchplay.js"
import { blocker, clearShot, serverShot } from "./camera.js"
import { HALF_L, HALF_W, KITCHEN } from "./physics.js"
import { createMatch, humanBySlot, playerById, press, release, scenario, step } from "./match.js"
import { paceBand } from "./shots.js"

// ---- the banner slot ----
test("banners: one at a time, the newest shot label replaces the last", () => {
  let b = emptyBanners()
  b = pushBanner(b, { kind: "shot", text: "Dink" }, 0)
  b = pushBanner(b, { kind: "shot", text: "Drive" }, 300)
  assert.equal(b.current.text, "Drive")
  assert.equal(b.queue.length, 0)
})

test("banners: a shot label never waits behind a call, and never overlaps it", () => {
  let b = emptyBanners()
  b = pushBanner(b, { kind: "call", text: "0-1-1", over: "GUS to serve" }, 0)
  b = pushBanner(b, { kind: "shot", text: "Serve", sub: "soft · 34 mph" }, 200)
  assert.equal(b.current.text, "0-1-1")
  assert.equal(b.queue.length, 0, "the shot label is dropped, not queued")
  b = tickBanners(b, LIFE.call + 10)
  assert.equal(b.current, null, "and nothing comes up after the call")
})

test("banners: the score call replaces a shot label at once; a lower item waits its turn", () => {
  let b = emptyBanners()
  b = pushBanner(b, { kind: "shot", text: "Serve" }, 0)
  b = pushBanner(b, { kind: "call", text: "0-1-1" }, 100)
  assert.equal(b.current.text, "0-1-1")
  b = pushBanner(b, { kind: "play", text: "Side out" }, 150)
  assert.equal(b.current.text, "0-1-1")
  assert.equal(b.queue.length, 1)
  // the call lasts its life; then Side out shows only if it's still news (it isn't: 1.2 s)
  b = tickBanners(b, 100 + LIFE.call)
  assert.equal(b.current, null, "a stale banner is dropped")
})

test("banners: a point's outcome queued behind the score call shows after it, with its full life", () => {
  let b = emptyBanners()
  b = pushBanner(b, { kind: "call", text: "4-2-1" }, 0)
  b = pushBanner(b, { kind: "play", text: "Second server" }, 1000)
  assert.equal(b.current.text, "4-2-1")
  b = tickBanners(b, LIFE.call + 1)
  assert.equal(b.current?.text, "Second server")
  assert.equal(b.current.until - b.current.at, LIFE.play)
  assert.ok(nextBannerAt(b) > LIFE.call)
  assert.equal(clearBanners(b).current, null)
})

test("banners: over a whole simulated game nothing is ever on screen twice", () => {
  // a stream of events like a match makes: shots, line calls, outcomes, calls
  let b = emptyBanners()
  let shown = 0
  let t = 0
  const kinds = ["shot", "shot", "line", "shot", "play", "call", "shot", "play", "call"]
  for (let i = 0; i < 400; i++) {
    t += 120 + ((i * 37) % 400)
    b = tickBanners(b, t)
    b = pushBanner(b, { kind: kinds[i % kinds.length], text: `x${i}` }, t)
    assert.ok(!b.current || b.current.until > t)
    assert.ok(b.queue.every((q) => q.kind !== "shot"), "shot labels never queue")
    shown++
  }
  assert.ok(shown > 0)
})

// ---- the Swipe controls ----
const SIZE = { width: 390, height: 760 }
const swipe = (dx, dy, ms, hold = 0) => [
  { x: 260, y: 600, t: 0 },
  { x: 260, y: 600, t: hold },
  { x: 260 + dx / 2, y: 600 + dy / 2, t: hold + ms / 2 },
  { x: 260 + dx, y: 600 + dy, t: hold + ms },
]

test("swipe: a tap is a soft touch shot with the default target", () => {
  const s = readSwipe([{ x: 10, y: 10, t: 0 }, { x: 14, y: 12, t: 90 }], SIZE)
  assert.equal(s.tap, true)
  assert.equal(paceBand(s.pace), "soft")
  assert.equal(swipeTarget(s, { team: 0 }), null)
})

test("swipe: speed is pace (a quick flick hard, a slow swipe soft), holding first doesn't count", () => {
  const flick = readSwipe(swipe(0, -240, 90), SIZE)
  const slow = readSwipe(swipe(0, -240, 700), SIZE)
  const heldThenFlick = readSwipe(swipe(0, -240, 90, 900), SIZE)
  assert.equal(paceBand(flick.pace), "hard", `flick ${flick.pace.toFixed(2)}`)
  assert.equal(paceBand(slow.pace), "soft", `slow ${slow.pace.toFixed(2)}`)
  assert.ok(Math.abs(heldThenFlick.pace - flick.pace) < 0.05, "waiting with the finger down isn't slowness")
})

test("swipe: direction aims across, length aims deep; their court, on the right side", () => {
  const left = readSwipe(swipe(-160, -200, 300), SIZE)
  const right = readSwipe(swipe(160, -200, 300), SIZE)
  const short = readSwipe(swipe(0, -40, 300), SIZE)
  const long = readSwipe(swipe(0, -300, 300), SIZE)
  assert.ok(left.u < -0.5 && right.u > 0.5)
  assert.ok(short.depth < 0.3 && long.depth > 0.95)
  // team 0 plays from +z, the camera behind it: screen right = +x, their court is -z
  const tl = swipeTarget(left, { team: 0 })
  const tr = swipeTarget(right, { team: 0 })
  assert.ok(tl.x < 0 && tr.x > 0 && tl.z < 0 && tr.z < 0)
  const ts = swipeTarget(short, { team: 0 })
  const tlong = swipeTarget(long, { team: 0 })
  assert.ok(Math.abs(ts.z) < KITCHEN, "a short swipe drops it in their kitchen")
  assert.ok(Math.abs(tlong.z) > HALF_L - 1, "a long one goes deep")
  assert.ok(Math.abs(tr.x) <= HALF_W, "inside the sidelines")
  // from the other end (online, team 1) the screen is turned round
  const t1 = swipeTarget(right, { team: 1, flip: true })
  assert.ok(t1.z > 0 && t1.x < 0)
})

test("swipe: a slow, long swipe is a soft deep ball (a lob); a short swipe a drop", () => {
  const lob = readSwipe(swipe(0, -300, 900), SIZE)
  assert.equal(paceBand(lob.pace), "soft")
  assert.ok(lob.depth > 0.9)
})

test("swipe: the serve's power comes from the swipe; a tap is the safe serve", () => {
  assert.equal(swipeServe({ tap: true }).grade, "early")
  const hard = swipeServe(readSwipe(swipe(0, -240, 90), SIZE))
  const easy = swipeServe(readSwipe(swipe(0, -240, 400), SIZE))
  assert.ok(hard.power > easy.power)
  assert.ok(easy.power >= 0.4 && hard.power <= 1)
})

test("swipe: the gesture plays a real shot through press/release (pace and target used)", () => {
  const m = createMatch({ doubles: false, level: "beginner", seed: 7, assist: "reflex", roster: [
    { id: "you", team: 0, ctrl: "human", slot: 0, name: "You" },
    { id: "opp1", team: 1, ctrl: "cpu", level: "beginner", name: "CPU" },
  ] })
  scenario(m, "drive")
  const p = humanBySlot(m, 0)
  const s = readSwipe(swipe(120, -260, 120), SIZE)
  const target = swipeTarget(s, { team: 0 })
  assert.ok(press(m, 0))
  assert.ok(release(m, 0, { pace: s.pace, target }))
  assert.equal(p.armed.pace, s.pace)
  assert.deepEqual(p.armed.target, target)
})

// ---- the move pad's side ----
test("pad side: left puts the pad bottom-left and the hit area right; right mirrors it", () => {
  const S = { width: 390, height: 760 }
  const L = padRects("left", "portrait", S)
  const R = padRects("right", "portrait", S)
  assert.ok("left" in L.move && "right" in L.hit)
  assert.ok("right" in R.move && "left" in R.hit)
  assert.equal(L.move.width, R.move.width)
  const LS = padRects("right", "landscape", { width: 844, height: 390 })
  assert.ok("right" in LS.move && LS.hit.height === 390)
  assert.notEqual(layoutKey("left"), layoutKey("right"))
  const fromPx = (s, r) => r
  const list = touchControlsFor("right", fromPx, "swipe")
  assert.deepEqual(list.map((c) => c.id), ["move", "hit", "hitTop", "pause"], "no camera button, no gear on screen")
  assert.ok(list.every((c) => c.mirror === false))
  assert.equal(list[0].default.portrait(S).right, 0)
  assert.deepEqual(touchPrefs({ padSide: "right", scheme: "swipe" }), { scheme: "swipe", padSide: "right" })
  assert.deepEqual(touchPrefs({ padSide: "up", scheme: "auto" }), { scheme: null, padSide: "left" })
})

// ---- the camera ----
test("camera: a body next to the lens or in the first meters of the view moves the camera", () => {
  const look = { x: 0, y: 1, z: -6 }
  // the old between-points cut: 2.6 m beside the server, the partner right there
  const cam = { x: -1.6, y: 1.7, z: 3.4 }
  const partner = { x: -1.3, z: 4.6 }
  assert.ok(blocker(cam, look, [partner]))
  const c = clearShot(cam, look, [partner])
  assert.ok(c.moved > 0)
  assert.equal(blocker(c, look, [partner]), null)
  // the broadcast view high behind you is already clear
  const bc = { x: 0, y: 4.9, z: 13 }
  assert.equal(clearShot(bc, { x: 0, y: 0, z: -2 }, [{ x: 0, z: 6.4 }]).moved, 0)
})

test("camera: the server's TV shot is from outside the court on the server's side, clear of the partner", () => {
  for (const team of [0, 1]) {
    for (const sx of [-1, 1]) {
      const server = { x: sx * 1.2, z: (team === 0 ? 1 : -1) * (HALF_L + 0.2), team }
      const partner = { x: -sx * 1.4, z: server.z }
      const shot = serverShot(server)
      assert.ok(Math.abs(shot.cam.x) > HALF_W + 2, "outside the sideline")
      assert.equal(Math.sign(shot.cam.x), sx, "on the server's own side")
      assert.equal(blocker(shot.cam, shot.look, [partner]), null, "the partner is behind the server, not in front of the lens")
      assert.equal(blocker(shot.cam, shot.look, [server]), null, "not too close to the server either")
    }
  }
})

// ---- nothing moves you ----
test("reflex assist: your player never moves without your input", () => {
  const m = createMatch({ doubles: false, level: "beginner", seed: 3, assist: "reflex", roster: [
    { id: "you", team: 0, ctrl: "human", slot: 0, name: "You" },
    { id: "opp1", team: 1, ctrl: "cpu", level: "beginner", name: "CPU" },
  ] })
  scenario(m, "drive")
  const p = playerById(m, "you")
  const x0 = p.x
  const z0 = p.z
  press(m, 0) // holding the paddle up as the ball comes: the light assist used to step you in
  for (let i = 0; i < 240; i++) step(m, 1 / 240)
  assert.ok(Math.hypot(p.x - x0, p.z - z0) < 0.02, `moved ${Math.hypot(p.x - x0, p.z - z0).toFixed(3)} m`)
})
