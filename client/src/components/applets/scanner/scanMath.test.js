// Scanner 98: finding a page's corners on made-up photos, the perspective math, the looks.
// node --test client/src/components/applets/scanner/scanMath.test.js
import test from "node:test"
import assert from "node:assert/strict"
import * as S from "./scanMath.js"

// point inside a convex polygon (clockwise or not)
const inside = (poly, x, y) => {
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)
    if (c === 0) continue
    const s = Math.sign(c)
    if (sign && s !== sign) return false
    sign = s
  }
  return true
}

// a w x h gray photo: a dark (or textured) table with a bright page at `quad`, a few dark
// "lines of text" on the page, and some noise
const photo = (w, h, quad, { table = 60, paper = 215, noise = 10, text = true, seed = 7 } = {}) => {
  let r = seed
  const rand = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648)
  const g = new Uint8Array(w * h)
  const minY = Math.min(...quad.map((p) => p.y))
  const maxY = Math.max(...quad.map((p) => p.y))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = table + (x / w) * 20
      if (inside(quad, x + 0.5, y + 0.5)) {
        v = paper
        // text: thin dark bands across the middle of the page
        const rel = (y - minY) / (maxY - minY)
        if (text && rel > 0.2 && rel < 0.8 && Math.floor(rel * 40) % 3 === 0 && (x % 9) < 6) v = 40
      }
      g[y * w + x] = Math.max(0, Math.min(255, Math.round(v + (rand() - 0.5) * noise)))
    }
  }
  return g
}

const near = (a, b, tol) => Math.hypot(a.x - b.x, a.y - b.y) <= tol

test("orderCorners puts any four points in top-left, top-right, bottom-right, bottom-left order", () => {
  const want = [
    { x: 10, y: 12 },
    { x: 90, y: 8 },
    { x: 95, y: 110 },
    { x: 6, y: 100 },
  ]
  for (const shuffled of [[2, 0, 3, 1], [3, 2, 1, 0], [1, 3, 0, 2]].map((o) => o.map((i) => want[i]))) assert.deepEqual(S.orderCorners(shuffled), want)
})

test("a straight page on a dark table is found within a couple of pixels", () => {
  const w = 200
  const h = 260
  const quad = [
    { x: 40, y: 30 },
    { x: 165, y: 30 },
    { x: 165, y: 225 },
    { x: 40, y: 225 },
  ]
  const r = S.detectCorners(photo(w, h, quad), w, h)
  assert.equal(r.found, true)
  r.corners.forEach((c, i) => assert.ok(near(c, quad[i], 3), `corner ${i}: ${JSON.stringify(c)} vs ${JSON.stringify(quad[i])}`))
})

test("a tilted page seen at an angle (a trapezoid) is found", () => {
  const w = 256
  const h = 192
  const quad = [
    { x: 70, y: 22 },
    { x: 196, y: 40 },
    { x: 220, y: 170 },
    { x: 30, y: 160 },
  ]
  const r = S.detectCorners(photo(w, h, quad, { noise: 16 }), w, h)
  assert.equal(r.found, true)
  r.corners.forEach((c, i) => assert.ok(near(c, quad[i], 4), `corner ${i}: ${JSON.stringify(c)} vs ${JSON.stringify(quad[i])}`))
})

test("a page turned 45 degrees is found (the corners aren't the extreme x+y points)", () => {
  const w = 240
  const h = 240
  const c = { x: 120, y: 120 }
  const quad = [0, 1, 2, 3].map((k) => ({ x: c.x + 85 * Math.cos((k * Math.PI) / 2 - Math.PI / 2), y: c.y + 85 * Math.sin((k * Math.PI) / 2 - Math.PI / 2) }))
  const r = S.detectCorners(photo(w, h, quad), w, h)
  assert.equal(r.found, true)
  for (const q of quad) assert.ok(r.corners.some((p) => near(p, q, 4)), `found a corner near ${JSON.stringify(q)}`)
})

test("nothing page-like (a plain wall) falls back to corners just inside the edges", () => {
  const w = 100
  const h = 80
  const flat = new Uint8Array(w * h).fill(128)
  const r = S.detectCorners(flat, w, h)
  assert.equal(r.found, false)
  assert.deepEqual(r.corners, S.defaultCorners(w, h))
  // a page bigger than the photo (bright everywhere but a strip) isn't trusted either
  const almost = photo(w, h, [
    { x: -5, y: -5 },
    { x: 105, y: -5 },
    { x: 105, y: 85 },
    { x: -5, y: 85 },
  ])
  assert.equal(S.detectCorners(almost, w, h).found, false)
})

test("plausibleQuad turns down slivers, crossed outlines and tiny ones", () => {
  const sq = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]
  assert.equal(S.plausibleQuad(sq, 120, 120), true)
  assert.equal(S.plausibleQuad([sq[0], sq[2], sq[1], sq[3]], 120, 120), false, "crossed")
  assert.equal(S.plausibleQuad(sq, 1000, 1000), false, "too small")
  const sliver = [
    { x: 0, y: 50 },
    { x: 100, y: 45 },
    { x: 100, y: 100 },
    { x: 95, y: 100 },
  ]
  assert.equal(S.plausibleQuad(sliver, 100, 100), false, "a corner sharper than 35 degrees")
})

test("the homography sends each corner exactly where asked, and back again", () => {
  const rect = [
    { x: 0, y: 0 },
    { x: 850, y: 0 },
    { x: 850, y: 1100 },
    { x: 0, y: 1100 },
  ]
  const quad = [
    { x: 120, y: 80 },
    { x: 900, y: 140 },
    { x: 980, y: 1300 },
    { x: 60, y: 1180 },
  ]
  const H = S.homography(rect, quad)
  const back = S.homography(quad, rect)
  rect.forEach((p, i) => {
    assert.ok(near(S.applyH(H, p.x, p.y), quad[i], 1e-6))
    assert.ok(near(S.applyH(back, quad[i].x, quad[i].y), p, 1e-6))
  })
  // the middle of the rectangle lands where the quad's diagonals cross (perspective, not the average)
  const mid = S.applyH(H, 425, 550)
  const cross = (a, b, c, d) => {
    const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x)
    const u = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den
    return { x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y) }
  }
  assert.ok(near(mid, cross(quad[0], quad[2], quad[1], quad[3]), 1e-6))
  assert.equal(S.homography([rect[0], rect[0], rect[0], rect[0]], quad), null, "degenerate")
})

test("straightening a photographed page gets the page's own picture back", () => {
  // a 160x120 color photo; the page (a quad) is red on its left half and blue on its right
  const w = 160
  const h = 120
  const quad = [
    { x: 30, y: 20 },
    { x: 130, y: 12 },
    { x: 140, y: 108 },
    { x: 22, y: 100 },
  ]
  const H = S.homography(
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    quad
  )
  const inv = S.homography(quad, [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ])
  void H
  const src = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      const u = S.applyH(inv, x + 0.5, y + 0.5)
      const onPage = u.x >= 0 && u.x <= 1 && u.y >= 0 && u.y <= 1
      src[p] = onPage && u.x < 0.5 ? 220 : 20
      src[p + 1] = 20
      src[p + 2] = onPage && u.x >= 0.5 ? 220 : 20
      src[p + 3] = 255
    }
  const out = S.warpPerspective(src, w, h, quad, 50, 40)
  const at = (x, y) => [...out.slice((y * 50 + x) * 4, (y * 50 + x) * 4 + 3)]
  // well inside each half: pure red / pure blue, never the table
  for (const [x, y] of [[5, 5], [20, 20], [10, 35]]) assert.ok(at(x, y)[0] > 180 && at(x, y)[2] < 60, `red at ${x},${y}: ${at(x, y)}`)
  for (const [x, y] of [[30, 5], [45, 20], [40, 35]]) assert.ok(at(x, y)[2] > 180 && at(x, y)[0] < 60, `blue at ${x},${y}: ${at(x, y)}`)
  assert.equal(out[3], 255)
})

test("output size: the longer opposite sides, snapped to Letter/A4 when close, fitted to the limit", () => {
  const letterish = [
    { x: 0, y: 0 },
    { x: 850, y: 10 },
    { x: 860, y: 1110 },
    { x: 5, y: 1090 },
  ]
  const a = S.outputSize(letterish, { maxSide: 4000 })
  assert.equal(a.paper, "letter")
  assert.ok(Math.abs(a.h / a.w - 11 / 8.5) < 0.01)
  const b = S.outputSize(letterish, { maxSide: 1100 })
  assert.equal(Math.max(b.w, b.h), 1100)
  const wide = [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 300 },
    { x: 0, y: 300 },
  ]
  const c = S.outputSize(wide, { maxSide: 5000 })
  assert.equal(c.paper, null, "a receipt-shaped strip isn't snapped")
  assert.deepEqual([c.w, c.h], [1000, 300])
  const a4landscape = [
    { x: 0, y: 0 },
    { x: 1414, y: 0 },
    { x: 1414, y: 1000 },
    { x: 0, y: 1000 },
  ]
  assert.equal(S.outputSize(a4landscape, { maxSide: 5000 }).paper, "a4")
})

test("rotating the photo a quarter turn keeps each corner on the same spot of the page", () => {
  const w = 300
  const h = 200
  const corners = [
    { x: 30, y: 20 },
    { x: 270, y: 25 },
    { x: 260, y: 180 },
    { x: 40, y: 170 },
  ]
  const turned = S.rotateCornersCW(corners, w, h)
  // the old bottom-left (40,170) is the new top-left at (h - 170, 40)
  assert.deepEqual(turned[0], { x: 30, y: 40 })
  assert.deepEqual(S.orderCorners(turned), turned, "still in order")
  // four turns come back to the start
  let q = corners
  let size = [w, h]
  for (let i = 0; i < 4; i++) {
    q = S.rotateCornersCW(q, size[0], size[1])
    size = [size[1], size[0]]
  }
  assert.deepEqual(q, corners)
})

test("Black & white keeps dark text and whitens a shadowed page", () => {
  const w = 120
  const h = 60
  const gray = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const light = 230 - x // a shadow across the page: 230 on the left, 111 on the right
      gray[y * w + x] = y >= 25 && y < 30 && x % 10 < 6 ? light - 90 : light
    }
  const bw = S.adaptiveThreshold(gray, w, h, { radius: 8, offset: 12 })
  // the paper is white everywhere, even in the shadow (a global cut would blacken it)
  assert.equal(bw[10 * w + 5], 255)
  assert.equal(bw[10 * w + 115], 255)
  // the text is black on both sides
  assert.equal(bw[27 * w + 2], 0)
  assert.equal(bw[27 * w + 112], 0)
  // Grayscale stretches: dull paper (180) comes out near white
  const rgba = new Uint8ClampedArray(100 * 4)
  for (let i = 0; i < 100; i++) rgba.set(i < 10 ? [40, 40, 40, 255] : [180, 178, 175, 255], i * 4)
  S.applyFilter(rgba, 10, 10, "gray")
  assert.ok(rgba[50 * 4] >= 250, `paper ${rgba[50 * 4]}`)
  assert.ok(rgba[0] <= 5)
  assert.equal(rgba[50 * 4], rgba[50 * 4 + 2], "gray: the channels match")
})

test("page helpers: names, moving pages, fitting", () => {
  assert.equal(S.scanName(new Date(2026, 9, 8, 14, 3, 9)), "Scan 2026-10-08 at 14.03.09")
  assert.deepEqual(S.movePage(["a", "b", "c"], 0, 1), ["b", "a", "c"])
  assert.deepEqual(S.movePage(["a", "b", "c"], 2, -1), ["a", "c", "b"])
  const same = ["a", "b"]
  assert.equal(S.movePage(same, 0, -1), same, "past the ends: unchanged")
  assert.deepEqual(S.fitInside(2000, 1000, 400, 400), { w: 400, h: 200, scale: 0.2 })
  assert.deepEqual(S.clampCorner({ x: -5, y: 900 }, 100, 800), { x: 0, y: 800 })
})
