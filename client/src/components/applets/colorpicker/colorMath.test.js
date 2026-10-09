// Color Picker: node --test client/src/components/applets/colorpicker/colorMath.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { parseHex, toHex, rgbToHsl, hslToRgb, rgbToHsv, hsvToRgb, hslText, textOn } from "./colorMath.js"

test("hex", () => {
  assert.deepEqual(parseHex("#ff8000"), { r: 255, g: 128, b: 0 })
  assert.deepEqual(parseHex("0F0"), { r: 0, g: 255, b: 0 })
  assert.equal(parseHex("#12345"), null)
  assert.equal(parseHex("zzz"), null)
  assert.equal(toHex({ r: 255, g: 128, b: 0 }), "#FF8000")
  assert.equal(toHex({ r: 300, g: -5, b: 10.4 }), "#FF000A")
})

test("HSL and HSV both ways", () => {
  assert.deepEqual(rgbToHsl({ r: 255, g: 0, b: 0 }), { h: 0, s: 100, l: 50 })
  assert.deepEqual(rgbToHsl({ r: 0, g: 128, b: 128 }), { h: 180, s: 100, l: 25 })
  assert.deepEqual(rgbToHsl({ r: 192, g: 192, b: 192 }), { h: 0, s: 0, l: 75 })
  assert.deepEqual(hslToRgb({ h: 120, s: 100, l: 50 }), { r: 0, g: 255, b: 0 })
  assert.equal(hslText({ r: 0, g: 0, b: 128 }), "hsl(240, 100%, 25%)")
  for (const hex of ["#000000", "#FFFFFF", "#123456", "#FF8000", "#C0C0C0", "#00FF80", "#804040", "#9A1BE3"]) {
    const rgb = parseHex(hex)
    assert.equal(toHex(hsvToRgb(rgbToHsv(rgb))), hex, `HSV ${hex}`)
    const back = hslToRgb(rgbToHsl(rgb))
    for (const c of ["r", "g", "b"]) assert.ok(Math.abs(back[c] - rgb[c]) <= 3, `HSL ${hex} ${c}`)
  }
})

test("readable text color", () => {
  assert.equal(textOn({ r: 255, g: 255, b: 0 }), "#000000")
  assert.equal(textOn({ r: 0, g: 0, b: 128 }), "#FFFFFF")
})
