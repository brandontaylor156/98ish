import React from "react"

// Pixel-art glyphs for the keyboard, drawn row by row ("#" = a pixel) so they stay crisp

const path = (rows, ch = "#") =>
  rows.flatMap((row, y) => [...row].map((c, x) => (c === ch ? `M${x} ${y}h1v1h-1z` : ""))).join("")

const Pixels = ({ rows, className = "kb98Icon", layers }) => {
  const w = rows[0].length
  const h = rows.length
  return (
    <svg className={className} width={w} height={h} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {layers ? layers.map(([ch, fill]) => <path key={ch} d={path(rows, ch)} fill={fill} />) : <path d={path(rows)} fill="currentColor" />}
    </svg>
  )
}

const SHIFT = [
  "......#......",
  ".....#.#.....",
  "....#...#....",
  "...#.....#...",
  "..#.......#..",
  ".#.........#.",
  "####.....####",
  "...#.....#...",
  "...#.....#...",
  "...#.....#...",
  "...#.....#...",
  "...#######...",
]

const SHIFT_ON = [
  "......#......",
  ".....###.....",
  "....#####....",
  "...#######...",
  "..#########..",
  ".###########.",
  "#############",
  "...#######...",
  "...#######...",
  "...#######...",
  "...#######...",
  "...#######...",
]

// Caps Lock: the filled arrow over a bar, as iOS marks it
const SHIFT_LOCK = [...SHIFT_ON.slice(0, 10), ".............", "...#######..."]

// a hollow up arrow, filled while Shift is on, with a bar under it for Caps Lock
export const ShiftIcon = ({ filled, lock }) => <Pixels rows={lock ? SHIFT_LOCK : filled ? SHIFT_ON : SHIFT} />

// Backspace: a long arrow pointing left
export const BackIcon = () => (
  <Pixels
    rows={[
      "....#.............",
      "...##.............",
      "..###.............",
      ".################.",
      "#################.",
      ".################.",
      "..###.............",
      "...##.............",
      "....#.............",
    ]}
  />
)

// Enter: down, then left
export const EnterIcon = () => (
  <Pixels
    className="kb98Icon kb98Icon--enter"
    rows={[
      "...........##",
      "...........##",
      "....#......##",
      "...##......##",
      "..###......##",
      ".#############",
      "##############",
      ".#############",
      "..###.........",
      "...##.........",
      "....#.........",
    ].map((r) => r.padEnd(14, "."))}
  />
)

// the title bar's little keyboard
export const KeyboardIcon = () => (
  <Pixels
    className="kb98TitleIcon"
    layers={[
      ["k", "#000"],
      ["w", "#fff"],
      ["g", "#c0c0c0"],
      ["d", "#808080"],
    ]}
    rows={[
      "................",
      ".......kk.......",
      "........k.......",
      "........k.......",
      "kkkkkkkkkkkkkkkk",
      "kwwwwwwwwwwwwwdk",
      "kwgkgkgkgkgkkgdk",
      "kwggggggggggggdk",
      "kwgkgkgkgkgkkgdk",
      "kwggggggggggggdk",
      "kwgkkkkkkkkkkgdk",
      "kwdddddddddddddk",
      "kkkkkkkkkkkkkkkk",
      "................",
      "................",
      "................",
    ]}
  />
)

// a little phone: use the phone's own keyboard
export const PhoneIcon = () => (
  <Pixels
    className="kb98PhoneIcon"
    layers={[
      ["k", "#000"],
      ["s", "#008080"],
      ["w", "#fff"],
    ]}
    rows={[
      ".kkkkkk.",
      "kwwwwwwk",
      "kssssssk",
      "kssssssk",
      "kssssssk",
      "kssssssk",
      "kssssssk",
      "kwwwwwwk",
      "kwwkkwwk",
      "kwwwwwwk",
      ".kkkkkk.",
    ]}
  />
)
