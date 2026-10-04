// Photos tests: photo names, fitting JPEGs into the drive, and the viewer's zoom, pan, crop,
// rotation and swipe math. Run: node --test client/src/components/applets/photos/photos.test.js
import test from "node:test"
import assert from "node:assert/strict"
import * as M from "./photoMath.js"

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

test("photo names count up from the highest number", () => {
  assert.equal(M.nextPhotoName([]), "PHOTO001.JPG")
  assert.equal(M.nextPhotoName(["PHOTO001.JPG", "PHOTO002.JPG"]), "PHOTO003.JPG")
  assert.equal(M.nextPhotoName(["photo007.jpg", "PHOTO002.JPG", "Notes"]), "PHOTO008.JPG")
  assert.equal(M.nextPhotoName(["STRIP001.JPG", "PHOTO004.JPG"], "STRIP"), "STRIP002.JPG")
  assert.equal(M.nextPhotoName(["PHOTO999.JPG"]), "PHOTO1000.JPG")
  assert.equal(M.photoNumber("BURST012.JPG", "BURST"), 12)
  assert.equal(M.photoNumber("BURST012 (2).JPG", "BURST"), 0)
  assert.equal(M.photoNumber("PHOTO5", "PHOTO"), 5)
})

test("uploads and edited copies get sensible names", () => {
  assert.equal(M.uploadName("IMG_1234.HEIC"), "IMG_1234.JPG")
  assert.equal(M.uploadName("beach day.jpeg"), "beach day.JPG")
  assert.equal(M.uploadName('a:b/c"d.png'), "a_b_c_d.JPG")
  assert.equal(M.uploadName(""), "Photo.JPG")
  assert.equal(M.uploadName("x".repeat(100) + ".png").length, 60)
  assert.equal(M.editedName("PHOTO001.JPG"), "PHOTO001 (edited).JPG")
  assert.equal(M.editedName("Sunset"), "Sunset (edited)")
  assert.equal(M.isHeic({ name: "IMG_1.HEIC" }), true)
  assert.equal(M.isHeic({ name: "x", type: "image/heif" }), true)
  assert.equal(M.isHeic({ name: "a.jpg", type: "image/jpeg" }), false)
})

test("fitEncode lowers the quality, then the size, until it fits", () => {
  // a fake encoder: the size grows with quality and area
  const calls = []
  const encode = (q, s) => {
    calls.push([q, s])
    return "x".repeat(Math.round(1000 * q * s * s))
  }
  const easy = M.fitEncode(encode, { maxChars: 10_000 })
  assert.equal(easy.quality, 0.86)
  assert.equal(calls.length, 1)
  calls.length = 0
  const hard = M.fitEncode(encode, { maxChars: 300 })
  assert.ok(hard.data.length <= 300)
  assert.ok(hard.quality < 0.7 && hard.scale < 1)
  // quality first: the size only starts shrinking at the lowest quality
  const firstShrink = calls.findIndex(([, s]) => s < 1)
  assert.ok(calls.slice(0, firstShrink).every(([, s]) => s === 1))
  assert.ok(close(calls[firstShrink - 1][0], hard.quality))
  // something that never fits stops, with the smallest try
  const never = M.fitEncode(() => "x".repeat(5000), { maxChars: 10 })
  assert.equal(never.data.length, 5000)
})

test("fitScale keeps the longest side within the limit and never enlarges", () => {
  assert.equal(M.fitScale(2560, 1920), 0.5)
  assert.equal(M.fitScale(1920, 2560), 0.5)
  assert.equal(M.fitScale(640, 480), 1)
  assert.equal(M.fitScale(1000, 100, 500), 0.5)
})

test("data URL sizes and kinds", () => {
  assert.equal(M.dataBytes("data:image/png;base64,AAAA"), 3)
  assert.equal(M.dataBytes("data:image/png;base64,AAA="), 2)
  assert.equal(M.dataBytes("data:image/png;base64,AA=="), 1)
  assert.equal(M.dataBytes("nonsense"), 0)
  assert.equal(M.kindOf("data:image/jpeg;base64,xx"), "JPEG Image")
  assert.equal(M.kindOf("data:image/png;base64,xx"), "PNG Image")
  assert.equal(M.kindOf(""), "Picture")
})

test("fitView centers the whole picture and doesn't blow up small ones", () => {
  const v = M.fitView(1000, 500, 400, 400)
  assert.equal(v.scale, 0.4)
  assert.equal(v.x, 0)
  assert.equal(v.y, 100)
  const small = M.fitView(100, 50, 400, 400)
  assert.equal(small.scale, 1)
  assert.deepEqual([small.x, small.y], [150, 175])
})

test("zooming keeps the point under the finger in place", () => {
  const v = { scale: 1, x: 10, y: 20 }
  const z = M.zoomAt(v, 2, 110, 120)
  // image point (100, 100) was at (110, 120) and still is
  assert.equal(z.x + 100 * z.scale, 110)
  assert.equal(z.y + 100 * z.scale, 120)
})

test("panning stops at the edges; a picture smaller than the area stays centered", () => {
  const box = [400, 300]
  const big = M.clampView({ scale: 2, x: 50, y: -5000 }, 400, 300, ...box)
  assert.equal(big.x, 0)
  assert.equal(big.y, -300)
  const right = M.clampView({ scale: 2, x: -9999, y: 0 }, 400, 300, ...box)
  assert.equal(right.x, -400)
  const small = M.clampView({ scale: 0.5, x: 999, y: -999 }, 400, 300, ...box)
  assert.deepEqual([small.x, small.y], [100, 75])
})

test("zoom limits: from the fitted size up to 8x", () => {
  assert.equal(M.clampScale(0.01, 0.3), 0.3)
  assert.equal(M.clampScale(100, 0.3), 8)
  assert.equal(M.clampScale(2, 0.3), 2)
  // a small picture shown at 100% can't zoom out below 100%
  assert.equal(M.clampScale(0.5, 1), 1)
  assert.equal(M.clampScale(30, 5), 10)
})

test("swipes: far enough, sideways enough and quick enough", () => {
  assert.equal(M.swipeDirection(-80, 10), 1) // to the left: the next picture
  assert.equal(M.swipeDirection(80, -10), -1)
  assert.equal(M.swipeDirection(30, 0), 0) // too short
  assert.equal(M.swipeDirection(80, 90), 0) // mostly up and down
  assert.equal(M.swipeDirection(-200, 0, { ms: 2000 }), 0) // a slow drag isn't a swipe
})

test("the first crop box is the biggest centered box of the shape", () => {
  assert.deepEqual(M.initialCrop(800, 600), { x: 0, y: 0, w: 800, h: 600 })
  assert.deepEqual(M.initialCrop(800, 600, 1), { x: 100, y: 0, w: 600, h: 600 })
  const wide = M.initialCrop(800, 600, 16 / 9)
  assert.equal(wide.w, 800)
  assert.ok(close(wide.h, 450))
  assert.ok(close(wide.y, 75))
  const tall = M.initialCrop(800, 600, 3 / 4)
  assert.ok(close(tall.h, 600) && close(tall.w, 450) && close(tall.x, 175))
})

test("moving the crop box keeps it inside the picture", () => {
  const r = { x: 100, y: 100, w: 200, h: 100 }
  assert.deepEqual(M.moveCrop(r, 50, -20, 800, 600), { x: 150, y: 80, w: 200, h: 100 })
  assert.deepEqual(M.moveCrop(r, -500, 900, 800, 600), { x: 0, y: 500, w: 200, h: 100 })
})

test("free crop handles move their own edges, inside the picture, never too small", () => {
  const r = { x: 100, y: 100, w: 200, h: 100 }
  assert.deepEqual(M.resizeCrop(r, "se", 50, 30, 800, 600), { x: 100, y: 100, w: 250, h: 130 })
  assert.deepEqual(M.resizeCrop(r, "nw", -150, -150, 800, 600), { x: 0, y: 0, w: 300, h: 200 })
  assert.deepEqual(M.resizeCrop(r, "e", 9999, 0, 800, 600), { x: 100, y: 100, w: 700, h: 100 })
  assert.deepEqual(M.resizeCrop(r, "w", 500, 0, 800, 600, null, 16), { x: 284, y: 100, w: 16, h: 100 })
  assert.deepEqual(M.resizeCrop(r, "n", 0, 20, 800, 600), { x: 100, y: 120, w: 200, h: 80 })
})

test("fixed-shape crop handles keep the shape and fit inside", () => {
  const sq = { x: 100, y: 100, w: 200, h: 200 }
  const a = M.resizeCrop(sq, "se", 100, 0, 800, 600, 1)
  assert.deepEqual(a, { x: 100, y: 100, w: 300, h: 300 })
  // dragging far past the bottom: the square stops at the picture's edge
  const b = M.resizeCrop(sq, "se", 2000, 2000, 800, 600, 1)
  assert.ok(close(b.w, b.h))
  assert.ok(b.y + b.h <= 600 + 1e-9 && b.x + b.w <= 800 + 1e-9)
  assert.ok(close(b.h, 500))
  // the top-left handle anchors the bottom-right corner
  const c = M.resizeCrop(sq, "nw", -50, -50, 800, 600, 4 / 3)
  assert.ok(close(c.x + c.w, 300) && close(c.y + c.h, 300))
  assert.ok(close(c.w / c.h, 4 / 3))
  assert.ok(c.x >= 0 && c.y >= 0)
  // the bottom edge handle leads with the height and stays centered sideways
  const d = M.resizeCrop(sq, "s", 0, 40, 800, 600, 1)
  assert.ok(close(d.w, 240) && close(d.h, 240) && close(d.x + d.w / 2, 200))
})

test("roundCrop makes whole pixels inside the picture", () => {
  assert.deepEqual(M.roundCrop({ x: -3.2, y: 10.6, w: 100.4, h: 999 }, 640, 480), { x: 0, y: 11, w: 100, h: 469 })
  assert.deepEqual(M.roundCrop({ x: 700, y: 0, w: 10, h: 10 }, 640, 480), { x: 639, y: 0, w: 1, h: 10 })
})

test("rotation: sizes swap on quarter turns and corners land in the right place", () => {
  assert.deepEqual(M.rotatedSize(800, 600, 1), { width: 600, height: 800 })
  assert.deepEqual(M.rotatedSize(800, 600, 2), { width: 800, height: 600 })
  assert.deepEqual(M.rotatedSize(800, 600, -1), { width: 600, height: 800 })
  assert.equal(M.turnsOf(-1), 3)
  assert.equal(M.turnsOf(5), 1)
  const w = 800
  const h = 600
  // clockwise: the top-left corner goes to the top-right
  assert.deepEqual(M.applyMatrix(M.rotationMatrix(1, w, h), 0, 0), [600, 0])
  assert.deepEqual(M.applyMatrix(M.rotationMatrix(1, w, h), 0, h), [0, 0])
  assert.deepEqual(M.applyMatrix(M.rotationMatrix(1, w, h), w, h), [0, 800])
  assert.deepEqual(M.applyMatrix(M.rotationMatrix(2, w, h), 0, 0), [800, 600])
  // counterclockwise (three turns): the top-left corner goes to the bottom-left
  assert.deepEqual(M.applyMatrix(M.rotationMatrix(3, w, h), 0, 0), [0, 800])
  assert.deepEqual(M.applyMatrix(M.rotationMatrix(3, w, h), w, 0), [0, 0])
  assert.deepEqual(M.rotationMatrix(0, w, h), [1, 0, 0, 1, 0, 0])
  // every corner stays inside the turned canvas
  for (const turns of [0, 1, 2, 3]) {
    const size = M.rotatedSize(w, h, turns)
    for (const [x, y] of [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ]) {
      const [X, Y] = M.applyMatrix(M.rotationMatrix(turns, w, h), x, y)
      assert.ok(X >= 0 && X <= size.width && Y >= 0 && Y <= size.height, `turns ${turns}`)
    }
  }
})

test("the photo strip stacks four shots with a caption below", () => {
  const s = M.stripLayout(480, 360, 4)
  assert.equal(s.slots.length, 4)
  assert.equal(s.width, 480 + 2 * s.slots[0].x)
  for (let i = 1; i < 4; i++) assert.ok(s.slots[i].y > s.slots[i - 1].y + 360 - 1)
  assert.equal(s.caption.y + s.caption.h, s.height)
  assert.ok(s.slots[3].y + 360 <= s.caption.y)
})
