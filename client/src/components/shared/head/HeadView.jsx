import React, { useEffect, useRef, useState } from "react"
import { toRenderMap } from "../../../utils/head/headCore"
import "./HeadView.css"

// Be Yourself: a LAM 3D head (a Gaussian-splat avatar zip) drawn by the LAM renderer
// (gaussian-splat-renderer-for-lam, MIT, vendored at /vendor/lam/ and loaded only when a
// head is shown: ~4 MB, cached by the browser). The renderer keeps one canvas for the page,
// so one head is drawn at a time (one per call, as planned for phones).
//   bytes: the avatar zip (Uint8Array); frame(): { weights: Float32Array(52), yaw, pitch, roll, talking }
//   onState("loading" | "ready" | "error", message?)
let rendererMod = null
// Fetched as text and imported from a blob: URL (Vite's dev server refuses to serve a
// public/ file as a module; the same path works in the built site). Cached by the browser.
const RENDERER_URL = "/vendor/lam/lam-renderer.js"
const loadRenderer = () =>
  (rendererMod ||= fetch(RENDERER_URL)
    .then((r) => {
      if (!r.ok) throw new Error("The 3D head renderer couldn't be downloaded.")
      return r.text()
    })
    .then((src) => {
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }))
      return import(/* @vite-ignore */ url).finally(() => URL.revokeObjectURL(url))
    })
    .catch((e) => {
      rendererMod = null
      throw e
    }))

export default function HeadView({ bytes, frame, className = "", label = "3D head", onState }) {
  const box = useRef(null)
  const holder = useRef(null)
  const frameRef = useRef(frame)
  frameRef.current = frame
  const [status, setStatus] = useState("loading")

  useEffect(() => {
    if (!bytes || !box.current) return
    let gone = false
    let renderer = null
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }))
    setStatus("loading")
    onState?.("loading")
    loadRenderer()
      .then(async (mod) => {
        if (gone) return
        renderer = await mod.GaussianSplatRenderer.getInstance(box.current, url, {
          zipName: "head",
          backgroundColor: "0x008080",
          alpha: 0,
          getChatState: () => (frameRef.current?.()?.talking ? "Responding" : "Idle"),
          getExpressionData: () => {
            const f = frameRef.current?.()
            return f?.weights ? toRenderMap(f.weights) : undefined
          },
        })
        if (!renderer) throw new Error("This head file couldn't be drawn.")
        if (gone) return renderer.dispose()
        setStatus("ready")
        onState?.("ready")
      })
      .catch((e) => {
        if (gone) return
        setStatus("error")
        onState?.("error", e?.message || "The 3D head couldn't be shown on this device.")
      })
    // head turns: a gentle tilt of the view (the avatar itself takes only face weights)
    let raf = 0
    const turn = () => {
      raf = requestAnimationFrame(turn)
      const f = frameRef.current?.()
      if (!f || !holder.current) return
      const c = (v) => Math.max(-22, Math.min(22, v || 0))
      holder.current.style.transform = `perspective(600px) rotateY(${c(-f.yaw)}deg) rotateX(${c(f.pitch) * 0.6}deg) rotateZ(${c(-f.roll) * 0.6}deg)`
    }
    raf = requestAnimationFrame(turn)
    return () => {
      gone = true
      cancelAnimationFrame(raf)
      try {
        renderer?.dispose()
      } catch {}
      URL.revokeObjectURL(url)
    }
  }, [bytes])

  return (
    <div className={`headView ${className}`} data-head-status={status} aria-label={label} role="img">
      <div className="headViewTurn" ref={holder}>
        <div className="headViewBox" ref={box} />
      </div>
      {status === "loading" && <div className="headViewNote">Loading the 3D head...</div>}
      {status === "error" && <div className="headViewNote">The 3D head couldn't be shown on this device.</div>}
    </div>
  )
}
