// Unit Converter: node --test client/src/components/applets/units/units.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { CATEGORIES, convert, pretty, parseNumber } from "./units.js"

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} != ${b}`)

test("known conversions", () => {
  near(convert("length", "in", "cm", 1), 2.54)
  near(convert("length", "mi", "km", 1), 1.609344)
  near(convert("length", "ft", "m", 10), 3.048)
  near(convert("weight", "lb", "kg", 1), 0.45359237)
  near(convert("weight", "st", "lb", 1), 14)
  near(convert("temperature", "f", "c", 212), 100)
  near(convert("temperature", "c", "f", -40), -40)
  near(convert("temperature", "k", "c", 0), -273.15)
  near(convert("volume", "gal", "l", 1), 3.785411784)
  near(convert("volume", "cup", "tbsp", 1), 16)
  near(convert("volume", "tbsp", "tsp", 1), 3)
  near(convert("area", "ac", "ft2", 1), 43560)
  near(convert("speed", "mph", "kph", 60), 96.56064)
  near(convert("time", "d", "h", 2), 48)
  near(convert("data", "gib", "mib", 1), 1024)
})

test("every unit goes there and back", () => {
  for (const cat of CATEGORIES)
    for (const a of cat.units)
      for (const b of cat.units) near(convert(cat.id, b.id, a.id, convert(cat.id, a.id, b.id, 123.456)), 123.456, 1e-9)
})

test("numbers in and out", () => {
  assert.equal(parseNumber("1,234.5"), 1234.5)
  assert.equal(parseNumber("-3"), -3)
  assert.equal(parseNumber("2.5e3"), 2500)
  assert.equal(parseNumber("abc"), null)
  assert.equal(parseNumber(""), null)
  assert.equal(pretty(0.1 + 0.2), "0.3")
  assert.equal(pretty(1234567.891), "1,234,567.891")
  assert.equal(pretty(1e-9), "1e-9")
})
