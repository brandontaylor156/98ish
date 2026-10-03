import React from "react"

// Appward 98's little pixel icons, drawn here on a 16x16 grid (toolbar ones scale to 20).
// Each is a handful of rectangles and paths in the 16-color palette, outlined in black.

const K = "#000"
const W = "#fff"
const NAVY = "#000080"
const TEAL = "#008080"
const YEL = "#ffff00"
const GOLD = "#ffd800"
const RED = "#c00000"
const GRN = "#008000"
const LIME = "#00c000"
const GRY = "#c0c0c0"
const DGRY = "#808080"
const SKY = "#7fb2ff"
const PAPER = "#fffbe8"
const BROWN = "#a0522d"

const r = (x, y, w, h, fill, stroke = K) => <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} fill={fill} stroke={stroke} />
const f = (x, y, w, h, fill) => <rect x={x} y={y} width={w} height={h} fill={fill} />
const p = (d, fill, stroke = K, sw = 1) => <path d={d} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />

const GLYPHS = {
  check: () => (
    <>
      {r(1, 1, 14, 14, W)}
      {p("M4 8l3 3 5-7", "none", GRN, 2)}
    </>
  ),
  megaphone: () => (
    <>
      {p("M2 6.5h3l7-4v11l-7-4H2z", GOLD)}
      {r(4, 9, 3, 5, GRY)}
      {f(13, 7, 2, 2, RED)}
    </>
  ),
  doc: () => (
    <>
      {p("M3.5 1.5h6l3 3v10h-9z", W)}
      {p("M9.5 1.5v3h3", "none")}
      {f(5, 7, 6, 1, NAVY)}
      {f(5, 9, 6, 1, NAVY)}
      {f(5, 11, 4, 1, NAVY)}
    </>
  ),
  note: () => (
    <>
      {p("M1.5 2.5h13v9l-3 3h-10z", YEL)}
      {p("M11.5 14.5v-3h3", "#e0d000")}
      {f(4, 5, 8, 1, BROWN)}
      {f(4, 8, 6, 1, BROWN)}
    </>
  ),
  board: () => (
    <>
      {r(1, 2, 14, 12, W)}
      {f(2, 3, 12, 2, NAVY)}
      {r(3, 6, 3, 3, YEL)}
      {r(7, 6, 3, 5, SKY)}
      {r(11, 6, 3, 3, "#ffb0b0")}
    </>
  ),
  calendar: () => (
    <>
      {r(1, 2, 14, 13, W)}
      {f(2, 3, 12, 3, RED)}
      {f(4, 1, 1, 3, K)}
      {f(11, 1, 1, 3, K)}
      {f(4, 8, 2, 2, NAVY)}
      {f(7, 8, 2, 2, DGRY)}
      {f(10, 8, 2, 2, DGRY)}
      {f(4, 11, 2, 2, DGRY)}
      {f(7, 11, 2, 2, DGRY)}
    </>
  ),
  building: () => (
    <>
      {r(3, 1, 10, 14, GRY)}
      {[3, 6, 9].map((y) => [5, 9].map((x) => <React.Fragment key={x + "-" + y}>{f(x, y, 2, 2, SKY)}</React.Fragment>))}
      {r(7, 11, 3, 4, BROWN)}
    </>
  ),
  person: () => (
    <>
      {p("M8 1.5a3 3 0 1 1 0 6a3 3 0 1 1 0-6z", "#ffd0a0")}
      {p("M2.5 14.5c0-4 2.5-6 5.5-6s5.5 2 5.5 6z", TEAL)}
    </>
  ),
  chat: () => (
    <>
      {p("M1.5 2.5h10v7h-5l-3 3v-3h-2z", W)}
      {p("M8.5 10.5h3l2 2v-2h1v-5h-3", SKY)}
      {f(3, 5, 6, 1, NAVY)}
    </>
  ),
  chart: () => (
    <>
      {p("M1.5 1v13.5H15", "none")}
      {r(3, 8, 3, 6, RED)}
      {r(7, 4, 3, 10, NAVY)}
      {r(11, 6, 3, 8, LIME)}
    </>
  ),
  wrench: () => p("M10 1.5a4 4 0 0 0-3.4 5.6L1.8 12a1.6 1.6 0 0 0 2.3 2.3l4.9-4.9A4 4 0 0 0 14.5 6l-2.3 1.2-2-1 .2-2.5L12 2a4 4 0 0 0-2-.5z", GRY),
  funnel: () => (
    <>
      {p("M1.5 2.5h13l-5 6v5l-3 2v-7z", GOLD)}
      {f(3, 3, 10, 1, W)}
    </>
  ),
  globe: () => (
    <>
      {p("M8 1.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13z", SKY)}
      {p("M4 4.5c2 1 2 3 4 3s1 3 3 4M10 2.5c-1 2 1 3 3 2", "none", GRN, 1.4)}
    </>
  ),
  money: () => (
    <>
      {r(1, 4, 14, 9, "#9fe09f")}
      {p("M8 5.5a2.5 3 0 1 1 0 6a2.5 3 0 1 1 0-6z", "#e8ffe8", GRN)}
      <text x="8" y="11" fontSize="6" textAnchor="middle" fill={GRN} fontFamily="monospace" fontWeight="bold">$</text>
    </>
  ),
  target: () => (
    <>
      {p("M8 1.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13z", RED)}
      {p("M8 4a4 4 0 1 1 0 8a4 4 0 1 1 0-8z", W)}
      {p("M8 6.5a1.5 1.5 0 1 1 0 3a1.5 1.5 0 1 1 0-3z", RED)}
    </>
  ),
  star: () => p("M8 1l2 4.5 5 .5-3.8 3.3 1.1 5L8 11.8 3.7 14.3l1.1-5L1 6l5-.5z", GOLD),
  warning: () => (
    <>
      {p("M8 1.5l7 13H1z", YEL)}
      {f(7, 6, 2, 4, K)}
      {f(7, 11, 2, 2, K)}
    </>
  ),
  bulb: () => (
    <>
      {p("M8 1.5a4.5 4.5 0 0 1 2.5 8.2V11h-5V9.7A4.5 4.5 0 0 1 8 1.5z", YEL)}
      {r(5, 11, 6, 4, GRY)}
    </>
  ),
  clipboard: () => (
    <>
      {r(2, 2, 12, 13, BROWN)}
      {r(4, 4, 8, 10, W)}
      {r(5, 1, 6, 3, GRY)}
      {f(5, 7, 6, 1, NAVY)}
      {f(5, 10, 5, 1, NAVY)}
    </>
  ),
  clock: () => (
    <>
      {p("M8 1.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13z", W)}
      {p("M8 4v4h3", "none", K, 1.4)}
    </>
  ),
  book: () => (
    <>
      {r(2, 1, 12, 14, NAVY)}
      {r(4, 1, 10, 12, "#3050c0")}
      {f(3, 13, 11, 1, W)}
      {f(6, 4, 6, 2, GOLD)}
    </>
  ),
  gear: () => (
    <>
      {p("M7 1h2l.4 2 1.6.7 1.7-1.2 1.4 1.4-1.2 1.7.7 1.6 2 .4v2l-2 .4-.7 1.6 1.2 1.7-1.4 1.4-1.7-1.2-1.6.7-.4 2H7l-.4-2-1.6-.7-1.7 1.2-1.4-1.4 1.2-1.7-.7-1.6-2-.4V7l2-.4.7-1.6-1.2-1.7 1.4-1.4 1.7 1.2 1.6-.7z", GRY)}
      {p("M8 6a2 2 0 1 1 0 4a2 2 0 1 1 0-4z", W)}
    </>
  ),
  truck: () => (
    <>
      {r(1, 4, 9, 8, RED)}
      {p("M10 6.5h3l2 3v2.5h-5z", SKY)}
      {p("M4 11a1.6 1.6 0 1 1 0 3.2a1.6 1.6 0 1 1 0-3.2zM12 11a1.6 1.6 0 1 1 0 3.2a1.6 1.6 0 1 1 0-3.2z", DGRY)}
    </>
  ),
  key: () => (
    <>
      {p("M5 3.5a3 3 0 1 1 0 6a3 3 0 1 1 0-6z", GOLD)}
      {p("M7.5 7h7v2h-1v2h-2V9h-4", GOLD)}
      {f(4, 6, 2, 1, K)}
    </>
  ),
  pin: () => (
    <>
      {p("M8 1.5a4.5 4.5 0 0 1 4.5 4.5c0 3-4.5 8.5-4.5 8.5S3.5 9 3.5 6A4.5 4.5 0 0 1 8 1.5z", RED)}
      {p("M8 4.5a1.5 1.5 0 1 1 0 3a1.5 1.5 0 1 1 0-3z", W)}
    </>
  ),
  pencil: () => (
    <>
      {p("M11 1.5l3.5 3.5-9 9H2v-3.5z", GOLD)}
      {p("M2 11l3 3H2z", K)}
      {p("M11 1.5l3.5 3.5-1.5 1.5L9.5 3z", "#ff9fb0")}
    </>
  ),
  gantt: () => (
    <>
      {r(1, 1, 14, 14, W)}
      {f(3, 3, 6, 2, NAVY)}
      {f(6, 7, 7, 2, TEAL)}
      {f(4, 11, 5, 2, RED)}
      {p("M12 10.5l1.5 1.5-1.5 1.5-1.5-1.5z", GOLD)}
    </>
  ),
  cart: () => (
    <>
      {p("M1 2.5h2.5l2 8h8l1.5-6H4.5", W)}
      {p("M6 12a1.3 1.3 0 1 1 0 2.6a1.3 1.3 0 1 1 0-2.6zM12 12a1.3 1.3 0 1 1 0 2.6a1.3 1.3 0 1 1 0-2.6z", K)}
    </>
  ),
  box: () => (
    <>
      {p("M1.5 5L8 2l6.5 3v8L8 15l-6.5-2z", "#d8a860")}
      {p("M1.5 5L8 8l6.5-3M8 8v7", "none")}
      {p("M4.5 3.5l6.5 3", "none", BROWN)}
    </>
  ),
  party: () => (
    <>
      {p("M2 14.5L6 4l6 6z", GOLD)}
      {f(11, 2, 2, 2, RED)}
      {f(13, 6, 2, 2, SKY)}
      {f(8, 1, 2, 2, LIME)}
    </>
  ),
  ticket: () => (
    <>
      {p("M1.5 4.5h13v2.5a1.5 1.5 0 0 0 0 3v2.5h-13V10a1.5 1.5 0 0 0 0-3z", "#ffb070")}
      {p("M10 5v7", "none", K, 0.8)}
      {f(3, 7, 5, 1, K)}
    </>
  ),
  ribbon: () => (
    <>
      {p("M5 9l-2 6 3-1.5L8 15l-1-5zM11 9l2 6-3-1.5L8 15l1-5z", RED)}
      {p("M8 1.5a4 4 0 1 1 0 8a4 4 0 1 1 0-8z", GOLD)}
    </>
  ),
  magnifier: () => (
    <>
      {p("M6.5 1.5a5 5 0 1 1 0 10a5 5 0 1 1 0-10z", "#d8f0ff")}
      {p("M10 10l4.5 4.5", "none", K, 2.4)}
    </>
  ),
  ruler: () => (
    <>
      {p("M1 11L11 1l4 4L5 15z", GOLD)}
      {p("M4 8l1.5 1.5M6 6l1 1M8 4l1.5 1.5M10 2l1 1", "none", K, 0.9)}
    </>
  ),
  factory: () => (
    <>
      {p("M1.5 14.5V7l4 -2.5V7l4-2.5V7l3-2V1.5h2v13z", GRY)}
      {f(3, 10, 2, 2, YEL)}
      {f(7, 10, 2, 2, YEL)}
      {f(11, 10, 2, 2, YEL)}
    </>
  ),
  wand: () => (
    <>
      {p("M2 14l8-8", "none", K, 2.4)}
      {p("M2 14l8-8", "none", W, 1)}
      {p("M12 1l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z", GOLD)}
      {f(5, 2, 1, 1, "#ff00ff")}
      {f(14, 9, 1, 1, "#00c0ff")}
    </>
  ),
  database: () => (
    <>
      {p("M2.5 3.5c0-2 11-2 11 0v9c0 2-11 2-11 0z", "#7fdfdf")}
      {p("M2.5 3.5c0 2 11 2 11 0M2.5 7c0 2 11 2 11 0M2.5 10c0 2 11 2 11 0", "none")}
    </>
  ),
  report: () => (
    <>
      {p("M2.5 1.5h11v13h-11z", W)}
      {f(4, 3, 8, 2, NAVY)}
      {f(4, 7, 3, 1, K)}
      {f(8, 7, 4, 1, DGRY)}
      {f(4, 9, 3, 1, K)}
      {f(8, 9, 4, 1, DGRY)}
      {f(4, 11, 3, 1, K)}
      {f(8, 11, 4, 1, DGRY)}
    </>
  ),
  script: () => (
    <>
      {r(1, 2, 14, 12, K)}
      {p("M3 5l2.5 2L3 9", "none", LIME, 1.3)}
      {f(7, 9, 5, 1, LIME)}
    </>
  ),
  flag: () => (
    <>
      {f(2, 1, 1, 14, K)}
      {p("M3 1.5h10l-2 3 2 3H3z", RED)}
    </>
  ),
  // shell and toolbar
  folder: () => p("M1.5 3.5h5l1.5 1.5h6.5v9h-13z", GOLD),
  folderOpen: () => (
    <>
      {p("M1.5 3.5h5l1.5 1.5h5.5v2", GOLD)}
      {p("M1.5 3.5v11h11l3-7.5h-11z", "#ffe680")}
    </>
  ),
  new: () => (
    <>
      {p("M3.5 1.5h6l3 3v10h-9z", W)}
      {p("M12 0.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z", GOLD)}
    </>
  ),
  open: () => (
    <>
      {p("M1.5 3.5h5l1.5 1.5h5.5v2", GOLD)}
      {p("M1.5 3.5v11h11l3-7.5h-11z", "#ffe680")}
    </>
  ),
  save: () => (
    <>
      {r(1, 1, 14, 14, NAVY)}
      {r(4, 1, 8, 6, W)}
      {r(4, 10, 8, 5, GRY)}
      {f(9, 2, 2, 4, NAVY)}
    </>
  ),
  delete: () => p("M3 4l2 0 3 3 3-3h2v2l-3 3 3 3v2h-2l-3-3-3 3H3v-2l3-3-3-3z", RED),
  print: () => (
    <>
      {r(4, 1, 8, 5, W)}
      {r(1, 5, 14, 7, GRY)}
      {r(4, 10, 8, 5, W)}
      {f(12, 7, 2, 1, LIME)}
    </>
  ),
  search: () => (
    <>
      {p("M6.5 1.5a5 5 0 1 1 0 10a5 5 0 1 1 0-10z", "#d8f0ff")}
      {p("M10 10l4.5 4.5", "none", K, 2.4)}
    </>
  ),
  bell: () => (
    <>
      {p("M8 1.5c3 0 4.5 2.5 4.5 5.5v3l1.5 2H2l1.5-2V7c0-3 1.5-5.5 4.5-5.5z", GOLD)}
      {p("M6.5 13.5a1.5 1.5 0 0 0 3 0", K)}
    </>
  ),
  sync: () => (
    <>
      {p("M13 6.5A5.5 5.5 0 0 0 3 5", "none", GRN, 2)}
      {p("M1.5 2.5v4h4", "none", GRN, 2)}
      {p("M3 9.5A5.5 5.5 0 0 0 13 11", "none", NAVY, 2)}
      {p("M14.5 13.5v-4h-4", "none", NAVY, 2)}
    </>
  ),
  home: () => (
    <>
      {p("M1.5 8L8 2l6.5 6", "none", K, 1.4)}
      {p("M3.5 7.5v7h9v-7", "#ffe0b0")}
      {r(6, 10, 4, 5, RED)}
    </>
  ),
  link: () => (
    <>
      {p("M6 10L10 6", "none", K, 1.5)}
      {p("M7 4.5l1.5-1.5a2.5 2.5 0 0 1 3.5 3.5L10.5 8", "none", NAVY, 2)}
      {p("M9 11.5l-1.5 1.5a2.5 2.5 0 0 1-3.5-3.5L5.5 8", "none", NAVY, 2)}
    </>
  ),
  mail: () => (
    <>
      {r(1, 3, 14, 10, W)}
      {p("M1.5 3.5L8 9l6.5-5.5", "none")}
    </>
  ),
  back: () => p("M7 2.5L1.5 8 7 13.5V10h7.5V6H7z", GRN),
  help: () => (
    <>
      {p("M8 1.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13z", NAVY)}
      <text x="8" y="12" fontSize="10" textAnchor="middle" fill={W} fontFamily="serif" fontWeight="bold">?</text>
    </>
  ),
  people: () => (
    <>
      {p("M5 2.5a2.3 2.3 0 1 1 0 4.6a2.3 2.3 0 1 1 0-4.6z", "#ffd0a0")}
      {p("M11 2.5a2.3 2.3 0 1 1 0 4.6a2.3 2.3 0 1 1 0-4.6z", "#ffd0a0")}
      {p("M1 13.5c0-3 1.7-5 4-5s4 2 4 5z", TEAL)}
      {p("M7 13.5c0-3 1.7-5 4-5s4 2 4 5z", RED)}
    </>
  ),
  appward: () => (
    <>
      {r(0, 0, 16, 16, TEAL)}
      {p("M3 13L7 3h2l4 10h-2.4l-.9-2.5H6.3L5.4 13zM7 8.6h2.2L8 5.3z", W, K, 0.8)}
    </>
  ),
}

// the category folders in the App Launcher use these
export const CATEGORY_ICONS = {
  Productivity: "check",
  Sales: "funnel",
  People: "people",
  Operations: "gear",
  Quality: "ribbon",
  Manufacturing: "factory",
  Development: "wand",
}

export const Icon = ({ name, size = 16, className = "", title }) => {
  const glyph = GLYPHS[name] || GLYPHS.doc
  return (
    <svg className={`awIcon ${className}`} viewBox="0 0 16 16" width={size} height={size} aria-hidden={title ? undefined : "true"} role={title ? "img" : undefined} shapeRendering="crispEdges">
      {title && <title>{title}</title>}
      {glyph()}
    </svg>
  )
}

export const ICON_NAMES = Object.keys(GLYPHS)
