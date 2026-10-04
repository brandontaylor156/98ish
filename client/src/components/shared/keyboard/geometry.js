// Where every key is, iPhone style (pure, unit tested in keyboard.test.js).
//
// The numbers are the iOS 17/18 English keyboard's, in points (= CSS px), as measured and
// published by KeyboardKit (KeyboardLayoutConfiguration + iPhoneKeyboardLayoutProvider,
// which reproduce the system keyboard) and the classic 375pt measurements (3 + 10 x 31.5 +
// 9 x 6 + 3 = 375):
//   portrait rows      54pt apart, keys 42pt tall (12pt between rows, 6pt above the first
//                      and below the last); Plus/Pro Max (>= 420pt wide): 56pt, keys 45pt
//   landscape rows     40pt apart, keys 32pt tall
//   columns            a letter's slot is a tenth of the width, the key 6pt narrower (3pt
//                      each side), so the outer margin is 3pt
//   row 2 (a-l)        nine slots, half a slot of margin at each end
//   Shift, Delete      13% of the width each, the leftover between them and z / m
//   bottom row         123 and the emoji/globe slot 12.3% each (landscape 9.5%), return 25%
//                      (landscape 19.5%), space takes the rest
//   . , ? ! ' (123)    14% each
// A touch belongs to the nearest key: every key's touch area runs to the middle of the gap
// on each side (the row's ends run to the keyboard's edges) and covers its whole row.

export const IOS = {
  portrait: { pitch: 54, keyH: 42 },
  portraitMax: { pitch: 56, keyH: 45 },
  landscape: { pitch: 40, keyH: 32 },
  numpad: { pitch: 54, keyH: 46 },
  numpadLandscape: { pitch: 40, keyH: 34 },
  gapX: 6,
  shift: 0.13,
  wide: 0.14,
  sys: { portrait: 0.123, landscape: 0.095 },
  ret: { portrait: 0.25, landscape: 0.195 },
}

// the row metrics for a keyboard `width` px wide
//   landscape: the phone is on its side; numpad: the 3-column number pad
export const metricsFor = ({ width, landscape = false, numpad = false }) => {
  const rows = numpad ? (landscape ? IOS.numpadLandscape : IOS.numpad) : landscape ? IOS.landscape : width >= 420 ? IOS.portraitMax : IOS.portrait
  return { width, landscape, ...rows, gapX: IOS.gapX }
}

// a key's width in px: a number is letter slots (a tenth of the width each), else a name
const widthOf = (w, m) => {
  if (typeof w === "number") return (w * m.width) / 10
  const o = m.landscape ? "landscape" : "portrait"
  switch (w) {
    case "shift":
      return m.width * IOS.shift
    case "wide":
      return m.width * IOS.wide
    case "sys":
      return m.width * IOS.sys[o]
    case "ret":
      return m.width * IOS.ret[o]
    case "third":
      return m.width / 3
    default:
      return null // "fill": what's left
  }
}

const round = (n) => Math.round(n * 100) / 100

// every key of a page laid out: [{ key, row, col, id, slot, cap, touch }] where slot is the
// key's share of the row, cap the drawn key, touch the area that types it ({ x, y, w, h },
// relative to the top left of the keys area)
export const layoutKeys = (rows, m) => {
  const out = []
  rows.forEach((row, r) => {
    const widths = row.map((key) => widthOf(key.w ?? 1, m))
    const fixed = widths.reduce((sum, w) => sum + (w ?? 0), 0)
    const fills = widths.filter((w) => w == null).length
    const rest = Math.max(0, m.width - fixed)
    const fillW = fills ? rest / fills : 0
    // no space bar to take the rest: it's margin, half on each side of the characters (row
    // 2's half key at the ends; inside Shift and Delete on row 3)
    const margin = fills ? 0 : rest / 2
    const firstChar = Math.max(0, row.findIndex((key) => key.kind === "char"))
    const lastChar = row.length - 1 - Math.max(0, [...row].reverse().findIndex((key) => key.kind === "char"))
    let x = 0
    const y = r * m.pitch
    const capY = y + (m.pitch - m.keyH) / 2
    const placed = row.map((key, c) => {
      const w = widths[c] ?? fillW
      if (c === firstChar) x += margin
      const slot = { x, y, w, h: m.pitch }
      x += w
      if (c === lastChar) x += margin
      return { key, row: r, col: c, id: `${r}-${c}`, slot, cap: { x: round(slot.x + m.gapX / 2), y: capY, w: round(w - m.gapX), h: m.keyH } }
    })
    placed.forEach((p, c) => {
      const prev = placed[c - 1]
      const next = placed[c + 1]
      const left = prev ? (prev.cap.x + prev.cap.w + p.cap.x) / 2 : 0
      const right = next ? (p.cap.x + p.cap.w + next.cap.x) / 2 : m.width
      p.touch = { x: round(left), y, w: round(right - left), h: m.pitch }
      out.push(p)
    })
  })
  return out
}

// the height of the keys area
export const keysHeight = (rows, m) => rows.length * m.pitch

// the key a touch at (x, y) (relative to the keys area) types: its row by height (a touch
// above the first row or below the last belongs to it), then the key whose touch area
// holds x. Blank cells (the number pad's empty corner) type nothing: null.
export const hitTest = (keys, x, y, m) => {
  if (!keys.length) return null
  const rowCount = keys[keys.length - 1].row + 1
  const r = Math.max(0, Math.min(rowCount - 1, Math.floor(y / m.pitch)))
  const inRow = keys.filter((k) => k.row === r)
  let best = null
  for (const k of inRow) {
    if (x >= k.touch.x && x < k.touch.x + k.touch.w) {
      best = k
      break
    }
  }
  if (!best) best = x < inRow[0].touch.x ? inRow[0] : inRow[inRow.length - 1]
  return best.key.kind === "blank" ? null : best
}

// The press "balloon" over a key, as iOS draws it: a head wider than the key holding the
// letter, a neck, and the key itself (the stem). Head: the key + 26pt wide (KeyboardKit's
// callout: 8pt curves + 10pt corners), about 1.2 keys tall; in landscape iOS keeps it the
// key's own height. Kept inside the keyboard's width: the edge keys' heads lean inward.
// Coordinates relative to the keys area (the head goes above it for the first row).
export const balloonFor = (cap, width, landscape = false) => {
  const headW = Math.round(cap.w + 26)
  const headH = Math.round(landscape ? cap.h + 2 : cap.h * 1.2)
  const neck = landscape ? 6 : 10
  const center = cap.x + cap.w / 2
  const headX = Math.round(Math.max(1, Math.min(width - headW - 1, center - headW / 2)))
  const headY = Math.round(cap.y - neck - headH)
  return { head: { x: headX, y: headY, w: headW, h: headH }, neck, stem: { x: Math.round(cap.x), y: Math.round(cap.y), w: Math.round(cap.w), h: Math.round(cap.h) } }
}

// The long-press strip of alternates: it opens over the key and runs right from a key on
// the left half, left from one on the right half (the list reversed, so the key's own
// character stays over the key). Returns where it is and the order shown.
export const stripFor = (cap, items, width, landscape = false) => {
  const longest = Math.max(...items.map((item) => item.length))
  const cell = Math.round(Math.max(cap.w, 30, longest > 1 ? longest * 8 + 14 : 0))
  const pad = 3
  const w = cell * items.length + pad * 2
  const leftward = cap.x + cap.w / 2 > width / 2
  const shown = leftward ? [...items].reverse() : items
  const anchor = leftward ? cap.x + cap.w + pad - w : cap.x - pad
  const x = Math.round(Math.max(1, Math.min(width - w - 1, anchor)))
  const b = balloonFor(cap, width, landscape)
  return { x, y: b.head.y, w, h: b.head.h, cell, pad, shown, leftward }
}

// which shown item a finger at x (keys-area coordinates) is on (index into `shown`)
export const stripIndex = (strip, x) => Math.max(0, Math.min(strip.shown.length - 1, Math.floor((x - strip.x - strip.pad) / strip.cell)))

// Delete held down, as on iOS: one character on the press; after the repeat delay it
// repeats, speeding up, and after about ten characters it deletes whole words, slower.
// n: how many deletes so far (1 after the press). Returns { wait, word }: how long until
// the next delete, and whether that one takes a word.
export const WORDS_AFTER = 10
export const deleteRepeat = (n, { delay = 500, rate = 60 } = {}) => {
  if (n <= 1) return { wait: delay, word: false }
  if (n < WORDS_AFTER) return { wait: Math.max(rate, 110 - (n - 1) * 6), word: false }
  return { wait: Math.max(180, rate * 3), word: true }
}
