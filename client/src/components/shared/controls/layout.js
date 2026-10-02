// Pure layout math and storage for on-screen game controls (no React here, so Node can
// unit-test it). See TouchControls.jsx for the component and the API overview.
//
// A rect is { x, y, w, h } in percent of the game area (0-100 on each axis), where x/y is
// the top-left corner. A saved layout (per game and orientation) looks like
// { rects: { id: rect }, opacity: { id: 0-1 }, enabled: { id: bool }, scale, alpha }:
// `scale` (the global button size) grows each button around its center, `alpha` (the
// global opacity) multiplies each button's own opacity.

export const STORAGE_KEY = "98ish.controls"
export const GRID_PX = 8 // edit mode snaps to this grid
export const MIN_PX = 28 // smallest a button can be shrunk to
export const SCALE_RANGE = [0.6, 1.6]
export const ALPHA_RANGE = [0.15, 1]

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const round = (v) => Math.round(v * 1000) / 1000

export const orientationOf = ({ width, height }) => (height >= width ? "portrait" : "landscape")

// Pixels <-> percent of the area. A px rect may anchor to any edge:
// { left | right, top | bottom, width, height }.
export const fromPx = (size, r) => {
  const w = r.width
  const h = r.height
  const left = r.left ?? size.width - (r.right ?? 0) - w
  const top = r.top ?? size.height - (r.bottom ?? 0) - h
  return {
    x: round((left / size.width) * 100),
    y: round((top / size.height) * 100),
    w: round((w / size.width) * 100),
    h: round((h / size.height) * 100),
  }
}

export const toPx = (size, r) => ({
  left: (r.x / 100) * size.width,
  top: (r.y / 100) * size.height,
  width: (r.w / 100) * size.width,
  height: (r.h / 100) * size.height,
})

// Grow or shrink a rect around its center
export const scaleRect = (r, s) => ({ x: r.x + (r.w * (1 - s)) / 2, y: r.y + (r.h * (1 - s)) / 2, w: r.w * s, h: r.h * s })

// Keep a rect inside the area, and no smaller than MIN_PX (unless the area itself is)
export const clampRect = (r, size, minPx = MIN_PX) => {
  const minW = Math.min(100, (minPx / Math.max(1, size.width)) * 100)
  const minH = Math.min(100, (minPx / Math.max(1, size.height)) * 100)
  const w = clamp(r.w, minW, 100)
  const h = clamp(r.h, minH, 100)
  return { x: clamp(r.x, 0, 100 - w), y: clamp(r.y, 0, 100 - h), w, h }
}

// Round a percent value to the nearest GRID_PX step of that axis
const snapAxis = (pct, px, grid) => {
  const step = (grid / Math.max(1, px)) * 100
  return round(Math.round(pct / step) * step)
}

export const snapRect = (r, size, grid = GRID_PX) => ({
  x: snapAxis(r.x, size.width, grid),
  y: snapAxis(r.y, size.height, grid),
  w: Math.max(snapAxis(r.w, size.width, grid), (grid / Math.max(1, size.width)) * 100),
  h: Math.max(snapAxis(r.h, size.height, grid), (grid / Math.max(1, size.height)) * 100),
})

// Do two rects overlap by more than a sliver (touching edges is fine)?
export const overlaps = (a, b, size, tolerancePx = 1) => {
  const tx = (tolerancePx / Math.max(1, size.width)) * 100
  const ty = (tolerancePx / Math.max(1, size.height)) * 100
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return ox > tx && oy > ty
}

// ids of every rect that overlaps another. rects: { id: rect }
export const findOverlaps = (rects, size) => {
  const ids = Object.keys(rects)
  const hit = new Set()
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (overlaps(rects[ids[i]], rects[ids[j]], size)) {
        hit.add(ids[i])
        hit.add(ids[j])
      }
    }
  }
  return [...hit]
}

// Left-handed preset: flip every rect horizontally (ids in `keep` stay where they are)
export const mirrorRects = (rects, keep = []) =>
  Object.fromEntries(Object.entries(rects).map(([id, r]) => [id, keep.includes(id) ? r : { ...r, x: round(100 - r.x - r.w) }]))

// Default rects for one orientation. A control's `default` is { portrait, landscape },
// each a rect or a function (size) => rect (handy for "8px from the bottom right").
export const defaultRects = (controls, size, orientation) => {
  const out = {}
  for (const c of controls) {
    const d = c.default?.[orientation] ?? c.default?.portrait ?? c.default
    const rect = typeof d === "function" ? d(size) : d
    out[c.id] = rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : { x: 40, y: 40, w: 20, h: 20 }
  }
  return out
}

export const defaultLayout = (controls, size, orientation, { scale = 1, alpha = 1 } = {}) => ({
  rects: defaultRects(controls, size, orientation),
  opacity: Object.fromEntries(controls.map((c) => [c.id, c.opacity ?? 1])),
  enabled: Object.fromEntries(controls.map((c) => [c.id, c.enabled !== false])),
  scale,
  alpha,
})

// The layout to use: saved values over the defaults (controls added to a game after the
// player saved a layout get their default spot; removed ones are dropped)
export const mergeLayout = (defaults, saved) => {
  if (!saved) return defaults
  const pick = (key) =>
    Object.fromEntries(Object.keys(defaults.rects).map((id) => [id, saved[key]?.[id] ?? defaults[key][id]]))
  return {
    rects: pick("rects"),
    opacity: pick("opacity"),
    enabled: pick("enabled"),
    scale: clamp(Number(saved.scale) || defaults.scale, ...SCALE_RANGE),
    alpha: clamp(Number(saved.alpha) || defaults.alpha, ...ALPHA_RANGE),
  }
}

// Where each button is drawn: global size applied, then kept inside the area
export const effectiveRects = (layout, size, ids = Object.keys(layout.rects), unscaled = []) =>
  Object.fromEntries(
    ids.map((id) => {
      const r = layout.rects[id]
      return [id, clampRect(unscaled.includes(id) ? r : scaleRect(r, layout.scale), size, 0)]
    })
  )

// Turn an on-screen (scaled) rect back into the stored base rect
export const unscaleRect = (r, s) => scaleRect(r, 1 / s)

// ---- storage: one JSON object in localStorage ----
// { prefs: { haptics, show: "auto" | "on" | "off" }, games: { game: { portrait, landscape } } }

export const DEFAULT_PREFS = { haptics: true, show: "auto" }

const browserStorage = () => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

export const readStore = (storage = browserStorage()) => {
  try {
    const raw = JSON.parse(storage?.getItem(STORAGE_KEY))
    if (raw && typeof raw === "object") return { prefs: { ...DEFAULT_PREFS, ...raw.prefs }, games: raw.games || {} }
  } catch {
    // corrupt or blocked: start fresh
  }
  return { prefs: { ...DEFAULT_PREFS }, games: {} }
}

export const writeStore = (store, storage = browserStorage()) => {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // full or blocked: kept for this visit only
  }
}

export const savedLayout = (store, game, orientation) => store.games[game]?.[orientation] || null

// Returns a new store with this game's layout for one orientation replaced (null clears it)
export const withLayout = (store, game, orientation, layout) => {
  const games = { ...store.games, [game]: { ...store.games[game] } }
  if (layout) {
    games[game][orientation] = {
      rects: Object.fromEntries(Object.entries(layout.rects).map(([id, r]) => [id, { x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) }])),
      opacity: layout.opacity,
      enabled: layout.enabled,
      scale: round(layout.scale),
      alpha: round(layout.alpha),
    }
  } else {
    delete games[game][orientation]
  }
  return { ...store, games }
}

export const withPrefs = (store, prefs) => ({ ...store, prefs: { ...store.prefs, ...prefs } })
