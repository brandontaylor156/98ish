// Camera tests: the retro effects on pixels, and what the camera tells you when it can't
// start. Run: node --test client/src/components/applets/camera/camera.test.js
import test from "node:test"
import assert from "node:assert/strict"
import * as F from "./effects.js"
import * as S from "./support.js"

// a w x h picture filled by fn(x, y) -> [r, g, b]
const picture = (w, h, fn) => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const [r, g, b] = fn(x, y)
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  return { data, width: w, height: h }
}
const at = (img, x, y) => {
  const i = (y * img.width + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]
}
const gradientPic = (w = 48, h = 36) => picture(w, h, (x, y) => [(x * 255) / (w - 1), (y * 255) / (h - 1), 128])
const colorsIn = (img) => {
  const set = new Set()
  for (let i = 0; i < img.data.length; i += 4) set.add(`${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`)
  return set
}

test("every effect has a unique id and a label, and Normal changes nothing", () => {
  const ids = F.EFFECTS.map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(F.EFFECTS.every((e) => e.label))
  const img = gradientPic()
  const before = new Uint8ClampedArray(img.data)
  F.applyEffect("none", img)
  F.applyEffect("no-such-effect", img)
  assert.deepEqual(img.data, before)
  assert.equal(F.effectLabel("crt"), "CRT Monitor")
  assert.equal(F.effectLabel("nope"), "Normal")
})

test("every effect keeps the size and leaves alpha alone", () => {
  for (const { id } of F.EFFECTS) {
    const img = gradientPic(40, 30)
    F.applyEffect(id, img, { t: 5 })
    assert.equal(img.data.length, 40 * 30 * 4, id)
    for (let i = 3; i < img.data.length; i += 4) assert.equal(img.data[i], 255, `${id} alpha`)
  }
})

test("black and white makes gray; sepia makes warm tones; negative inverts", () => {
  const mono = F.applyEffect("mono", gradientPic())
  for (let i = 0; i < mono.data.length; i += 4) {
    assert.equal(mono.data[i], mono.data[i + 1])
    assert.equal(mono.data[i + 1], mono.data[i + 2])
  }
  const sepia = F.applyEffect("sepia", picture(4, 4, () => [100, 100, 100]))
  const [r, g, b] = at(sepia, 1, 1)
  assert.ok(r > g && g > b, "sepia is reddish brown")
  const neg = F.applyEffect("negative", picture(2, 2, () => [10, 200, 255]))
  assert.deepEqual(at(neg, 0, 0).slice(0, 3), [245, 55, 0])
})

test("Web Safe 216 only uses the 216 web-safe colors", () => {
  const img = F.applyEffect("websafe", gradientPic(64, 48), { scale: 1 })
  for (const c of colorsIn(img)) for (const v of c.split(",").map(Number)) assert.ok(F.WEB_SAFE_LEVELS.includes(v), `${v} isn't web safe`)
  // dithering mixes neighbors, so a smooth gradient uses several of them
  assert.ok(colorsIn(img).size > 6)
})

test("Handheld uses only its four greens, in chunky pixels", () => {
  const img = F.applyEffect("handheld", gradientPic(64, 48), { scale: 1 })
  const allowed = new Set(F.HANDHELD.map((c) => c.join(",")))
  for (const c of colorsIn(img)) assert.ok(allowed.has(c), c)
  // 3-pixel cells: each 3x3 block is one color
  for (let by = 0; by + 3 <= 48; by += 3)
    for (let bx = 0; bx + 3 <= 63; bx += 3) {
      const first = at(img, bx, by).join()
      for (let y = by; y < by + 3; y++) for (let x = bx; x < bx + 3; x++) assert.equal(at(img, x, y).join(), first)
    }
})

test("ordered dithering: thresholds are centered and quantize hits exact levels", () => {
  let sum = 0
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) sum += F.bayerAt(x, y)
  assert.ok(Math.abs(sum) < 1e-9)
  assert.equal(F.quantize(0, 6), 0)
  assert.equal(F.quantize(255, 6), 255)
  assert.equal(F.quantize(100, 6), 102)
  assert.equal(F.quantize(100, 6, -0.5), 51)
  assert.equal(F.quantize(300, 6, 0.4), 255)
})

test("Pixelate turns blocks into one average color", () => {
  const img = F.applyEffect("pixel", picture(20, 20, (x) => (x % 2 ? [0, 0, 0] : [200, 100, 50])), { scale: 0.4 })
  // block 4 at this scale: every pixel of the first block is the average
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) assert.deepEqual(at(img, x, y).slice(0, 3), [100, 50, 25])
})

test("CRT darkens every third row (the scanlines) and the corners", () => {
  const img = F.applyEffect("crt", picture(60, 60, () => [150, 150, 150]), { scale: 1 })
  const row = (y) => at(img, 30, y)[1]
  assert.ok(row(2) < row(1) * 0.6, "a scanline")
  assert.ok(row(5) < row(4) * 0.6, "the next scanline, 3 rows on")
  assert.ok(at(img, 0, 0)[1] < at(img, 30, 31)[1], "dark corners")
})

test("VHS is the same for the same frame and moves between frames", () => {
  const a = F.applyEffect("vhs", gradientPic(), { t: 3 })
  const b = F.applyEffect("vhs", gradientPic(), { t: 3 })
  const c = F.applyEffect("vhs", gradientPic(), { t: 4 })
  assert.deepEqual(a.data, b.data)
  assert.notDeepEqual(a.data, c.data)
})

test("Mirror reflects the left half onto the right", () => {
  const img = F.applyEffect("mirror", picture(10, 3, (x) => [x * 20, 0, 0]))
  for (let x = 0; x < 10; x++) assert.equal(at(img, x, 1)[0], Math.min(x, 9 - x) * 20)
})

test("Fisheye magnifies the middle and leaves the corners", () => {
  // the source point for a pixel near the middle is closer to the middle
  const [sx, sy] = F.bulgeSource(60, 50, 50, 50, 40)
  assert.ok(sx > 50 && sx < 60)
  assert.equal(sy, 50)
  assert.deepEqual(F.bulgeSource(0, 0, 50, 50, 40), [0, 0])
  assert.deepEqual(F.bulgeSource(50, 50, 50, 50, 40), [50, 50])
  const img = F.applyEffect("fisheye", gradientPic(41, 41))
  assert.deepEqual(at(img, 0, 0), at(gradientPic(41, 41), 0, 0))
})

test("Heat Vision maps dark to black and bright to white", () => {
  const img = F.applyEffect("thermal", picture(2, 1, (x) => (x ? [255, 255, 255] : [0, 0, 0])))
  assert.deepEqual(at(img, 0, 0).slice(0, 3), [0, 0, 0])
  assert.deepEqual(at(img, 1, 0).slice(0, 3), [255, 255, 255])
})

test("brightness and contrast match the CSS filter preview", () => {
  const same = F.adjustPixels(picture(1, 1, () => [10, 128, 240]), {})
  assert.deepEqual(at(same, 0, 0).slice(0, 3), [10, 128, 240])
  const brighter = F.adjustPixels(picture(1, 1, () => [100, 100, 100]), { brightness: 50 })
  assert.equal(at(brighter, 0, 0)[0], 150)
  const flat = F.adjustPixels(picture(1, 1, () => [0, 255, 60]), { contrast: -100 })
  assert.deepEqual(at(flat, 0, 0).slice(0, 3), [128, 128, 128])
  const punchy = F.adjustPixels(picture(1, 1, () => [100, 160, 128]), { contrast: 100 })
  assert.deepEqual(at(punchy, 0, 0).slice(0, 3), [72, 192, 128])
  assert.equal(F.adjustFilterCss({ brightness: 20, contrast: -50 }), "brightness(1.2) contrast(0.5)")
})

test("the camera explains why it can't start", () => {
  assert.match(S.cameraProblem({ secure: false }).title, /secure/)
  assert.equal(S.cameraProblem({ secure: false }).retry, false)
  assert.match(S.cameraProblem({ hasMedia: false }).text, /doesn't let web pages use a camera/)
  const denied = S.cameraProblem({ iphone: true }, { name: "NotAllowedError" })
  assert.match(denied.title, /blocked/)
  assert.match(denied.text, /Safari/)
  assert.equal(denied.retry, true)
  assert.match(S.cameraProblem({}, { name: "NotAllowedError" }).text, /address bar/)
  assert.match(S.cameraProblem({}, { name: "NotFoundError" }).title, /No camera/)
  assert.match(S.cameraProblem({}, { name: "NotReadableError" }).title, /busy/)
  assert.match(S.cameraProblem({}, { name: "Weird", message: "boom" }).text, /boom/)
})

test("clips are recorded as MP4 where possible (iPhone), else WebM", () => {
  assert.equal(S.pickClipType((t) => t === "video/mp4"), "video/mp4")
  assert.equal(S.pickClipType((t) => t.startsWith("video/webm")), "video/webm;codecs=vp9,opus")
  assert.equal(S.pickClipType(() => false), "")
  assert.equal(S.pickClipType(undefined), "")
  assert.equal(
    S.pickClipType(() => {
      throw new Error("no")
    }),
    ""
  )
  assert.equal(S.clipExtension("video/mp4;codecs=avc1"), ".mp4")
  assert.equal(S.clipExtension("video/webm"), ".webm")
  assert.equal(S.clipExtension(""), ".webm")
})

test("timer, modes, devices and the clock", () => {
  assert.equal(S.nextTimer(0), 3)
  assert.equal(S.nextTimer(3), 10)
  assert.equal(S.nextTimer(10), 0)
  assert.deepEqual(
    S.MODES.map((m) => m.id),
    ["photo", "burst", "strip", "video"]
  )
  assert.equal(S.isAppleMobile("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), true)
  assert.equal(S.isAppleMobile("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5), true)
  assert.equal(S.isAppleMobile("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0), false)
  assert.equal(S.isAppleMobile("Mozilla/5.0 (Windows NT 10.0)"), false)
  assert.equal(S.clockText(0), "0:00")
  assert.equal(S.clockText(65.4), "1:05")
})
