import React from "react"
import { receiverSpot, serverSpot } from "./scoring"

// The court from above for the scorekeeper: who stands where, who serves (the ball) and who
// receives (diagonally across). Team `bottom` is at the near end, facing up; the far team
// faces down, so its right-hand court is on the screen's left.
//   state: scoring.js state; names: [[a, b], [c, d]]; bottom: 0 | 1 (which team is near)

const W = 200
const H = 300
const KITCHEN = 46 // the non-volley zone, drawn a little deeper than to scale so names fit

const CourtDiagram = ({ state, names, bottom = 0, colors = ["#1f5fbf", "#c0392b"] }) => {
  const srv = serverSpot(state)
  const rcv = receiverSpot(state)
  const top = 1 - bottom
  const doubles = state.cfg.format === "doubles"
  // a box's rectangle: team, side ("right" | "left")
  const box = (team, side) => {
    const near = team === bottom
    const leftHalf = near ? side === "left" : side === "right"
    const x = leftHalf ? 10 : W / 2
    const y = near ? H / 2 + KITCHEN : 10
    return { x, y, w: W / 2 - 10, h: H / 2 - KITCHEN - 10 }
  }
  const who = (team, side) => {
    // singles: each player stands where this rally's serve goes from / to
    if (!doubles) return side === (team === srv.team ? srv.side : rcv.side) ? names[team][0] : ""
    const i = state.pos[team][side === "right" ? 0 : 1]
    return names[team][i] || ""
  }
  const center = (b) => ({ cx: b.x + b.w / 2, cy: b.y + b.h / 2 })
  const sb = box(srv.team, srv.side)
  const rb = box(rcv.team, rcv.side)
  const s = center(sb)
  const r = center(rb)
  const boxes = []
  for (const team of [top, bottom]) {
    for (const side of ["left", "right"]) {
      const b = box(team, side)
      const isServer = team === srv.team && side === srv.side
      const isReceiver = team === rcv.team && side === rcv.side
      const name = who(team, side)
      boxes.push(
        <g key={`${team}${side}`} data-box={`${team}-${side}`}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={isServer ? "#fff6b0" : isReceiver ? "#e6f0ff" : "transparent"} stroke="none" />
          {name && (
            <>
              {/* a white name tag so it reads on the court's blue */}
              <rect x={b.x + 4} y={b.y + b.h / 2 - 10} width={b.w - 8} height="19" rx="3" fill="#fff" stroke={colors[team]} strokeWidth={isServer ? 2 : 1} />
              <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 4} textAnchor="middle" fontSize="12" fontWeight={isServer ? "bold" : "normal"} fill={colors[team]}>
                {name.length > 11 ? `${name.slice(0, 10)}…` : name}
              </text>
            </>
          )}
        </g>
      )
    }
  }
  return (
    <svg className="pbCourt" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${names[srv.team][srv.player] || "Server"} serves from the ${srv.side}`} data-server={`${srv.team}-${srv.side}`}>
      <rect x="0" y="0" width={W} height={H} fill="#3d7a4a" />
      <rect x="10" y="10" width={W - 20} height={H - 20} fill="#2f6fb3" stroke="#fff" strokeWidth="2" />
      {/* kitchens */}
      <rect x="10" y={H / 2 - KITCHEN} width={W - 20} height={KITCHEN * 2} fill="#5b93cf" stroke="#fff" strokeWidth="2" />
      {/* center lines (service courts only) */}
      <line x1={W / 2} y1="10" x2={W / 2} y2={H / 2 - KITCHEN} stroke="#fff" strokeWidth="2" />
      <line x1={W / 2} y1={H / 2 + KITCHEN} x2={W / 2} y2={H - 10} stroke="#fff" strokeWidth="2" />
      {boxes}
      {/* the net */}
      <line x1="4" y1={H / 2} x2={W - 4} y2={H / 2} stroke="#222" strokeWidth="3" />
      {/* the serve, diagonally */}
      <line x1={s.cx} y1={s.cy + (srv.team === bottom ? -14 : 14)} x2={r.cx} y2={r.cy + (rcv.team === bottom ? -14 : 14)} stroke="#ffe14d" strokeWidth="2" strokeDasharray="5 4" />
      <circle cx={s.cx} cy={s.cy + (srv.team === bottom ? 24 : -24)} r="6" fill="#d7ff3a" stroke="#555" />
    </svg>
  )
}

export default CourtDiagram
