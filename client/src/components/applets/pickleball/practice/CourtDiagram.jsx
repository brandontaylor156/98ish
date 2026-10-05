import React from "react"
import { reducedMotion } from "../../../../utils/settings"

// A lesson's little picture: the court from above (their side on top) with the players, the
// ball's path and footwork, played on a 3-second loop (still under Reduce Motion). Data in
// lessons.js (feet: x 0..20, y 0 = their baseline, 22 = the net, 44 = your baseline).

const DUR = 3.2
const COLORS = { you: "#ffd23f", mate: "#9fd8ff", them: "#ff7a5c" }
const HI = {
  kitchen: [0, 29, 20, 7],
  "their-kitchen": [0, 15, 20, 7],
  deep: [0, 0, 20, 6],
  box: [10, 29, 10, 15],
  line: [0, 28.5, 20, 1],
}

export const CourtDiagram = ({ diagram, label }) => {
  if (!diagram) return null
  const still = reducedMotion()
  const ball = diagram.ball || []
  const path = ball.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ")
  const hi = diagram.hi && HI[diagram.hi]
  return (
    <svg className="pkLessonPic" viewBox="-2 -2 24 48" role="img" aria-label={label || "Court diagram"}>
      <defs>
        <marker id="pkArrow" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4" orient="auto">
          <path d="M0 0 L6 3 L0 6 Z" fill="#fff" />
        </marker>
      </defs>
      <rect x="-2" y="-2" width="24" height="48" fill="#3f7f4f" />
      <rect x="0" y="0" width="20" height="44" fill="#2a5d9f" stroke="#fff" strokeWidth="0.3" />
      <rect x="0" y="15" width="20" height="14" fill="#3a74b8" stroke="#fff" strokeWidth="0.3" />
      <line x1="10" y1="0" x2="10" y2="15" stroke="#fff" strokeWidth="0.3" />
      <line x1="10" y1="29" x2="10" y2="44" stroke="#fff" strokeWidth="0.3" />
      {hi && (
        <rect x={hi[0]} y={hi[1]} width={hi[2]} height={hi[3]} fill="#ffd23f" opacity="0.35">
          {!still && <animate attributeName="opacity" values="0.15;0.5;0.15" dur="1.6s" repeatCount="indefinite" />}
        </rect>
      )}
      <line x1="-1" y1="22" x2="21" y2="22" stroke="#fff" strokeWidth="0.7" />
      {(diagram.arrows || []).map(([x1, y1, x2, y2], i) => (
        <line key={`a${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fff" strokeWidth="0.45" strokeDasharray="1 0.6" markerEnd="url(#pkArrow)" opacity="0.85" />
      ))}
      {path && <path d={path} fill="none" stroke="#d9f03c" strokeWidth="0.3" strokeDasharray="0.8 0.6" opacity="0.8" />}
      {ball
        .filter((p) => p[2])
        .map(([x, y], i) => (
          <circle key={`b${i}`} cx={x} cy={y} r="0.9" fill="none" stroke="#d9f03c" strokeWidth="0.25" />
        ))}
      {(diagram.dots || []).map((d, i) => {
        const [x, y] = still && d.to ? d.to : d.at
        return (
          <circle key={`d${i}`} cx={x} cy={y} r="1.3" fill={COLORS[d.who] || "#fff"} stroke="#0b1224" strokeWidth="0.3">
            {!still && d.to && <animate attributeName="cx" values={`${d.at[0]};${d.to[0]};${d.to[0]}`} keyTimes="0;0.7;1" dur={`${DUR}s`} repeatCount="indefinite" />}
            {!still && d.to && <animate attributeName="cy" values={`${d.at[1]};${d.to[1]};${d.to[1]}`} keyTimes="0;0.7;1" dur={`${DUR}s`} repeatCount="indefinite" />}
          </circle>
        )
      })}
      {path && (
        <circle r="0.7" fill="#d9f03c" stroke="#0b1224" strokeWidth="0.2" cx={still ? ball.at(-1)[0] : 0} cy={still ? ball.at(-1)[1] : 0}>
          {!still && <animateMotion path={path} dur={`${DUR}s`} repeatCount="indefinite" />}
        </circle>
      )}
    </svg>
  )
}
