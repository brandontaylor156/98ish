import React from "react"
import { stampOffsets } from "./paintLogic"

// Paint's tool pictures, drawn here as 16x16 pixel grids (one letter per pixel) and shown
// as crisp SVG. Original art in the spirit of 1998.

const COLORS = {
  k: "#000000",
  g: "#808080",
  l: "#c0c0c0",
  w: "#ffffff",
  r: "#ff0000",
  y: "#ffff00",
  b: "#0000ff",
  c: "#00c0ff",
  n: "#804000",
  p: "#ff9cc8",
  o: "#e06080",
}

const GRIDS = {
  freeselect: [
    "................",
    ".....kk.k.......",
    "....k.....k.....",
    "...k.......k.k..",
    "..k...........k.",
    "................",
    ".k............k.",
    ".k..............",
    "..k...........k.",
    "...............",
    "...k.........k..",
    "....k.......k...",
    ".....k.k.k.k....",
  ],
  select: [
    "................",
    "................",
    ".kk.kk.kk.kk.kk.",
    ".k.............",
    "...............k",
    ".k.............",
    ".k.............k",
    "...............k",
    ".k.............",
    ".k.............k",
    "...............k",
    ".k.............",
    ".kk.kk.kk.kk.kk.",
  ],
  eraser: [
    "................",
    "................",
    "................",
    ".......kkkkkkkk.",
    "......kwwwwwwkok",
    ".....kwwwwwwkook",
    "....kwwwwwwkoook",
    "...kwwwwwwkooook",
    "..kwwwwwwkoooook",
    ".kkkkkkkkoooook.",
    ".kppppppkooook..",
    ".kppppppkoook...",
    ".kppppppkook....",
    ".kppppppkok.....",
    ".kkkkkkkkk......",
  ],
  fill: [
    "................",
    ".....kk.........",
    "....k..k........",
    "....k..kk.......",
    "....k.kllk......",
    "...kkkwllkk.....",
    "..kwwkwwllkk....",
    ".kwwwwkwwllkb...",
    "kwwwwwwkwlkbbb..",
    ".kwwwwwwkkkbbb..",
    "..kwwwwwwk.bbb..",
    "...kwwwwk..bbb..",
    "....kwwk....b...",
    ".....kk.........",
  ],
  pick: [
    "................",
    "...........kkk..",
    "..........kkkkk.",
    ".........kkkkkk.",
    ".......k.kkkkk..",
    "........kkkkk...",
    ".......kwkkk.k..",
    "......kwwwk.....",
    ".....kwwwk......",
    "....kwwwk.......",
    "...kwwwk........",
    "..kwwwk.........",
    "..kwwk..........",
    ".k.kk...........",
    ".k..............",
  ],
  magnifier: [
    "................",
    "....kkkk........",
    "..kk....kk......",
    "..k.wc....k.....",
    ".k.wc......k....",
    ".k.c.......k....",
    ".k.........k....",
    ".k.........k....",
    "..k.......k.....",
    "..kk....kkk.....",
    "....kkkk.kkk....",
    "..........kkk...",
    "...........kkk..",
    "............kkk.",
    ".............kk.",
  ],
  pencil: [
    "................",
    "............kk..",
    "...........krrk.",
    "..........kyrrk.",
    ".........kyyykk.",
    "........kyyyk...",
    ".......kyyyk....",
    "......kyyyk.....",
    ".....kyyyk......",
    "....kyyyk.......",
    "...kwyyk........",
    "...kwwk.........",
    "..kkkk..........",
    "..kk............",
  ],
  brush: [
    "................",
    ".............kk.",
    "............knnk",
    "...........knnk.",
    "..........knnk..",
    ".........knnk...",
    "........klk.....",
    ".......kllk.....",
    "......kllk......",
    ".....kkkk.......",
    "....kbbk........",
    "...kbbk.........",
    "...kbk..........",
    "..kk............",
    "..k.............",
  ],
  airbrush: [
    "................",
    ".b.b............",
    "..b.b.kk........",
    ".b.b.k..........",
    "..b.b.kkk.......",
    ".b.b...kk.......",
    ".......kkkk.....",
    "......kllllk....",
    "......klwllk....",
    "......klwllk....",
    "......klwllk....",
    "......klwllk....",
    "......klwllk....",
    "......kllllk....",
    ".......kkkk.....",
  ],
  text: [
    "................",
    "................",
    "......kk........",
    "......kk........",
    ".....kkkk.......",
    ".....k.kk.......",
    "....kk..kk......",
    "....k...kk......",
    "...kkkkkkkk.....",
    "...k.....kk.....",
    "..kk......kk....",
    "..k.......kk....",
    ".kkk.....kkkk...",
  ],
  line: [
    "................",
    "................",
    ".k..............",
    "..k.............",
    "...k............",
    "....k...........",
    ".....k..........",
    "......k.........",
    ".......k........",
    "........k.......",
    ".........k......",
    "..........k.....",
    "...........k....",
    "............k...",
    ".............k..",
  ],
  curve: [
    "................",
    "................",
    "..k.............",
    "..k.............",
    "...k............",
    "...k............",
    "....k...........",
    ".....kk.........",
    ".......kk.......",
    ".........k......",
    "..........k.....",
    "...........k....",
    "...........k....",
    "............k...",
    "............k...",
  ],
  rect: [
    "................",
    "................",
    "................",
    ".kkkkkkkkkkkkkk.",
    ".k............k.",
    ".k............k.",
    ".k............k.",
    ".k............k.",
    ".k............k.",
    ".k............k.",
    ".k............k.",
    ".kkkkkkkkkkkkkk.",
  ],
  polygon: [
    "................",
    "................",
    "..kkkkkkk.......",
    "..k......k......",
    "..k.......k.....",
    "..k........k....",
    "..k.........kkk.",
    "..k...........k.",
    "..k...........k.",
    "..k..........k..",
    "..k.........k...",
    "..k........k....",
    "..kkkkkkkkk.....",
  ],
  ellipse: [
    "................",
    "................",
    "................",
    ".....kkkkkk.....",
    "...kk......kk...",
    "..k..........k..",
    ".k............k.",
    ".k............k.",
    ".k............k.",
    ".k............k.",
    "..k..........k..",
    "...kk......kk...",
    ".....kkkkkk.....",
  ],
  roundrect: [
    "................",
    "................",
    "................",
    "...kkkkkkkkkk...",
    "..k..........k..",
    ".k............k.",
    ".k............k.",
    ".k............k.",
    ".k............k.",
    ".k............k.",
    "..k..........k..",
    "...kkkkkkkkkk...",
  ],
}

// A pixel grid as SVG rects (one per run of a color)
const PixelArt = ({ rows, size = 16, className }) => {
  const rects = []
  rows.forEach((line, y) => {
    let x = 0
    while (x < size) {
      const ch = line[x]
      if (!ch || ch === "." || !COLORS[ch]) {
        x++
        continue
      }
      let end = x + 1
      while (line[end] === ch) end++
      rects.push(<rect key={`${x},${y}`} x={x} y={y} width={end - x} height="1" fill={COLORS[ch]} />)
      x = end
    }
  })
  return (
    <svg className={className} viewBox={`0 0 ${size} ${size}`} width={size} height={size} shapeRendering="crispEdges" aria-hidden="true">
      {rects}
    </svg>
  )
}

export const ToolIcon = ({ tool }) => <PixelArt rows={GRIDS[tool] || []} className="pToolIcon" />

// ---- the options box under the tool box ----

const Pixels = ({ cells, width, height, color = "currentColor" }) => (
  <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} shapeRendering="crispEdges" aria-hidden="true">
    {cells.map(([x, y], i) => (
      <rect key={i} x={x} y={y} width="1" height="1" fill={color} />
    ))}
  </svg>
)

// one brush shape, as it would print
export const BrushSample = ({ shape, size }) => {
  const box = 9
  const o = Math.floor(box / 2)
  return <Pixels cells={stampOffsets(shape, size).map(([dx, dy]) => [dx + o, dy + o])} width={box} height={box} />
}

export const EraserSample = ({ size }) => (
  <svg viewBox="0 0 12 12" width="12" height="12" shapeRendering="crispEdges" aria-hidden="true">
    <rect x={(12 - size) / 2} y={(12 - size) / 2} width={size} height={size} fill="currentColor" />
  </svg>
)

export const SpraySample = ({ radius }) => {
  // a fixed sprinkle so the picture doesn't change on every render
  const cells = []
  let seed = radius * 97
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const r = Math.round(radius * 0.8)
  for (let i = 0; i < radius * 3; i++) {
    const a = rand() * Math.PI * 2
    const d = Math.sqrt(rand()) * r
    cells.push([Math.round(r + Math.cos(a) * d), Math.round(r + Math.sin(a) * d)])
  }
  return <Pixels cells={cells} width={r * 2 + 1} height={r * 2 + 1} />
}

export const LineSample = ({ width }) => (
  <svg viewBox="0 0 28 6" width="28" height="6" shapeRendering="crispEdges" aria-hidden="true">
    <rect x="0" y={Math.floor((6 - width) / 2)} width="28" height={width} fill="currentColor" />
  </svg>
)

export const FillSample = ({ style }) => (
  <svg viewBox="0 0 28 10" width="28" height="10" shapeRendering="crispEdges" aria-hidden="true">
    {style !== "fill" && <rect x="0.5" y="0.5" width="27" height="9" fill="none" stroke="currentColor" />}
    {style === "both" && <rect x="1" y="1" width="26" height="8" fill="#808080" />}
    {style === "fill" && <rect x="0" y="0" width="28" height="10" fill="#808080" />}
  </svg>
)

// Draw Opaque / Draw Transparent: a shape over a picture, with or without its background
export const SelectModeSample = ({ transparent }) => (
  <svg viewBox="0 0 28 16" width="28" height="16" shapeRendering="crispEdges" aria-hidden="true">
    <rect x="2" y="4" width="18" height="10" fill="#c0c0c0" />
    <rect x="14" y="1" width="3" height="14" fill="#008000" />
    <rect x="10.5" y="2.5" width="14" height="11" fill={transparent ? "none" : "#ffffff"} stroke="#000080" />
    <circle cx="20" cy="8" r="3" fill="#ff0000" />
  </svg>
)
