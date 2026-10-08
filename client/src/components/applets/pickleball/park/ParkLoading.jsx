import React from "react"

// My Park's loading screen: a 98 progress window over the stage while a venue is built.
// The heavy steps (building the venue, compiling its shaders) block the page for a moment,
// so the bar's moving blocks are a CSS transform animation: the compositor keeps it moving
// even while JavaScript is busy, and the window never looks frozen.
//   step: { label, pct } (pct 0-100), venue: the place's name, credit: the map credit for a venue
//   built from OpenStreetMap (ODbL asks for it wherever the data shows)
const TIPS = [
  "Walk up to a court's paddle rack to call next.",
  "Tap a game in progress to watch it.",
  "Star a venue in the list to keep it at the top.",
  "Real Games keeps score of the games you play in real life.",
  "Turn on Voice in the menu to hear friends where they stand.",
]

export default function ParkLoading({ venue, step, credit }) {
  const pct = Math.max(4, Math.min(100, Math.round(step?.pct ?? 5)))
  const tip = TIPS[(venue || "").length % TIPS.length]
  return (
    <div className="pkCenter pkDim pkParkLoad" data-park="loading" role="status" aria-live="polite">
      <div className="window pkParkLoadWin">
        <div className="title-bar">
          <div className="title-bar-text">Loading My Park</div>
        </div>
        <div className="window-body">
          <p className="pkParkLoadWhere">
            <b>{venue || "The park"}</b>
          </p>
          <p className="pkParkLoadStep">{step?.label || "Getting ready"}...</p>
          <div className="pkParkLoadBar" aria-label={`${pct}%`}>
            <div className="pkParkLoadFill" style={{ width: `${pct}%` }} />
            <div className="pkParkLoadRun" />
          </div>
          <p className="pkParkLoadTip">Tip: {tip}</p>
          {credit && (
            <p className="pkParkLoadCredit" data-park="loading-credit">
              {credit}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
