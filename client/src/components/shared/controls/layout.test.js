// node --test client/src/components/shared/controls/layout.test.js
import { test } from "node:test"
import assert from "node:assert/strict"
import { defaultLayout, fromPx, mergeLayout, retiredRects } from "./layout.js"

const size = { width: 380, height: 750 }
// Tetris's Hold moved from the bottom corner to halfway up (tetrisControls.jsx)
const oldHold = (s) => fromPx(s, { left: 6, bottom: 6, width: 48, height: 56 })
const controls = [
  { id: "pause", default: { portrait: (s) => fromPx(s, { left: 6, top: 6, width: 48, height: 32 }) } },
  { id: "hold", default: { portrait: (s) => fromPx(s, { left: 6, top: Math.round(s.height * 0.57 - 32), width: 48, height: 64 }) }, retired: { portrait: [oldHold] } },
]

test("no saved layout: the new default", () => {
  const d = defaultLayout(controls, size, "portrait")
  assert.equal(mergeLayout(d, null, retiredRects(controls, size, "portrait")), d)
})

test("a saved layout still holding the old default spot gets the new one", () => {
  const d = defaultLayout(controls, size, "portrait")
  const saved = { ...d, rects: { ...d.rects, hold: oldHold(size), pause: { x: 50, y: 50, w: 10, h: 5 } } }
  const m = mergeLayout(d, saved, retiredRects(controls, size, "portrait"))
  assert.deepEqual(m.rects.hold, d.rects.hold)
  // the player's own moves are kept
  assert.deepEqual(m.rects.pause, { x: 50, y: 50, w: 10, h: 5 })
})

test("a Hold the player moved stays where they put it", () => {
  const d = defaultLayout(controls, size, "portrait")
  const mine = { x: 80, y: 40, w: 12, h: 8 }
  const m = mergeLayout(d, { ...d, rects: { ...d.rects, hold: mine } }, retiredRects(controls, size, "portrait"))
  assert.deepEqual(m.rects.hold, mine)
})

test("rounded saved rects still match (stored to 3 decimals)", () => {
  const d = defaultLayout(controls, size, "portrait")
  const o = oldHold(size)
  const r = { x: Math.round(o.x * 10) / 10, y: Math.round(o.y * 10) / 10, w: o.w, h: o.h }
  const m = mergeLayout(d, { ...d, rects: { ...d.rects, hold: r } }, retiredRects(controls, size, "portrait"))
  assert.deepEqual(m.rects.hold, d.rects.hold)
})
