import { test } from "node:test"
import assert from "node:assert/strict"
import { pickMoments, scoreRally, callText, MPH } from "./moments.js"
import { buildTimeline, fadeAt, TIMING } from "./timeline.js"
import { layout, contain } from "./overlay.js"
import { popTimes } from "./soundtrack.js"

const rally = (id, start, n, { kinds = [], speed = null, call = null } = {}) => ({
  id,
  start,
  end: start + n * 1.2,
  hits: Array.from({ length: n }, (_, i) => ({
    t: start + i * 1.2,
    player: i % 2 ? 2 : 0,
    team: i % 2,
    kind: kinds[i] || "drive",
    ball: i === n - 1 && (speed || call) ? { speed: speed || 10, conf: 0.9, bounce: call ? { x: 1, z: 3, t: start + i * 1.2 + 0.5 } : null, call } : speed ? { speed, conf: 0.9 } : undefined,
  })),
})
const analysis = (rallies) => ({ rallies, players: [{ id: 0, name: "Brandon", samples: [] }, { id: 2, name: "Sam", samples: [] }] })

test("scoring: long, fast, close calls and kitchen battles score higher", () => {
  const a = analysis([rally(0, 0, 3), rally(1, 10, 12), rally(2, 30, 4, { speed: 22 }), rally(3, 40, 8, { kinds: ["serve", "return", "dink", "dink", "dink", "dink", "dink", "dink"] })])
  const s = a.rallies.map((r, i) => scoreRally(r, a, i))
  assert.ok(s[1].score > s[0].score, "a 12-shot rally beats a 3-shot one")
  assert.ok(s[2].score > scoreRally(rally(9, 0, 4), a, 0).score, "a 49 mph shot adds")
  assert.ok(s[2].tags.some((t) => t.k === "fast" && t.text === `${Math.round(22 * MPH)} mph`))
  assert.ok(s[3].tags.some((t) => t.k === "kitchen"))
  const close = scoreRally(rally(4, 0, 4, { call: { verdict: "out", margin: -0.04, close: false, line: "base" } }), a, 0)
  assert.ok(close.call && close.tags.some((t) => t.k === "call" && t.text === "OUT by 4 cm"))
  assert.equal(callText({ close: true, verdict: "in", margin: 0.01 }), "Too close: call stands")
})

test("picking: the top five, in order, with the best saved for last", () => {
  const a = analysis([rally(0, 0, 3), rally(1, 10, 12), rally(2, 30, 5), rally(3, 40, 9), rally(4, 60, 2), rally(5, 70, 7), rally(6, 90, 1)])
  const m = pickMoments(a, { max: 5 })
  assert.equal(m.length, 5)
  assert.equal(m.at(-1).ri, 1, "the 12-shot rally closes the reel")
  assert.ok(m.at(-1).best)
  const rest = m.slice(0, -1).map((x) => x.ri)
  assert.deepEqual(rest, [...rest].sort((x, y) => x - y), "the rest in the order they happened")
  assert.ok(!m.some((x) => x.ri === 6), "one-shot rallies aren't moments")
  assert.deepEqual(pickMoments({ rallies: [] }), [])
})

test("timeline: title, segments per moment, end card; fits the cap", () => {
  const a = analysis([rally(0, 5, 6), rally(1, 20, 10, { call: { verdict: "in", margin: 0.03, close: false } })])
  const moments = pickMoments(a)
  const withVideo = buildTimeline(moments, { hasVideo: true, maxSec: 60 })
  const kinds = withVideo.segments.map((s) => s.kind)
  assert.equal(kinds[0], "title")
  assert.equal(kinds.at(-1), "end")
  assert.equal(kinds.filter((k) => k === "footage").length, 2, "each moment's footage")
  assert.equal(kinds.filter((k) => k === "cutin").length, 1, "the best point gets a 3D cut-in")
  assert.equal(kinds.filter((k) => k === "challenge").length, 1, "the close call gets Hawk-Eye")
  // contiguous
  withVideo.segments.reduce((at, s) => (assert.ok(Math.abs(s.start - at) < 1e-6), at + s.dur), 0)
  assert.ok(Math.abs(withVideo.duration - withVideo.segments.reduce((n, s) => n + s.dur, 0)) < 1e-6)
  // footage has its pre-roll and fits the clip cap
  const f = withVideo.segments.find((s) => s.kind === "footage")
  assert.ok(f.t0 <= f.m.rally.start - TIMING.pre + 1e-6 || f.t0 === 0)
  assert.ok(f.dur <= TIMING.maxFootage + 1e-6)
  // without video everything is 3D
  const noVideo = buildTimeline(moments, { hasVideo: false })
  assert.equal(noVideo.segments.filter((s) => s.kind === "footage").length, 0)
  assert.equal(noVideo.segments.filter((s) => s.kind === "cutin").length, 2)
  // a long game is cut down to the cap
  const big = analysis(Array.from({ length: 12 }, (_, i) => rally(i, i * 30, 9 + (i % 4))))
  const capped = buildTimeline(pickMoments(big, { max: 5 }), { hasVideo: true, maxSec: 30 })
  assert.ok(capped.duration <= 30 + 1e-6, `${capped.duration} s`)
  assert.ok(capped.moments.some((m) => m.best), "the best point survives the cut")
})

test("fades at segment edges; overlay layout stays on screen at any size", () => {
  const seg = { start: 10, dur: 4 }
  assert.equal(fadeAt(seg, 10), 1)
  assert.equal(fadeAt(seg, 12), 0)
  assert.ok(fadeAt(seg, 13.9) > 0.5)
  for (const [W, H] of [[1280, 720], [720, 1280], [640, 360]]) {
    const L = layout(W, H)
    for (const r of [L.bug, L.badge, L.lower, L.banner]) {
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H, `${W}x${H} ${JSON.stringify(r)}`)
    }
    assert.ok(L.bug.x + L.bug.w < L.badge.x || L.bug.y + L.bug.h < L.badge.y, "bug and badge don't overlap")
  }
  assert.deepEqual(contain(1920, 1080, 1280, 720), { x: 0, y: 0, w: 1280, h: 720 })
  assert.deepEqual(contain(1080, 1920, 1280, 720), { x: 438, y: 0, w: 405, h: 720 })
})

test("paddle pops land where the hits are shown (slowed in the challenge)", () => {
  const a = analysis([rally(0, 5, 3, { call: { verdict: "out", margin: -0.05 } })])
  const tl = buildTimeline(pickMoments(a), { hasVideo: true })
  const pops = popTimes(tl)
  const f = tl.segments.find((s) => s.kind === "footage")
  for (const h of a.rallies[0].hits) assert.ok(pops.some((p) => Math.abs(p - (f.start + h.t - f.t0)) < 1e-3), `hit at ${h.t}`)
  assert.deepEqual(pops, [...pops].sort((x, y) => x - y))
})
