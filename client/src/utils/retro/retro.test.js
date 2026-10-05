// node --test client/src/utils/retro/retro.test.js
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  BAYER4,
  BAYER8,
  FONT,
  UI_COLORS,
  WIN16,
  bayer,
  blit,
  createBitmap,
  createPalette,
  disc,
  drawLed,
  drawText,
  drawTitle,
  explosionFrames,
  fitPixels,
  flipped,
  gradientV,
  lfsrNoise,
  ledWidth,
  nearest,
  outlined,
  present,
  pulseTerms,
  rampAt,
  rect,
  remapTable,
  rotated,
  setClip,
  resetClip,
  sprite,
  steppedEnvelope,
  steppedSweep,
  textWidth,
  threshold,
  tint,
  vga256,
  wrapText,
} from "./index.js"

const count = (b, c) => b.data.reduce((n, v) => n + (v === c ? 1 : 0), 0)

test("palette: names, ramps, index 0 is clear, the lookup table packs ABGR", () => {
  const pal = createPalette([["red", "#ff0000"], ["blue", "#0000ff"]])
  assert.equal(pal.idx("clear"), 0)
  assert.equal(pal.idx("red"), 1)
  assert.equal(pal.add("red", "#123456"), 1, "adding a known name returns its index")
  const ramp = pal.ramp("g", ["#001000", "#008000", "#00ff00"])
  assert.deepEqual(ramp, [3, 4, 5])
  assert.equal(pal.hex(4), "#008000")
  assert.equal(pal.lut[0], 0, "clear is transparent")
  assert.equal(pal.lut[1], 0xff0000ff, "red as ABGR: alpha ff, blue 00, green 00, red ff")
  const flashed = pal.lutWith({ red: "#ffffff" })
  assert.equal(flashed[1], 0xffffffff)
  assert.equal(pal.lut[1], 0xff0000ff, "lutWith leaves the palette alone")
  assert.throws(() => pal.idx("nope"))
  const big = createPalette()
  for (let i = 0; i < 255; i++) big.add(`c${i}`, "#000000")
  assert.throws(() => big.add("one-too-many", "#ffffff"), /full/)
})

test("palette: quantize picks the nearest colour; remap tables tint through the palette", () => {
  const pal = createPalette(WIN16)
  assert.equal(pal.hex(nearest(pal, 250, 10, 10)), "#ff0000")
  assert.equal(pal.hex(nearest(pal, 120, 120, 130)), "#808080")
  assert.equal(pal.hex(nearest(pal, 10, 10, 120)), "#000080")
  const grey = remapTable(pal, tint.grey())
  const g = pal.rgb[grey[pal.idx("red")]]
  assert.ok(g[0] === g[1] && g[1] === g[2], "red goes to a grey")
  assert.equal(grey[0], 0, "clear stays clear")
  const v = vga256()
  assert.equal(v.length, 256)
  assert.deepEqual(v[0], [0, 0, 0])
  assert.deepEqual(v[15], [255, 255, 255])
  assert.deepEqual(v[4], [170, 0, 0], "EGA red")
  for (const c of v) assert.ok(c.every((x) => x >= 0 && x <= 255))
})

test("dither: Bayer matrices hold every threshold once and ramps dither between neighbours", () => {
  for (const n of [2, 4, 8]) {
    const m = bayer(n).flat()
    assert.deepEqual([...m].sort((a, b) => a - b), Array.from({ length: n * n }, (_, i) => i))
  }
  assert.deepEqual(bayer(2), [
    [0, 2],
    [3, 1],
  ])
  assert.equal(BAYER4.length, 16)
  assert.ok([...BAYER4].every((t) => t > 0 && t < 1))
  assert.equal(new Set(BAYER8).size, 64)
  // a 50% level lights exactly half of any 4 x 4 block
  let on = 0
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (0.5 > threshold(x, y)) on++
  assert.equal(on, 8)
  // ramps: the ends are exact, the middle mixes only the two nearest entries
  const ramp = [10, 20, 30]
  assert.equal(rampAt(ramp, 0, 0, 0), 10)
  assert.equal(rampAt(ramp, 1, 3, 2), 30)
  const mid = new Set()
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) mid.add(rampAt(ramp, 0.25, x, y))
  assert.deepEqual([...mid].sort(), [10, 20])
})

test("bitmap: shapes clip to the bitmap and the clip box; gradients dither", () => {
  const b = createBitmap(20, 10)
  rect(b, -5, -5, 10, 10, 1)
  assert.equal(count(b, 1), 25)
  disc(b, 10, 5, 3, 2)
  assert.ok(count(b, 2) > 20 && count(b, 2) < 36)
  setClip(b, 0, 0, 5, 10)
  rect(b, 0, 0, 20, 10, 3)
  resetClip(b)
  assert.equal(count(b, 3), 50)
  const g = createBitmap(8, 8)
  gradientV(g, 0, 0, 8, 8, [1, 2])
  assert.equal(new Set(g.data).size, 2)
  const row = (y) => [...g.data.slice(y * 8, y * 8 + 8)].filter((v) => v === 2).length
  const top = row(0) + row(1) + row(2) + row(3)
  const bottom = row(4) + row(5) + row(6) + row(7)
  assert.ok(row(0) <= 2 && row(6) >= 6, "dark at the top, light at the bottom")
  assert.ok(top < bottom, "lighter going down")
  assert.equal(top + bottom, 32, "a ramp over the whole box averages half and half")
  // present through a lookup table
  const pal = createPalette([["a", "#010203"]])
  const out = new Uint32Array(1)
  const one = createBitmap(1, 1)
  one.data[0] = 1
  present(one, out, pal.lut)
  assert.equal(out[0], 0xff030201)
})

test("sprites decode from strings, skip see-through pixels, flip, rotate and outline", () => {
  const s = sprite(["ab.", ".b."], { a: 1, b: 2 })
  assert.equal(s.w, 3)
  assert.equal(s.h, 2)
  assert.deepEqual([...s.data], [1, 2, 0, 0, 2, 0])
  assert.throws(() => sprite(["x"], {}), /no colour/)
  assert.deepEqual([...flipped(s).data], [0, 2, 1, 0, 2, 0])
  const r = rotated(s, 1)
  assert.equal(r.w, 2)
  assert.equal(r.h, 3)
  assert.deepEqual([...rotated(s, 4).data], [...s.data])
  const o = outlined(sprite(["a"], { a: 1 }), 9)
  assert.deepEqual([...o.data], [0, 9, 0, 9, 1, 9, 0, 9, 0])
  const b = createBitmap(4, 4)
  b.data.fill(5)
  blit(b, s, 1, 1)
  assert.equal(b.data[1 * 4 + 1], 1)
  assert.equal(b.data[1 * 4 + 3], 5, "index 0 leaves the background")
  blit(b, s, 1, 1, { map: new Uint8Array(256).fill(7) })
  assert.equal(b.data[1 * 4 + 1], 7)
})

test("font: every glyph fits the cell, digits share one width, text measures and wraps", () => {
  for (const [ch, g] of Object.entries(FONT.glyphs)) {
    assert.ok(g.h === 7 || g.h === 8 || g.h === 9, `glyph ${ch} height ${g.h}`)
    assert.ok(g.w >= 1 && g.w <= 5, `glyph ${ch} width ${g.w}`)
  }
  for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?.,:-+/()") assert.ok(FONT.glyphs[c], `missing ${c}`)
  const widths = new Set("0123456789".split("").map((d) => FONT.glyphs[d].w))
  assert.deepEqual([...widths], [5], "digits are all 5 wide")
  assert.equal(textWidth("A"), 5)
  assert.equal(textWidth("AB"), 11)
  assert.equal(textWidth("AB", { scale: 2 }), 22)
  assert.equal(textWidth(""), 0)
  assert.equal(textWidth("☃"), textWidth("?"), "unknown characters draw as ?")
  const lines = wrapText("the quick brown fox jumps over the lazy dog", 40)
  assert.ok(lines.length > 2)
  for (const l of lines) assert.ok(textWidth(l) <= 40, l)
  // drawing puts ink inside the measured box only
  const b = createBitmap(40, 12)
  const w = drawText(b, "Hi!", 2, 1, 3)
  for (let y = 0; y < 12; y++) for (let x = 0; x < 40; x++) if (b.data[y * 40 + x]) assert.ok(x >= 2 && x < 2 + w && y >= 1 && y < 10)
  const t = createBitmap(60, 30)
  drawTitle(t, "OK", 4, 4, { scale: 2, ramp: [5, 6], outline: 1, shadow: 2 })
  assert.ok(count(t, 1) > 0 && count(t, 2) > 0 && count(t, 5) + count(t, 6) > 20)
})

test("LED digits: seven segments, the 8 lights them all", () => {
  const b = createBitmap(30, 15)
  drawLed(b, "8", 0, 0, { on: 1, off: 2, digitW: 7, digitH: 11 })
  const lit = count(b, 1)
  assert.equal(count(b, 2), 0, "an 8 has no unlit segments")
  const c = createBitmap(30, 15)
  drawLed(c, "1", 0, 0, { on: 1, off: 2, digitW: 7, digitH: 11 })
  assert.ok(count(c, 1) < lit / 2 && count(c, 2) > 0)
  assert.equal(ledWidth("12", { digitW: 7 }), 16)
  assert.equal(ledWidth("1:2", { digitW: 7 }), 21)
})

test("explosions: eight frames that grow, then thin out", () => {
  const frames = explosionFrames({ size: 32, frames: 8, fire: [1, 2, 3, 4], smoke: [5, 6] })
  assert.equal(frames.length, 8)
  const ink = frames.map((f) => f.data.reduce((n, v) => n + (v ? 1 : 0), 0))
  assert.ok(ink[2] > ink[0], "it swells after the flash")
  assert.ok(ink[7] < Math.max(...ink), "it fades at the end")
  assert.ok(frames.every((f) => f.w === 32 && f.h === 32))
})

test("fitPixels: whole device pixels per game pixel, at least the asked-for screen", () => {
  // an iPhone: 390 x 700 CSS, 3x
  const f = fitPixels({ w: 390, h: 700, dpr: 3, minW: 192, minH: 300 })
  assert.equal(f.k, 6)
  assert.equal(f.w, 195)
  assert.equal(f.h, 350)
  assert.equal(f.css, 2)
  assert.ok(f.w >= 192 && f.h >= 300)
  // a desktop window
  const d = fitPixels({ w: 640, h: 420, dpr: 1, minW: 256, minH: 180 })
  assert.equal(d.k, 2)
  assert.equal(d.w, 320)
  assert.equal(d.h, 210)
  // a fractional DPR still uses whole device pixels
  const a = fitPixels({ w: 412, h: 800, dpr: 2.625, minW: 192, minH: 300 })
  assert.equal(a.k, 5)
  assert.ok(Math.abs(a.css * 2.625 - 5) < 1e-9)
  // too small: never below one pixel
  assert.equal(fitPixels({ w: 50, h: 50, dpr: 1, minW: 192, minH: 300 }).k, 1)
})

test("chip sound maths: pulse terms, stepped envelopes and sweeps, LFSR noise", () => {
  const { real, imag } = pulseTerms(0.5, 8)
  assert.equal(real.length, 9)
  assert.ok(Math.abs(real[2]) < 1e-9 && Math.abs(imag[2]) < 1e-9, "a 50% square has no even harmonics")
  assert.ok(imag[1] > 1)
  const env = steppedEnvelope(0.5, 0.3)
  assert.equal(env.length, 31)
  assert.equal(env[0].v, 0.3)
  assert.equal(env[env.length - 1].v, 0)
  for (let k = 1; k < env.length; k++) assert.ok(env[k].v <= env[k - 1].v + 1e-12, "it only falls")
  for (const e of env) assert.ok(Number.isInteger(Math.round((e.v / 0.3) * 15 * 1e6) / 1e6), "16 volume levels")
  const sw = steppedSweep(0.1, 220, 880)
  assert.equal(sw[0].f, 220)
  assert.ok(Math.abs(sw[sw.length - 1].f - 880) < 1e-6)
  const n = lfsrNoise(4096, { rate: 44100, clock: 44100 })
  assert.ok(n.every((v) => v === 1 || v === -1))
  const ones = n.reduce((s, v) => s + (v > 0 ? 1 : 0), 0)
  assert.ok(ones > 1500 && ones < 2600, "about half and half")
  const short = lfsrNoise(4096, { rate: 44100, clock: 44100, short: true })
  assert.notDeepEqual([...short.slice(0, 200)], [...n.slice(0, 200)])
})

test("every game palette fits in 256 colours and carries the shared UI colours", async () => {
  const games = ["boomfrenzy", "colormatch", "echo", "zapit", "tetherball"]
  for (const g of games) {
    const { pal } = await import(`../../components/applets/${g}/pixels.js`)
    assert.ok(pal.size <= 256, `${g}: ${pal.size} colours`)
    for (const [name] of UI_COLORS) assert.ok(pal.has(name), `${g} lacks ${name}`)
  }
})
