import React from "react"
import { coopById } from "./coop.js"

// Drilling with a friend online: what you're drilling, the streak you're on together, the best
// one, and a word on the last shot (practice/coop.js reports; the host sends it to the guest)
export const CoopHud = ({ snap, drill, partner }) => {
  const d = coopById(snap?.drill || drill)
  return (
    <div className="pkCoopHud" data-coop-hud aria-live="polite">
      <div className="pkCoopTop">
        <b>{d.name}</b>
        {partner ? <span> with {partner}</span> : null}
      </div>
      <div className="pkCoopNums">
        <span>
          Streak <b data-coop-streak>{snap?.streak || 0}</b>
        </span>
        <span>
          Best <b data-coop-best>{snap?.best || 0}</b>
        </span>
        <span>
          Rallies <b>{snap?.rallies || 0}</b>
        </span>
      </div>
      {snap?.label ? <div className={`pkCoopWord is-${snap.tone || "good"}`}>{snap.label}</div> : <div className="pkCoopWord">{d.goal}</div>}
    </div>
  )
}

// a report from the other browser: numbers and a short word only
export const cleanCoopSnap = (s) => {
  if (!s || typeof s !== "object") return null
  const n = (v) => (Number.isFinite(v) && v >= 0 && v < 1e6 ? Math.floor(v) : 0)
  return { drill: typeof s.drill === "string" ? s.drill.slice(0, 12) : "dinks", streak: n(s.streak), best: n(s.best), good: n(s.good), rallies: n(s.rallies), label: typeof s.label === "string" ? s.label.slice(0, 60) : null, tone: s.tone === "warn" ? "warn" : "good", seq: n(s.seq) }
}
