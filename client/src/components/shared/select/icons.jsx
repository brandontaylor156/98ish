import React from "react"

// Windows 98's small black arrow, drawn in pixels (the text arrows render as emoji on iPhone)
const PATHS = {
  left: "M4 0h1v7H4V6H3V5H2V4H1V3h1V2h1V1h1z",
  right: "M0 0h1v1h1v1h1v1h1v1H3v1H2v1H1v1H0z",
  up: "M3 0h1v1h1v1h1v1h1v1H0V3h1V2h1V1h1z",
  down: "M0 0h7v1H6v1H5v1H4v1H3V3H2V2H1V1H0z",
}

export const Arrow = ({ dir = "down" }) => {
  const wide = dir === "up" || dir === "down"
  return (
    <svg className="selArrow" width={wide ? 7 : 5} height={wide ? 4 : 7} viewBox={wide ? "0 0 7 4" : "0 0 5 7"} aria-hidden="true" shapeRendering="crispEdges">
      <path d={PATHS[dir]} fill="currentColor" />
    </svg>
  )
}
