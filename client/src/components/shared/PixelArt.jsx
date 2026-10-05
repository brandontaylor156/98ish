import React, { memo } from "react"
import { rows } from "../../utils/pixelArt"

// A pixel-art drawing (utils/pixelArt.js) as crisp SVG squares: Weather's icons, the Do
// Not Disturb moon.
const PixelArt = memo(({ art, size = 32, label, className }) => (
  <svg
    viewBox={`0 0 ${art.w} ${art.h}`}
    width={size}
    height={size}
    shapeRendering="crispEdges"
    className={className}
    role={label ? "img" : undefined}
    aria-label={label || undefined}
    aria-hidden={label ? undefined : "true"}
  >
    {rows(art).map((r) => (
      <rect key={`${r.x},${r.y}`} x={r.x} y={r.y} width={r.w} height="1.02" fill={r.color} />
    ))}
  </svg>
))

export default PixelArt
