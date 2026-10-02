import React from "react"

// Classic Minesweeper art, drawn in SVG so it stays crisp at any cell size

export const MineIcon = ({ crossed }) => (
  <svg className="msIcon" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
    <path d="M7 1h1v2h-1zM7 12h1v2h-1zM1 7h2v1h-2zM12 7h2v1h-2zM3 3h1v1h-1zM11 3h1v1h-1zM3 11h1v1h-1zM11 11h1v1h-1z" fill="#000" />
    <path d="M5 3h5v1h1v1h1v5h-1v1h-1v1h-5v-1h-1v-1h-1v-5h1v-1h1z" fill="#000" />
    <rect x="5" y="5" width="2" height="2" fill="#fff" />
    {crossed && <path d="M2 2l12 12M14 2l-12 12" stroke="#f00" strokeWidth="1.6" shapeRendering="auto" />}
  </svg>
)

export const FlagIcon = () => (
  <svg className="msIcon" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
    <path d="M7 2h2v6h-2zM5 4h2v3h-2zM3 5h2v1h-2z" fill="#f00" />
    <rect x="8" y="8" width="1" height="3" fill="#000" />
    <path d="M6 11h5v1h1v1h-7v-1h1z" fill="#000" />
    <rect x="4" y="12" width="9" height="1" fill="#000" />
  </svg>
)

// face: "smile" | "oh" (holding a cell down) | "dead" | "cool" (won)
export const Face = ({ face }) => (
  <svg className="msFace" viewBox="0 0 17 17" aria-hidden="true">
    <circle cx="8.5" cy="8.5" r="7.5" fill="#ff0" stroke="#000" strokeWidth="1" />
    {face === "dead" ? (
      <g stroke="#000" strokeWidth="1" strokeLinecap="square">
        <path d="M4.5 4.5l2 2M6.5 4.5l-2 2M10.5 4.5l2 2M12.5 4.5l-2 2" />
        <path d="M5.5 12.5q3-3 6 0" fill="none" />
      </g>
    ) : face === "cool" ? (
      <g>
        <path d="M2.5 5.5h12M3.5 5.5l1 2h2.5l1-2M9 5.5l1 2h2.5l1-2" stroke="#000" strokeWidth="1.2" fill="#000" />
        <path d="M5.5 11q3 2.5 6 0" stroke="#000" strokeWidth="1" fill="none" />
      </g>
    ) : (
      <g fill="#000">
        <rect x="5" y="5" width="2" height="2" />
        <rect x="10" y="5" width="2" height="2" />
        {face === "oh" ? (
          <ellipse cx="8.5" cy="11.5" rx="1.6" ry="1.9" />
        ) : (
          <path d="M5 10.5q3.5 3.5 7 0" stroke="#000" strokeWidth="1.1" fill="none" />
        )}
      </g>
    )}
  </svg>
)

// Seven-segment digits: segments a b c d e f g
const SEGMENTS = {
  0: "abcdef",
  1: "bc",
  2: "abdeg",
  3: "abcdg",
  4: "bcfg",
  5: "acdfg",
  6: "acdefg",
  7: "abc",
  8: "abcdefg",
  9: "abcdfg",
  "-": "g",
}

const SEGMENT_PATHS = {
  a: "M2 1h7l-1.5 1.5h-4z",
  b: "M9.5 1.5v7l-1.5-1v-4.5z",
  c: "M9.5 10.5v7l-1.5-1.5v-4.5z",
  d: "M2 18h7l-1.5-1.5h-4z",
  e: "M1.5 10.5v7l1.5-1.5v-4.5z",
  f: "M1.5 1.5v7l1.5-1v-4.5z",
  g: "M2.2 9.5l1.3-1h4l1.3 1-1.3 1h-4z",
}

const Digit = ({ char, x }) => (
  <g transform={`translate(${x} 0)`}>
    {Object.entries(SEGMENT_PATHS).map(([segment, d]) => (
      <path key={segment} d={d} fill={SEGMENTS[char]?.includes(segment) ? "#f00" : "#400000"} />
    ))}
  </g>
)

// Three-digit red LED readout; negative numbers show a minus sign, like the original
export const Led = ({ value, label }) => {
  const n = Math.max(-99, Math.min(999, Math.trunc(value)))
  const text = n < 0 ? "-" + String(-n).padStart(2, "0") : String(n).padStart(3, "0")
  return (
    <svg className="msLed" viewBox="0 0 34 19.5" role="img" aria-label={`${label}: ${n}`}>
      <rect width="34" height="19.5" fill="#000" />
      {[...text].map((char, i) => (
        <Digit key={i} char={char} x={0.5 + i * 11} />
      ))}
    </svg>
  )
}
