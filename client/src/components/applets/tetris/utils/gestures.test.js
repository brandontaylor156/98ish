import { test } from "node:test"
import assert from "node:assert/strict"
import { createGestureTracker } from "./gestures.js"

// A 10-wide board of 24 px cells starting at x = 0; the piece starts in column 3 and can
// move between 0 and 7 (a 3-wide piece)
const setup = (opts = {}) => {
  const actions = []
  const piece = { col: 3, min: 0, max: 7 }
  const tracker = createGestureTracker({
    cellWidth: 24,
    cellHeight: 24,
    centerX: 120,
    ...opts,
    act: (a) => {
      actions.push(a)
      if (a === "left" || a === "right") {
        const next = piece.col + (a === "left" ? -1 : 1)
        if (next < piece.min || next > piece.max) return false
        piece.col = next
      }
      return true
    },
  })
  return { tracker, actions, piece }
}

// Drive a path: points [x, y] spread evenly over `ms`, sampled every 8 ms (a 120 Hz screen
// with coalesced events). Returns the end time.
const drag = (tracker, path, { id = 1, t0 = 0, ms = 400, lift = true, liftAfter = 0 } = {}) => {
  const [first] = path
  tracker.down({ id, x: first[0], y: first[1], t: t0 })
  const segs = path.length - 1
  const steps = Math.max(1, Math.round(ms / 8))
  let last = { x: first[0], y: first[1], t: t0 }
  for (let s = 1; s <= steps; s++) {
    const pos = (s / steps) * segs
    const i = Math.min(segs - 1, Math.floor(pos))
    const f = pos - i
    const [ax, ay] = path[i]
    const [bx, by] = path[i + 1]
    last = { id, x: ax + (bx - ax) * f, y: ay + (by - ay) * f, t: t0 + (s / steps) * ms }
    tracker.move(last)
  }
  if (lift) tracker.up({ ...last, id, t: last.t + liftAfter })
  return last.t
}

const count = (actions, a) => actions.filter((x) => x === a).length

test("a tap rotates clockwise", () => {
  const { tracker, actions } = setup()
  tracker.down({ id: 1, x: 100, y: 200, t: 0 })
  tracker.move({ id: 1, x: 103, y: 202, t: 40 })
  tracker.up({ id: 1, x: 103, y: 202, t: 90 })
  assert.deepEqual(actions, ["rotateRight"])
})

test("tap sides: left half rotates counterclockwise, right half clockwise", () => {
  const { tracker, actions } = setup({ tapSides: true })
  tracker.down({ id: 1, x: 60, y: 200, t: 0 })
  tracker.up({ id: 1, x: 60, y: 200, t: 80 })
  tracker.down({ id: 2, x: 200, y: 200, t: 200 })
  tracker.up({ id: 2, x: 200, y: 200, t: 280 })
  assert.deepEqual(actions, ["rotateLeft", "rotateRight"])
})

test("a long press without moving isn't a tap", () => {
  const { tracker, actions } = setup()
  tracker.down({ id: 1, x: 100, y: 200, t: 0 })
  tracker.up({ id: 1, x: 100, y: 200, t: 900 })
  assert.deepEqual(actions, [])
})

test("dragging left 3 cells moves the piece 3 columns", () => {
  const { tracker, actions, piece } = setup()
  drag(tracker, [[150, 300], [150 - 72, 300]], { ms: 300 })
  assert.deepEqual(actions, ["left", "left", "left"])
  assert.equal(piece.col, 0)
})

test("the piece follows the finger back and forth, 1:1 in cells", () => {
  const { tracker, actions, piece } = setup()
  drag(tracker, [[150, 300], [150 + 48, 300], [150 - 24, 300]], { ms: 600 })
  assert.equal(count(actions, "right"), 2)
  assert.equal(count(actions, "left"), 3)
  assert.equal(piece.col, 2)
})

test("sensitivity 2 moves two columns per cell of travel", () => {
  const { tracker, piece } = setup({ sensitivity: 2 })
  drag(tracker, [[100, 300], [100 + 48, 300]], { ms: 300 })
  assert.equal(piece.col, 7)
})

test("small jitter around a step doesn't flip the piece back and forth", () => {
  const { tracker, actions } = setup()
  drag(tracker, [[100, 300], [117, 300], [113, 301], [118, 300], [112, 300], [117, 299]], { ms: 500 })
  assert.deepEqual(actions, ["right"])
})

test("at a wall the drag re-anchors: coming back moves at once", () => {
  const { tracker, actions, piece } = setup()
  // 3 columns of room to the left, finger goes 6 cells left, then 1 cell back right
  drag(tracker, [[200, 300], [200 - 144, 300], [200 - 144 + 24, 300]], { ms: 700 })
  assert.equal(piece.col, 1)
  assert.equal(actions.at(-1), "right")
})

test("a slow drag down soft drops one row per cell, no hard drop", () => {
  const { tracker, actions } = setup()
  // 5 cells in 1 second: 0.12 px/ms, then a pause and lift
  drag(tracker, [[100, 200], [100, 320]], { ms: 1000, liftAfter: 150 })
  assert.equal(count(actions, "softDrop"), 5)
  assert.equal(count(actions, "hardDrop"), 0)
})

test("a fast flick down hard drops once, and the rest of the touch is ignored", () => {
  const { tracker, actions } = setup()
  // 160 px in 80 ms (2 px/ms), then the finger keeps going sideways
  drag(tracker, [[100, 200], [100, 360], [20, 380]], { ms: 120 })
  assert.equal(count(actions, "hardDrop"), 1)
  const after = actions.slice(actions.indexOf("hardDrop") + 1)
  assert.deepEqual(after, [])
})

test("a medium-speed drag down is a soft drop, not a hard drop", () => {
  const { tracker, actions } = setup()
  // 0.45 px/ms
  drag(tracker, [[100, 200], [100, 335]], { ms: 300, liftAfter: 100 })
  assert.equal(count(actions, "hardDrop"), 0)
  assert.ok(count(actions, "softDrop") >= 5)
})

test("a slow soft drop that stops before lifting doesn't hard drop", () => {
  const { tracker, actions } = setup()
  const t = drag(tracker, [[100, 200], [100, 290]], { ms: 500, lift: false })
  tracker.up({ id: 1, x: 100, y: 290, t: t + 200 })
  assert.equal(count(actions, "hardDrop"), 0)
})

test("a sideways drag ending with a slight downward motion doesn't drop", () => {
  const { tracker, actions } = setup()
  // fast slide right, then a quick 18 px dip down as the finger lifts
  drag(tracker, [[60, 300], [150, 302], [156, 320]], { ms: 160 })
  assert.equal(count(actions, "hardDrop"), 0)
  assert.equal(count(actions, "softDrop"), 0)
  assert.ok(count(actions, "right") >= 3)
})

test("a fast diagonal sideways drag never hard drops", () => {
  const { tracker, actions } = setup()
  drag(tracker, [[40, 200], [200, 290]], { ms: 100 })
  assert.equal(count(actions, "hardDrop"), 0)
})

test("slide over, then drag down in one motion: moves, then soft drops", () => {
  const { tracker, actions } = setup()
  drag(tracker, [[100, 200], [148, 200], [148, 300]], { ms: 1200, liftAfter: 100 })
  assert.equal(count(actions, "right"), 2)
  assert.ok(count(actions, "softDrop") >= 3)
  assert.equal(count(actions, "hardDrop"), 0)
  assert.ok(actions.indexOf("softDrop") > actions.lastIndexOf("right"))
})

test("slide over, then flick down: hard drop", () => {
  const { tracker, actions } = setup()
  const t = drag(tracker, [[100, 200], [148, 200]], { ms: 400, lift: false })
  for (let i = 1; i <= 10; i++) tracker.move({ id: 1, x: 148, y: 200 + i * 16, t: t + 40 + i * 8 })
  tracker.up({ id: 1, x: 148, y: 360, t: t + 130 })
  assert.equal(count(actions, "right"), 2)
  assert.equal(count(actions, "hardDrop"), 1)
})

test("a swipe up holds once", () => {
  const { tracker, actions } = setup()
  drag(tracker, [[100, 400], [100, 300], [100, 200]], { ms: 150 })
  assert.deepEqual(actions, ["hold"])
})

test("a short wobble up is neither a hold nor a tap", () => {
  const { tracker, actions } = setup()
  drag(tracker, [[100, 400], [100, 385]], { ms: 100 })
  assert.deepEqual(actions, [])
})

test("a second finger is ignored", () => {
  const { tracker, actions } = setup()
  tracker.down({ id: 1, x: 150, y: 300, t: 0 })
  assert.equal(tracker.down({ id: 2, x: 50, y: 300, t: 10 }), false)
  tracker.move({ id: 2, x: 0, y: 300, t: 20 }) // second finger drags: nothing
  tracker.up({ id: 2, x: 0, y: 300, t: 30 }) // and lifts: no tap rotate
  assert.deepEqual(actions, [])
  for (let i = 1; i <= 6; i++) tracker.move({ id: 1, x: 150 + i * 8, y: 300, t: 30 + i * 16 })
  tracker.up({ id: 1, x: 198, y: 300, t: 140 })
  assert.deepEqual(actions, ["right", "right"])
})

test("finish() ends steering for the rest of the touch", () => {
  const { tracker, actions } = setup()
  tracker.down({ id: 1, x: 100, y: 300, t: 0 })
  tracker.move({ id: 1, x: 124, y: 300, t: 50 })
  tracker.finish()
  tracker.move({ id: 1, x: 200, y: 300, t: 100 })
  tracker.up({ id: 1, x: 200, y: 300, t: 150 })
  assert.deepEqual(actions, ["right"])
})

test("cancel forgets the touch without a tap", () => {
  const { tracker, actions } = setup()
  tracker.down({ id: 1, x: 100, y: 300, t: 0 })
  tracker.cancel(1)
  tracker.up({ id: 1, x: 100, y: 300, t: 50 })
  assert.deepEqual(actions, [])
  assert.equal(tracker.active, false)
})
