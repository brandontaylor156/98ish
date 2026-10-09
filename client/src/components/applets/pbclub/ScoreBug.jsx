import React from "react"
import "./ScoreBug.css"

// the broadcast-style score bug: the event over two team rows with the scores in a block, the
// round under them (our own look; no event or broadcaster marks)
export const ScoreBug = ({ title, a, b, sa = "", sb = "", round, win = null, mine = null, compact = false, serving = null, serveNumber = "", call = null }) => (
  <div className={`tnBug${compact ? " is-compact" : ""}`} data-bug>
    {title && <div className="tnBugTitle">{title}</div>}
    <div className={`tnBugRow${win === "a" ? " is-win" : ""}${mine === "a" ? " is-mine" : ""}`}>
      <span className="tnBugName">
        {serving === "a" && <i className="tnBugServe" aria-label="serving">{serveNumber}</i>}
        {a}
      </span>
      <span className="tnBugScore">{sa}</span>
    </div>
    <div className={`tnBugRow${win === "b" ? " is-win" : ""}${mine === "b" ? " is-mine" : ""}`}>
      <span className="tnBugName">
        {serving === "b" && <i className="tnBugServe" aria-label="serving">{serveNumber}</i>}
        {b}
      </span>
      <span className="tnBugScore">{sb}</span>
    </div>
    {round && (
      <div className="tnBugRound">
        {round}
        {call ? <span className="tnBugCall"> · {call}</span> : null}
      </div>
    )}
  </div>
)
