// Accessibility Options and Regional Settings: settings migration, the contrast schemes,
// what <html> gets, and the time/date formats. Run: node --test client/src/utils/a11y.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { CONTRAST_SCHEMES, a11yRoot, contrastVars, migrateSettings, resolveReducedMotion, textScale, titleHeight } from "./a11y.js"
import { formatHour, formatShortDate, formatShortTime, formatTime, localeWeekStart, setRegionPrefs, uses24h, weekStart, weekdayOrder } from "./region.js"

const DEFAULTS = {
  wallpaper: "default",
  textSize: "normal",
  contrast: "off",
  reduceMotion: "system",
  tapTargets: "normal",
  doubleClickMs: 500,
  longPressMs: 500,
  magZoom: 2,
  hiddenDesktop: [],
  hiddenStart: [],
  region: { locale: "auto", time: "auto", firstDay: "auto", dateOrder: "auto" },
  ieHome: "",
}

// ---- migration ----

test("migrateSettings: nothing saved (or junk) gives the defaults", () => {
  assert.deepEqual(migrateSettings(null, DEFAULTS), DEFAULTS)
  assert.deepEqual(migrateSettings("x", DEFAULTS), DEFAULTS)
  assert.deepEqual(migrateSettings([1, 2], DEFAULTS), DEFAULTS)
})

test("migrateSettings: settings saved before Accessibility Options keep everything", () => {
  const old = { wallpaper: "bricks", scheme: "rainy", volume: 40, keyboard: "phone" }
  const s = migrateSettings(old, DEFAULTS)
  assert.equal(s.wallpaper, "bricks")
  assert.equal(s.scheme, "rainy", "unknown keys are kept")
  assert.equal(s.volume, 40)
  assert.equal(s.textSize, "normal")
  assert.equal(s.contrast, "off")
  assert.equal(s.reduceMotion, "system")
  assert.deepEqual(s.region, DEFAULTS.region)
})

test("migrateSettings: older shapes are upgraded", () => {
  assert.equal(migrateSettings({ highContrast: true }, DEFAULTS).contrast, "black")
  assert.equal(migrateSettings({ highContrast: false }, DEFAULTS).contrast, "off")
  assert.equal("highContrast" in migrateSettings({ highContrast: true }, DEFAULTS), false)
  assert.equal(migrateSettings({ textSize: 1.25 }, DEFAULTS).textSize, "large")
  assert.equal(migrateSettings({ textSize: 1.5 }, DEFAULTS).textSize, "xlarge")
  assert.equal(migrateSettings({ textSize: 1 }, DEFAULTS).textSize, "normal")
  assert.equal(migrateSettings({ reduceMotion: true }, DEFAULTS).reduceMotion, "on")
  assert.equal(migrateSettings({ reduceMotion: false }, DEFAULTS).reduceMotion, "system")
  assert.equal(migrateSettings({ tapTargets: true }, DEFAULTS).tapTargets, "large")
})

test("migrateSettings: out-of-range values come back in range", () => {
  const s = migrateSettings({ textSize: "huge", contrast: "purple", reduceMotion: "maybe", doubleClickMs: 5, longPressMs: 99999, magZoom: "7", hiddenDesktop: ["Tetris", 3, "Tetris", ""], hiddenStart: "Hover", region: { time: "24" }, ieHome: 5 }, DEFAULTS)
  assert.equal(s.textSize, "normal")
  assert.equal(s.contrast, "off")
  assert.equal(s.reduceMotion, "system")
  assert.equal(s.doubleClickMs, 200)
  assert.equal(s.longPressMs, 1500)
  assert.equal(s.magZoom, 6)
  assert.deepEqual(s.hiddenDesktop, ["Tetris"])
  assert.deepEqual(s.hiddenStart, [])
  assert.deepEqual(s.region, { ...DEFAULTS.region, time: "24" }, "region merges with its defaults")
  assert.equal(s.ieHome, "")
  assert.equal(migrateSettings({ doubleClickMs: "abc" }, DEFAULTS).doubleClickMs, 500)
})

test("migrateSettings: keys the defaults don't have are left alone", () => {
  const s = migrateSettings({ textSize: "huge" }, { wallpaper: "default" })
  assert.equal(s.textSize, "huge")
})

// ---- contrast schemes ----

test("contrast schemes: Windows 98's black and white", () => {
  assert.deepEqual(CONTRAST_SCHEMES.map((s) => s.id), ["off", "black", "white"])
  assert.deepEqual(contrastVars("off"), {})
  assert.deepEqual(contrastVars("nonsense"), {})
  const black = contrastVars("black")
  assert.equal(black["--hc-bg"], "#000000")
  assert.equal(black["--hc-fg"], "#ffffff")
  assert.equal(black["--hc-hi"], "#800080", "purple selection, as in Windows 98")
  assert.equal(black["--title-a"], "#800080")
  assert.equal(black["--title-a"], black["--title-b"], "flat title bars, no gradient")
  assert.equal(black["--hc-gray"], "#00ff00")
  const white = contrastVars("white")
  assert.equal(white["--hc-bg"], "#ffffff")
  assert.equal(white["--hc-fg"], "#000000")
  assert.equal(white["--title-a"], "#000000")
  assert.equal(white["--hc-inactive-fg"], "#000000", "inactive title text is dark on a white bar")
})

test("contrast schemes: text and selection have strong contrast", () => {
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
  for (const s of CONTRAST_SCHEMES.filter((x) => x.colors)) {
    const c = s.colors
    assert.ok(ratio(c.fg, c.bg) >= 7, `${s.id} text`)
    assert.ok(ratio(c.hiFg, c.hi) >= 4.5, `${s.id} selection`)
    assert.ok(ratio(c.titleFg, c.title) >= 4.5, `${s.id} title`)
    assert.ok(ratio(c.inactiveFg, c.inactive) >= 4.5, `${s.id} inactive title`)
    assert.ok(ratio(c.gray, c.bg) >= 4.5, `${s.id} disabled text`)
    assert.ok(ratio(c.link, c.bg) >= 4.5, `${s.id} links`)
  }
})

// ---- what <html> gets ----

test("a11yRoot: defaults change nothing", () => {
  const r = a11yRoot({ textSize: "normal", contrast: "off", reduceMotion: "system", tapTargets: "normal" }, { systemReduced: false })
  assert.equal(Object.values(r.classes).some(Boolean), false)
  assert.equal(r.vars["--text-scale"], "1")
  assert.equal(r.vars["--title-h"], "25px")
  assert.equal(r.vars["--hc-bg"], undefined)
})

test("a11yRoot: text sizes scale text and title bars", () => {
  assert.equal(textScale("large"), 1.25)
  assert.equal(textScale("xlarge"), 1.5)
  assert.equal(textScale("whatever"), 1)
  assert.equal(titleHeight(1), 25)
  assert.ok(titleHeight(1.25) > 25 && titleHeight(1.5) > titleHeight(1.25))
  const r = a11yRoot({ textSize: "xlarge" })
  assert.equal(r.classes["a11y-text"], true)
  assert.equal(r.vars["--text-scale"], "1.5")
  assert.equal(r.vars["--title-h"], "36px")
})

test("a11yRoot: high contrast, motion, tap targets, swapped buttons", () => {
  const r = a11yRoot({ contrast: "white", reduceMotion: "on", tapTargets: "large", swapButtons: true }, { systemReduced: false, mobile: false })
  assert.equal(r.classes["a11y-hc"], true)
  assert.equal(r.classes["a11y-hc-white"], true)
  assert.equal(r.classes["a11y-hc-black"], false)
  assert.equal(r.classes["a11y-motion-reduce"], true)
  assert.equal(r.classes["a11y-big-targets"], true)
  assert.equal(r.classes["a11y-swap-buttons"], true)
  assert.equal(r.vars["--hc-bg"], "#ffffff")
  assert.equal(a11yRoot({ swapButtons: true }, { mobile: true }).classes["a11y-swap-buttons"], false, "no mouse buttons on phones")
})

test("resolveReducedMotion: follows the device unless chosen", () => {
  assert.equal(resolveReducedMotion("system", true), true)
  assert.equal(resolveReducedMotion("system", false), false)
  assert.equal(resolveReducedMotion("on", false), true)
  assert.equal(resolveReducedMotion("off", true), false)
  assert.equal(resolveReducedMotion(undefined, true), true)
})

// ---- regional settings ----

test("region: 12- and 24-hour time", () => {
  setRegionPrefs({ time: "12" })
  assert.equal(uses24h(), false)
  assert.equal(formatTime(19, 5), "7:05 PM")
  assert.equal(formatTime(0, 0), "12:00 AM")
  assert.equal(formatShortTime(19, 0), "7p")
  assert.equal(formatShortTime(9, 30), "9:30a")
  assert.equal(formatHour(13), "1 PM")
  setRegionPrefs({ time: "24" })
  assert.equal(formatTime(19, 5), "19:05")
  assert.equal(formatTime(0, 7), "00:07")
  assert.equal(formatShortTime(9, 30), "09:30")
  assert.equal(formatHour(13), "13:00")
  setRegionPrefs({ locale: "de-DE" })
  assert.equal(uses24h(), true, "German writes 19:05")
  setRegionPrefs({ locale: "en-US" })
  assert.equal(uses24h(), false)
  setRegionPrefs(null)
})

test("region: first day of the week", () => {
  setRegionPrefs({ firstDay: 1 })
  assert.equal(weekStart(), 1)
  assert.deepEqual(weekdayOrder(), [1, 2, 3, 4, 5, 6, 0])
  setRegionPrefs({ firstDay: "6" })
  assert.equal(weekStart(), 6)
  setRegionPrefs({ firstDay: "auto", locale: "en-US" })
  assert.equal(weekStart(), 0)
  setRegionPrefs({ firstDay: "auto", locale: "de-DE" })
  assert.equal(weekStart(), 1)
  assert.equal(localeWeekStart("en-GB"), 1)
  assert.equal(localeWeekStart("not a locale!!"), 0)
  setRegionPrefs(null)
})

test("region: short dates in each order", () => {
  setRegionPrefs({ dateOrder: "mdy" })
  assert.equal(formatShortDate(2026, 10, 3), "10/3/2026")
  setRegionPrefs({ dateOrder: "dmy" })
  assert.equal(formatShortDate(2026, 10, 3), "3/10/2026")
  setRegionPrefs({ dateOrder: "ymd" })
  assert.equal(formatShortDate(2026, 10, 3), "2026-10-03")
  setRegionPrefs({ locale: "en-GB" })
  assert.equal(formatShortDate(2026, 10, 3), "3/10/2026", "auto follows the locale")
  setRegionPrefs(null)
})
