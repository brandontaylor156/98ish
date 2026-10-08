// Venue Finder index build: the world split (regions on one grid, the rest round them), resume
// coverage and town boxes.   node --test tools/venues/world/tiles.test.mjs
import test from "node:test"
import assert from "node:assert/strict"
import { planTiles, restTiles, cellsOf, isCovered, quarters, townBoxes, NAMED } from "./tiles.mjs"

const k = (t) => t.join(",")
const area = ([s, w, n, e]) => (n - s) * (e - w)

test("regions are cells of one 5 x 10 grid, so overlapping regions share tiles", () => {
  for (const t of planTiles("us-west,us-east,canada,uk,spain,australia,europe,oceania")) {
    assert.equal(t[2] - t[0], 5)
    assert.equal(t[3] - t[1], 10)
    assert.equal(((t[0] % 5) + 5) % 5, 0)
    assert.equal(((t[1] % 10) + 10) % 10, 0)
  }
  const eu = new Set(planTiles("europe").map(k))
  assert.ok(planTiles("uk").every((t) => eu.has(k(t))))
  assert.ok(planTiles("spain").every((t) => eu.has(k(t))))
  const us = new Set(planTiles("us-west,us-east").map(k))
  assert.ok(planTiles("us").every((t) => us.has(k(t))))
  // the owner's venues are in the US plan
  assert.ok(planTiles("us-west").some(([s, w, n, e]) => s <= 33.7 && n > 33.7 && w <= -117.9 && e > -117.9))
})

test("the world plan covers the globe (-60..80) exactly once: named cells plus the rest", () => {
  const named = planTiles(NAMED.join(","))
  const rest = restTiles()
  const total = [...named, ...rest].reduce((s, t) => s + area(t), 0)
  assert.equal(total, 140 * 360)
  // no rest tile overlaps a named cell
  const nset = new Set(named.map(k))
  for (const t of rest) for (const c of cellsOf(t)) assert.ok(!nset.has(k(c)), `${t} overlaps ${c}`)
  // "world" = every region in priority order, US first, no repeats
  const world = planTiles("world")
  assert.equal(new Set(world.map(k)).size, world.length)
  assert.equal(world.length, named.length + rest.length)
  assert.deepEqual(world.slice(0, planTiles("us-west").length), planTiles("us-west"))
})

test("resume: a tile is covered by its own answer or its quarters' (recursively)", () => {
  const t = [30, -120, 35, -110]
  const got = new Set()
  const has = (x) => got.has(k(x))
  assert.equal(isCovered(t, has), false)
  const [a, b, c, d] = quarters(t)
  ;[a, b, c].forEach((q) => got.add(k(q)))
  assert.equal(isCovered(t, has), false)
  quarters(d).forEach((q) => got.add(k(q)))
  assert.equal(isCovered(t, has), true)
  assert.equal(isCovered(t, () => false), false)
})

test("towns are asked only round the courts: quarter-degree cells, padded, merged along a row", () => {
  const boxes = townBoxes([[33.7, -117.9], [33.7, -117.6], [33.8, -116.2], [40.7, -74.0]])
  assert.equal(boxes.length, 3)
  // (two courts 2 cells apart share a box)
  assert.deepEqual(boxes[0], [33.35, -118.15, 33.9, -117.35])
  assert.deepEqual(boxes[1], [33.6, -116.4, 34.15, -115.85])
  assert.deepEqual(boxes[2], [40.35, -74.15, 40.9, -73.6])
  assert.deepEqual(townBoxes([]), [])
})
