import React, { Suspense } from "react"
import SaverCanvas from "./SaverCanvas"
import createStarfield from "./savers/starfield"
import createMystify, { createBeziers } from "./savers/mystify"
import createFlying from "./savers/flying"
import createMarquee from "./savers/marquee"

// Each screensaver: its default options, the fields its Settings... dialog shows, and a
// component that draws it to fill its parent ({ settings, preview }).
// Field types: range (min, max), select (choices: [value, label]), text, color.

const make = (create) => {
  const Saver = ({ settings, preview }) => <SaverCanvas create={create} settings={settings} preview={preview} />
  return Saver
}

// 3D Pipes needs three.js, a big download: fetch it only when pipes actually run
const LazyPipes = React.lazy(() => import("./savers/pipes").then((m) => ({ default: make(m.default) })))
const Pipes = (props) => (
  <Suspense fallback={<div className="ssFill" />}>
    <LazyPipes {...props} />
  </Suspense>
)

const speed = { key: "speed", label: "Speed", type: "range", min: 1, max: 10, low: "Slow", high: "Fast" }

export const SCREENSAVERS = [
  {
    id: "pipes",
    label: "3D Pipes",
    defaults: { joints: "balls", speed: 5 },
    fields: [
      { key: "joints", label: "Joint type", type: "select", choices: [["balls", "Ball joints"], ["mixed", "Mixed (balls and elbows)"]] },
      speed,
    ],
    Component: Pipes,
  },
  {
    id: "starfield",
    label: "Starfield Simulation",
    defaults: { speed: 5, density: 5 },
    fields: [speed, { key: "density", label: "Starfield density", type: "range", min: 1, max: 10, low: "Few", high: "Many" }],
    Component: make(createStarfield),
  },
  {
    id: "mystify",
    label: "Mystify Your Mind",
    defaults: { shapes: 2, lines: 8 },
    fields: [
      { key: "shapes", label: "Shapes", type: "range", min: 1, max: 4, low: "1", high: "4" },
      { key: "lines", label: "Lines per shape", type: "range", min: 1, max: 25, low: "Few", high: "Many" },
    ],
    Component: make(createMystify),
  },
  {
    id: "flying",
    label: "Flying 98ish",
    defaults: { speed: 5, count: 20 },
    fields: [speed, { key: "count", label: "Number of flags", type: "range", min: 3, max: 60, low: "Few", high: "Many" }],
    Component: make(createFlying),
  },
  {
    id: "marquee",
    label: "Scrolling Marquee",
    defaults: { text: "Welcome to 98ish", speed: 5, color: "#ffff00", background: "#000000", position: "center", font: "serif" },
    fields: [
      { key: "text", label: "Text", type: "text", maxLength: 200 },
      speed,
      { key: "position", label: "Position", type: "select", choices: [["center", "Centered"], ["random", "Random"]] },
      { key: "font", label: "Font", type: "select", choices: [["serif", "Times New Roman"], ["sans", "Arial"], ["mono", "Courier New"]] },
      { key: "color", label: "Text color", type: "color" },
      { key: "background", label: "Background color", type: "color" },
    ],
    Component: make(createMarquee),
  },
  {
    id: "beziers",
    label: "Beziers",
    defaults: { curves: 2, length: 12, speed: 5 },
    fields: [
      { key: "curves", label: "Curves", type: "range", min: 1, max: 4, low: "1", high: "4" },
      { key: "length", label: "Trail length", type: "range", min: 2, max: 30, low: "Short", high: "Long" },
      speed,
    ],
    Component: make(createBeziers),
  },
]

export const saverById = (id) => SCREENSAVERS.find((s) => s.id === id) || null

// a screensaver's options: its defaults with whatever was saved on top
export const optionsFor = (id, saved) => {
  const saver = saverById(id)
  return saver ? { ...saver.defaults, ...(saved?.[id] || {}) } : {}
}
