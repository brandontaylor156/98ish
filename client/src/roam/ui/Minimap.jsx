// Roam's minimap: a small round map in the top corner (phone-safe, no touches: drags pass
// through to the controls under it). The roads round you from the world (world.mapView),
// turned so the way the camera looks is up, an N on the rim, you as an arrow in the middle,
// friends as blue dots and passing cars as grey ones. Drawn 5 times a second.

import React, { useEffect, useRef } from "react"

const RANGE = 150 // metres from the middle to the rim

export function Minimap({ world, size = 92 }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!world?.mapView) return undefined
    const draw = () => {
      const cv = ref.current
      if (!cv) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const px = Math.round(size * dpr)
      if (cv.width !== px) cv.width = cv.height = px
      const g = cv.getContext("2d")
      if (!g) return
      const v = world.mapView(RANGE)
      const R = px / 2
      const k = R / RANGE
      g.clearRect(0, 0, px, px)
      g.save()
      g.beginPath()
      g.arc(R, R, R - 1, 0, Math.PI * 2)
      g.fillStyle = "rgba(38, 44, 40, 0.78)"
      g.fill()
      g.clip()
      // (the view up: a town point (x, z) relative to you, turned by the camera's yaw)
      const c = Math.cos(v.view)
      const s = Math.sin(v.view)
      const to = (x, z) => {
        const dx = x - v.x
        const dz = z - v.z
        // (ahead (sin yaw, cos yaw) maps to up; the camera's right to the right)
        const ahead = dx * s + dz * c
        const right = -(dx * c - dz * s)
        return [R + right * k, R - ahead * k]
      }
      g.lineCap = "round"
      g.lineJoin = "round"
      for (const pass of [0, 1]) {
        for (const r of v.roads) {
          g.beginPath()
          r.pts.forEach((p, i) => {
            const [x, y] = to(p.x, p.z)
            if (i) g.lineTo(x, y)
            else g.moveTo(x, y)
          })
          g.lineWidth = Math.max(pass ? 1.2 : 2.4, r.w * k * (pass ? 0.75 : 1)) * (pass ? 1 : 1)
          g.strokeStyle = pass ? (r.big ? "#e8e2c8" : "#bdbab0") : "rgba(0,0,0,0.35)"
          g.stroke()
        }
      }
      for (const t of v.traffic || []) {
        const [x, y] = to(t.x, t.z)
        g.fillStyle = "#9aa0a6"
        g.fillRect(x - 1.5 * dpr, y - 1.5 * dpr, 3 * dpr, 3 * dpr)
      }
      for (const p of v.people || []) {
        const [x, y] = to(p.x, p.z)
        g.beginPath()
        g.arc(x, y, 3.2 * dpr, 0, Math.PI * 2)
        g.fillStyle = "#4aa3ff"
        g.fill()
      }
      g.restore()
      // you: an arrow the way you face
      const a = v.yaw - v.view
      g.save()
      g.translate(R, R)
      g.rotate(-a)
      g.beginPath()
      g.moveTo(0, -7 * dpr)
      g.lineTo(5 * dpr, 6 * dpr)
      g.lineTo(0, 3 * dpr)
      g.lineTo(-5 * dpr, 6 * dpr)
      g.closePath()
      g.fillStyle = "#ffd23a"
      g.strokeStyle = "#000"
      g.lineWidth = dpr
      g.fill()
      g.stroke()
      g.restore()
      // N on the rim (north is -z)
      const [nx, ny] = (() => {
        const ahead = -c
        const right = -s
        const l = Math.hypot(ahead, right) || 1
        return [R + (right / l) * (R - 9 * dpr), R - (ahead / l) * (R - 9 * dpr)]
      })()
      g.font = `bold ${10 * dpr}px Tahoma, Verdana, sans-serif`
      g.textAlign = "center"
      g.textBaseline = "middle"
      g.fillStyle = "#fff"
      g.strokeStyle = "rgba(0,0,0,0.8)"
      g.lineWidth = 2.5 * dpr
      g.strokeText("N", nx, ny)
      g.fillText("N", nx, ny)
      g.beginPath()
      g.arc(R, R, R - 1, 0, Math.PI * 2)
      g.strokeStyle = "rgba(0,0,0,0.75)"
      g.lineWidth = 1.5 * dpr
      g.stroke()
    }
    draw()
    const id = setInterval(draw, 200)
    return () => clearInterval(id)
  }, [world, size])
  return <canvas ref={ref} className="roamMap" style={{ width: size, height: size }} aria-hidden="true" data-roam="map" />
}
