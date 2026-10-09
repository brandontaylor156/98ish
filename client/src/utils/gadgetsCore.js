// Desktop gadgets' rules, pure (gadgets.test.js). Vista-style little panels on the desktop,
// drawn as Windows 98 windows: Clock, Weather, Calendar, Notes and CPU/Memory. Which ones are
// out and where they sit is plain data, kept per 98ish user (utils/gadgets.js):
//   { list: [{ kind, x, y, config }] }   x/y: px from the desktop's top-left, null = auto
// Each kind appears at most once. On a computer, auto spots stack down the right edge;
// on a phone they sit in a row along the bottom of the desktop (gadgets start off: none are
// out until someone adds one from the desktop's "Gadgets..." menu).

export const GADGETS = [
  { kind: "clock", name: "Clock", about: "The time on a 98 clock face, and your next alarm.", w: 156, h: 196 },
  { kind: "weather", name: "Weather", about: "Now and the next days where you are (from Weather's places).", w: 156, h: 132 },
  { kind: "calendar", name: "Calendar", about: "Today's date and your next events.", w: 176, h: 176 },
  { kind: "notes", name: "Notes", about: "A sticky note you can type on (one of your Notes).", w: 176, h: 176 },
  { kind: "meter", name: "CPU Meter", about: "How busy 98ish is and how much memory it uses, measured live.", w: 156, h: 150 },
]
export const KINDS = GADGETS.map((g) => g.kind)
export const gadgetInfo = (kind) => GADGETS.find((g) => g.kind === kind) || null

export const MARGIN = 12 // from the desktop's edges
export const GAP = 10

const num = (v) => (Number.isFinite(v) ? Math.round(v) : null)

// a saved state, checked (unknown kinds and repeats dropped)
export const cleanGadgets = (raw) => {
  const list = []
  const seen = new Set()
  for (const g of Array.isArray(raw?.list) ? raw.list : []) {
    if (!g || !KINDS.includes(g.kind) || seen.has(g.kind)) continue
    seen.add(g.kind)
    const config = g.config && typeof g.config === "object" && !Array.isArray(g.config) ? { ...g.config } : {}
    list.push({ kind: g.kind, x: num(g.x), y: num(g.y), config })
  }
  return { list }
}

export const hasGadget = (state, kind) => state.list.some((g) => g.kind === kind)

export const addGadget = (state, kind) => {
  if (!KINDS.includes(kind) || hasGadget(state, kind)) return state
  return { list: [...state.list, { kind, x: null, y: null, config: {} }] }
}

export const removeGadget = (state, kind) => ({ list: state.list.filter((g) => g.kind !== kind) })

export const setConfig = (state, kind, patch) => ({ list: state.list.map((g) => (g.kind === kind ? { ...g, config: { ...g.config, ...patch } } : g)) })

// keep a w x h box inside the desktop
export const clampPos = ({ x, y }, w, h, desk) => ({
  x: Math.round(Math.min(Math.max(0, x), Math.max(0, desk.w - w))),
  y: Math.round(Math.min(Math.max(0, y), Math.max(0, desk.h - h))),
})

export const moveGadget = (state, kind, pos, desk) => {
  const info = gadgetInfo(kind)
  if (!info) return state
  const p = desk ? clampPos(pos, info.w, info.h, desk) : { x: Math.round(pos.x), y: Math.round(pos.y) }
  return { list: state.list.map((g) => (g.kind === kind ? { ...g, x: p.x, y: p.y } : g)) }
}

// Where every gadget is drawn on a computer's desktop (desk: { w, h } px). Placed ones stay
// where they were put (pulled back inside if the window got smaller); auto ones stack down
// the right edge in columns, below the Weather panel's corner and clear of each other.
// -> [{ kind, x, y, w, h }]
export const layout = (state, desk, { top = MARGIN } = {}) => {
  const out = []
  let colX = desk.w - MARGIN
  let y = top
  let colW = 0
  for (const g of state.list) {
    const info = gadgetInfo(g.kind)
    if (g.x !== null && g.y !== null) {
      out.push({ kind: g.kind, ...clampPos(g, info.w, info.h, desk), w: info.w, h: info.h })
      continue
    }
    if (y + info.h > desk.h - MARGIN && y > top) {
      colX -= colW + GAP
      y = top
      colW = 0
    }
    out.push({ kind: g.kind, ...clampPos({ x: colX - info.w, y }, info.w, info.h, desk), w: info.w, h: info.h })
    y += info.h + GAP
    colW = Math.max(colW, info.w)
  }
  return out
}

// ---- what the gadgets show ----

// the clock hands' angles in degrees (12 o'clock = 0, clockwise)
export const handAngles = (h, m, s) => ({
  hour: ((h % 12) + m / 60) * 30,
  minute: (m + s / 60) * 6,
  second: s * 6,
})

// The next time an alarm rings after `now` (a Date in local time) -> { alarm, at: ms } | null
// alarm: { time: "07:30", days: [0..6] (none = once), on }
export const nextAlarm = (alarms = [], now = new Date()) => {
  let best = null
  for (const a of alarms) {
    if (!a?.on || !/^\d{1,2}:\d{2}$/.test(a.time || "")) continue
    const [h, m] = a.time.split(":").map(Number)
    for (let add = 0; add <= 7; add++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add, h, m, 0, 0)
      if (d.getTime() <= now.getTime()) continue
      if (a.days?.length && !a.days.includes(d.getDay())) continue
      if (!best || d.getTime() < best.at) best = { alarm: a, at: d.getTime() }
      break
    }
  }
  return best
}

// a CPU history line: the last `keep` samples of busy % -> SVG points in a w x h box
export const meterPoints = (history, w, h, keep = 30) => {
  const list = history.slice(-keep)
  if (!list.length) return ""
  const step = w / Math.max(1, keep - 1)
  const start = keep - list.length
  return list.map((v, i) => `${Math.round((start + i) * step * 10) / 10},${Math.round((h - (Math.max(0, Math.min(100, v)) / 100) * h) * 10) / 10}`).join(" ")
}

export const megabytes = (bytes) => (Number.isFinite(bytes) ? `${Math.round(bytes / 1048576)} MB` : "")
