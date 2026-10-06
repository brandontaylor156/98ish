import React, { Suspense, useEffect, useState } from "react"
import SaverCanvas from "./SaverCanvas"
import createStarfield from "./savers/starfield"
import createMystify, { createBeziers } from "./savers/mystify"
import createFlying from "./savers/flying"
import createMarquee from "./savers/marquee"
import { DEFAULT_MESSAGES, MAX_MESSAGES, MAX_MESSAGE_LENGTH } from "./savers/lovenotesText"

// Each screensaver: its default options, the fields its Settings... dialog shows, and a
// component that draws it to fill its parent ({ settings, preview }).
// Field types: range (min, max), select (choices: [value, label]), text, textarea, color.

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

// the cozy savers load on first use too, keeping them out of the main download
const lazySaver = (load) => {
  const Lazy = React.lazy(() => load().then((m) => ({ default: make(m.default) })))
  const Saver = (props) => (
    <Suspense fallback={<div className="ssFill" />}>
      <Lazy {...props} />
    </Suspense>
  )
  return Saver
}
const Aquarium = lazySaver(() => import("./savers/aquarium"))
const Garden = lazySaver(() => import("./savers/garden"))
const LoveNotesCanvas = lazySaver(() => import("./savers/lovenotes"))
// Love Notes: with the default lines (you haven't typed your own) and a partner in Us, it
// floats lines from your partner's love letters instead (savers/partnerNotes.js); it waits
// a moment for them so the saver isn't built twice, and keeps the defaults if they can't come
const LoveNotes = ({ settings, preview }) => {
  const own = String(settings?.messages ?? "").trim() && String(settings.messages).trim() !== DEFAULT_MESSAGES
  const [lines, setLines] = useState(own ? "" : null)
  useEffect(() => {
    if (own) return
    let live = true
    const give = (value) => live && setLines((cur) => (cur === null ? value : cur))
    const timer = setTimeout(() => give(""), 3000)
    import("./savers/partnerNotes")
      .then((m) => m.loadPartnerLines())
      .then((got) => give(got?.length ? got.join("\n") : ""))
      .catch(() => give(""))
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [own])
  if (lines === null) return <div className="ssFill" />
  return <LoveNotesCanvas settings={lines ? { ...settings, messages: lines } : settings} preview={preview} />
}

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
  {
    id: "aquarium",
    label: "Aquarium",
    defaults: { count: 16, speed: 5 },
    fields: [{ key: "count", label: "Number of fish", type: "range", min: 4, max: 40, low: "Few", high: "Many" }, speed],
    Component: Aquarium,
  },
  {
    id: "garden",
    label: "Flower Garden",
    defaults: { speed: 5, cycle: "auto" },
    fields: [
      speed,
      { key: "cycle", label: "Sky", type: "select", choices: [["auto", "Day and night"], ["day", "Always day"], ["night", "Always night"]] },
    ],
    Component: Garden,
  },
  {
    id: "lovenotes",
    label: "Love Notes",
    defaults: { messages: DEFAULT_MESSAGES, palette: "pink", background: "#3a2350", speed: 5 },
    fields: [
      { key: "messages", label: "Messages (one per line; leave the defaults to show your partner's love letters)", type: "textarea", rows: 4, maxLength: MAX_MESSAGES * (MAX_MESSAGE_LENGTH + 1) },
      { key: "palette", label: "Hearts", type: "select", choices: [["pink", "Pink"], ["rainbow", "Rainbow"], ["red", "Red"], ["lilac", "Lilac"]] },
      { key: "background", label: "Background color", type: "color" },
      speed,
    ],
    Component: LoveNotes,
  },
]

export const saverById = (id) => SCREENSAVERS.find((s) => s.id === id) || null

// a screensaver's options: its defaults with whatever was saved on top
export const optionsFor = (id, saved) => {
  const saver = saverById(id)
  return saver ? { ...saver.defaults, ...(saved?.[id] || {}) } : {}
}
