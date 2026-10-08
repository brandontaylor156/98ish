// node --test client/src/components/applets/snipping/snipMath.test.js
import test from "node:test"
import assert from "node:assert/strict"
import * as M from "./snipMath.js"

test("a drag makes the same box whichever way it went", () => {
  assert.deepEqual(M.normRect(10, 20, 50, 80), { x: 10, y: 20, w: 40, h: 60 })
  assert.deepEqual(M.normRect(50, 80, 10, 20), { x: 10, y: 20, w: 40, h: 60 })
  assert.deepEqual(M.normRect(50, 20, 10, 80), { x: 10, y: 20, w: 40, h: 60 })
})

test("boxes are kept on the screen", () => {
  assert.deepEqual(M.clampRect({ x: -10, y: -5, w: 30, h: 20 }, 100, 100), { x: 0, y: 0, w: 20, h: 15 })
  assert.deepEqual(M.clampRect({ x: 90, y: 90, w: 30, h: 30 }, 100, 100), { x: 90, y: 90, w: 10, h: 10 })
  assert.equal(M.clampRect({ x: 120, y: 0, w: 10, h: 10 }, 100, 100), null)
  assert.equal(M.clampRect(null, 100, 100), null)
})

test("screen box -> picture pixels at 2x grows outward and stays inside", () => {
  assert.deepEqual(M.toImageRect({ x: 10.3, y: 5.6, w: 20.2, h: 10.1 }, 2, 1000, 1000), { x: 20, y: 11, w: 41, h: 21 })
  // at 3x on a phone, a box at the right edge
  assert.deepEqual(M.toImageRect({ x: 380, y: 0, w: 10, h: 844 }, 3, 1170, 2532), { x: 1140, y: 0, w: 30, h: 2532 })
  assert.deepEqual(M.toImageRect({ x: 380, y: 0, w: 20, h: 900 }, 2, 780, 1688), { x: 760, y: 0, w: 20, h: 1688 })
})

test("the snip fits its box, centered, and isn't blown up past maxZoom", () => {
  const f = M.fitBox(800, 400, 400, 400)
  assert.equal(f.scale, 0.5)
  assert.deepEqual([f.w, f.h, f.x, f.y], [400, 200, 0, 100])
  const small = M.fitBox(100, 50, 400, 400, 1)
  assert.equal(small.scale, 1)
  const retina = M.fitBox(780, 400, 1000, 1000, 0.5)
  assert.equal(retina.scale, 0.5, "a 2x snip shows at its real size, not twice it")
  assert.deepEqual(M.fitBox(0, 10, 10, 10), { scale: 1, w: 0, h: 0, x: 0, y: 0 })
})

test("screen points map back to picture pixels and stay on the picture", () => {
  const f = M.fitBox(800, 400, 400, 400)
  assert.deepEqual(M.viewToImage(200, 200, f, 800, 400), { x: 400, y: 200 })
  assert.deepEqual(M.viewToImage(-50, 500, f, 800, 400), { x: 0, y: 400 })
})

test("pen and highlighter look the same width on screen at any zoom", () => {
  assert.equal(M.strokeWidth("pen", 1), 3)
  assert.equal(M.strokeWidth("pen", 0.5), 6)
  assert.equal(M.strokeWidth("pen", 0.5, "thick"), 12)
  assert.equal(M.strokeWidth("highlighter", 1), 14)
  assert.equal(M.strokeWidth("pen", 10), 1, "never thinner than a pixel")
})

test("strokes skip points that barely moved and round to 0.1 px", () => {
  let pts = M.addPoint([], 10.04, 10.06)
  assert.deepEqual(pts, [[10, 10.1]])
  assert.equal(M.addPoint(pts, 10.5, 10.5), pts, "too close: the same array back")
  pts = M.addPoint(pts, 20, 10)
  assert.equal(pts.length, 2)
  const b = M.strokeBounds({ width: 4, points: [[10, 10], [30, 20]] })
  assert.deepEqual(b, { x: 8, y: 8, w: 24, h: 14 })
  assert.equal(M.strokeBounds({ width: 4, points: [] }), null)
})

test("crops: too small or the whole picture do nothing; others clamp and round", () => {
  assert.equal(M.cropStep({ x: 1, y: 1, w: 2, h: 50 }, 100, 100), null)
  assert.equal(M.cropStep({ x: 0, y: 0, w: 100, h: 100 }, 100, 100), null)
  assert.equal(M.cropStep({ x: -5, y: -5, w: 120, h: 120 }, 100, 100), null, "past every edge = the whole picture")
  assert.deepEqual(M.cropStep({ x: 10.4, y: 20.6, w: 30.2, h: 40 }, 100, 100), { type: "crop", rect: { x: 10, y: 21, w: 30, h: 40 } })
})

test("layout follows crops in order: final size and each step's offset in the original", () => {
  const steps = [
    { type: "stroke", stroke: { points: [[5, 5]], width: 3 } },
    { type: "crop", rect: { x: 10, y: 20, w: 300, h: 200 } },
    { type: "stroke", stroke: { points: [[1, 1]], width: 3 } },
    { type: "crop", rect: { x: 50, y: 50, w: 400, h: 100 } }, // wider than what's left: clamped
  ]
  const l = M.layout(800, 600, steps)
  assert.deepEqual([l.w, l.h, l.x, l.y], [250, 100, 60, 70])
  assert.deepEqual(l.offsets, [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 10, y: 20 },
    { x: 10, y: 20 },
  ])
  assert.deepEqual(M.layout(800, 600, []).offsets, [])
})

test("names sort by time; big snips become JPEGs", () => {
  assert.equal(M.snipName(new Date(2026, 9, 8, 9, 5, 3)), "Snip 2026-10-08 at 09.05.03.png")
  assert.equal(M.snipName(new Date(2026, 0, 1, 23, 59, 59), "jpg"), "Snip 2026-01-01 at 23.59.59.jpg")
  assert.equal(M.pickFormat(500_000), "png")
  assert.equal(M.pickFormat(3_000_000), "jpg")
  assert.equal(M.countdownText(3), "Snip in 3...")
  assert.equal(M.countdownText(0), "Snip!")
})

test("the screen copier is pinned to an exact version on jsDelivr", () => {
  assert.match(M.SHOT_URL, /^https:\/\/cdn\.jsdelivr\.net\/npm\/modern-screenshot@\d+\.\d+\.\d+\/dist\/index\.mjs$/)
  assert.deepEqual(M.MODES.map((m) => m.id), ["rect", "window", "full"])
  assert.deepEqual(M.DELAYS, [0, 3, 5, 10])
})
