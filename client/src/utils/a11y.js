// Accessibility Options (Control Panel): text size, high contrast, less motion and larger
// tap targets, plus the checks settings.js runs on saved settings. No React and no storage,
// so Node can test it (utils/a11y.test.js). hooks/useA11y.js puts the result on <html> as
// classes and CSS variables; a11y.css and the PostCSS step in client/postcss-a11y.js do
// the rest (every CSS font size is multiplied by --text-scale).

export const TEXT_SIZES = [
  { id: "normal", label: "Normal", scale: 1 },
  { id: "large", label: "Large", scale: 1.25 },
  { id: "xlarge", label: "Extra Large", scale: 1.5 },
]

export const textScale = (id) => TEXT_SIZES.find((t) => t.id === id)?.scale ?? 1

// the title bar grows with its text: 25px at Normal, 31px at Large, 36px at Extra Large
export const titleHeight = (scale) => Math.round(25 + (scale - 1) * 22)

// Windows 98's High Contrast schemes. bg/fg: windows and text; face: buttons and bars;
// hi: the selection; title/inactive: title bars; gray: disabled text; link: links.
export const CONTRAST_SCHEMES = [
  { id: "off", label: "(None)" },
  {
    id: "black",
    label: "High Contrast Black",
    colors: { bg: "#000000", fg: "#ffffff", face: "#000000", faceFg: "#ffffff", edge: "#ffffff", hi: "#800080", hiFg: "#ffffff", title: "#800080", titleFg: "#ffffff", inactive: "#008000", inactiveFg: "#ffffff", gray: "#00ff00", link: "#ffff00", desktop: "#000000" },
  },
  {
    id: "white",
    label: "High Contrast White",
    colors: { bg: "#ffffff", fg: "#000000", face: "#ffffff", faceFg: "#000000", edge: "#000000", hi: "#000000", hiFg: "#ffffff", title: "#000000", titleFg: "#ffffff", inactive: "#ffffff", inactiveFg: "#000000", gray: "#008000", link: "#0000c0", desktop: "#ffffff" },
  },
]

export const contrastScheme = (id) => CONTRAST_SCHEMES.find((s) => s.id === id && s.colors) || null

// CSS variables for a contrast scheme (none for "off"). The title bar variables are the
// ones the color schemes set too, so everything that follows the title colors (windows,
// the 98ish keyboard, the select pickers) follows high contrast as well.
export const contrastVars = (id) => {
  const s = contrastScheme(id)
  if (!s) return {}
  const c = s.colors
  return {
    "--hc-bg": c.bg,
    "--hc-fg": c.fg,
    "--hc-face": c.face,
    "--hc-face-fg": c.faceFg,
    "--hc-edge": c.edge,
    "--hc-hi": c.hi,
    "--hc-hi-fg": c.hiFg,
    "--hc-title-fg": c.titleFg,
    "--hc-inactive-fg": c.inactiveFg,
    "--hc-gray": c.gray,
    "--hc-link": c.link,
    "--hc-title": c.title,
    "--hc-inactive": c.inactive,
    "--title-a": c.title,
    "--title-b": c.title,
    "--title-inactive-a": c.inactive,
    "--title-inactive-b": c.inactive,
  }
}

// "system" follows the device's Reduce Motion setting; "on" and "off" override it
export const MOTION_CHOICES = [
  { id: "system", label: "Use my device's setting" },
  { id: "on", label: "Reduce motion" },
  { id: "off", label: "Full motion" },
]
export const resolveReducedMotion = (setting, systemPrefers) => (setting === "on" ? true : setting === "off" ? false : !!systemPrefers)

// Everything <html> gets for these settings: { classes: { name: on }, vars: { name: value } }
// env: { systemReduced, mobile }
export const a11yRoot = (settings = {}, env = {}) => {
  const scale = textScale(settings.textSize)
  const hc = contrastScheme(settings.contrast)
  return {
    classes: {
      "a11y-text": scale !== 1,
      "a11y-hc": !!hc,
      "a11y-hc-black": hc?.id === "black",
      "a11y-hc-white": hc?.id === "white",
      "a11y-motion-reduce": resolveReducedMotion(settings.reduceMotion, env.systemReduced),
      "a11y-big-targets": settings.tapTargets === "large",
      "a11y-swap-buttons": !!settings.swapButtons && !env.mobile,
    },
    vars: {
      "--text-scale": String(scale),
      "--title-h": `${titleHeight(scale)}px`,
      ...contrastVars(settings.contrast),
    },
  }
}

// ---- checking saved settings ----

const clampInt = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback
}
const oneOf = (v, ids, fallback) => (ids.includes(v) ? v : fallback)
const names = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && x))] : [])

// Saved settings (from any earlier version of 98ish) -> settings to use: defaults filled in,
// older shapes upgraded, and anything out of range put back in range. Unknown keys are kept.
export const migrateSettings = (raw, defaults = {}) => {
  const saved = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {}
  // older shapes: a boolean high contrast, a numeric text scale, a boolean reduce motion
  if (saved.highContrast !== undefined && saved.contrast === undefined) saved.contrast = saved.highContrast ? "black" : "off"
  delete saved.highContrast
  if (typeof saved.textSize === "number") saved.textSize = saved.textSize >= 1.4 ? "xlarge" : saved.textSize >= 1.15 ? "large" : "normal"
  if (typeof saved.reduceMotion === "boolean") saved.reduceMotion = saved.reduceMotion ? "on" : "system"
  if (typeof saved.tapTargets === "boolean") saved.tapTargets = saved.tapTargets ? "large" : "normal"
  const s = { ...defaults, ...saved }
  if ("textSize" in defaults) s.textSize = oneOf(s.textSize, TEXT_SIZES.map((t) => t.id), defaults.textSize)
  if ("contrast" in defaults) s.contrast = oneOf(s.contrast, CONTRAST_SCHEMES.map((c) => c.id), defaults.contrast)
  if ("reduceMotion" in defaults) s.reduceMotion = oneOf(s.reduceMotion, MOTION_CHOICES.map((m) => m.id), defaults.reduceMotion)
  if ("tapTargets" in defaults) s.tapTargets = oneOf(s.tapTargets, ["normal", "large"], defaults.tapTargets)
  if ("doubleClickMs" in defaults) s.doubleClickMs = clampInt(s.doubleClickMs, 200, 900, defaults.doubleClickMs)
  if ("longPressMs" in defaults) s.longPressMs = clampInt(s.longPressMs, 300, 1500, defaults.longPressMs)
  if ("magZoom" in defaults) s.magZoom = clampInt(s.magZoom, 2, 6, defaults.magZoom)
  if ("hiddenDesktop" in defaults) s.hiddenDesktop = names(s.hiddenDesktop)
  if ("hiddenStart" in defaults) s.hiddenStart = names(s.hiddenStart)
  if ("region" in defaults) s.region = { ...defaults.region, ...(s.region && typeof s.region === "object" ? s.region : {}) }
  if ("ieHome" in defaults && typeof s.ieHome !== "string") s.ieHome = defaults.ieHome
  return s
}
