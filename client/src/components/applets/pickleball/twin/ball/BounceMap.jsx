// Real Ball: every measured bounce on a court seen from above (the net across the middle,
// the camera's half at the bottom): green in, red out, grey not called.

import React, { useEffect, useRef } from "react"
import { HALF_L, HALF_W, KITCHEN } from "../../physics.js"

export const BounceMap = ({ bounces = [], width = 110 }) => {
  const ref = useRef(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const pad = 8
    const k = (width - pad * 2) / (HALF_W * 2)
    c.width = width
    c.height = Math.round(HALF_L * 2 * k + pad * 2)
    const g = c.getContext("2d")
    const X = (x) => pad + (x + HALF_W) * k
    const Z = (z) => pad + (z + HALF_L) * k
    g.fillStyle = "#3a6a3a"
    g.fillRect(0, 0, c.width, c.height)
    g.fillStyle = "#2f62ad"
    g.fillRect(X(-HALF_W), Z(-HALF_L), HALF_W * 2 * k, HALF_L * 2 * k)
    g.strokeStyle = "#fff"
    g.lineWidth = 1
    g.strokeRect(X(-HALF_W) + 0.5, Z(-HALF_L) + 0.5, HALF_W * 2 * k, HALF_L * 2 * k)
    g.beginPath()
    for (const z of [-KITCHEN, KITCHEN]) {
      g.moveTo(X(-HALF_W), Z(z))
      g.lineTo(X(HALF_W), Z(z))
    }
    // the centerlines (baseline to kitchen line)
    g.moveTo(X(0), Z(-HALF_L))
    g.lineTo(X(0), Z(-KITCHEN))
    g.moveTo(X(0), Z(KITCHEN))
    g.lineTo(X(0), Z(HALF_L))
    g.stroke()
    g.strokeStyle = "#ddd"
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(X(-HALF_W) - 3, Z(0))
    g.lineTo(X(HALF_W) + 3, Z(0))
    g.stroke()
    for (const b of bounces) {
      g.fillStyle = b.call === "out" ? "#ff4d4d" : b.call === "in" ? "#46e07a" : "#d8d8d8"
      g.beginPath()
      g.arc(X(b.x), Z(b.z), 2.6, 0, Math.PI * 2)
      g.fill()
    }
  }, [bounces, width])
  return <canvas ref={ref} className="pkTwinBounces" aria-label="Where the ball bounced (the net across the middle)" />
}
