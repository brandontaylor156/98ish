import React, { useEffect, useRef, useState } from "react"
import Combo from "../../../../shared/select/Combo"
import { detectFormat, checkSize, centersFromSplat, centersFromPly, pointsToSplat, MAX_SYNCED_BYTES } from "./files.js"
import { similarity, courtCorners, upAxis } from "./align.js"
import { synthBackdrop } from "./synth.js"
import { getBackdrop, saveBackdrop, setPlacement, removeBackdrop, readBytes } from "./store.js"

// My Park > Photoreal backdrop...: a captured 3D copy of the place behind your venue.
// Import a splat file (from a phone capture app or a desktop trainer), capture one with
// the free MapAnything service, or try the demo; then line it up by tapping the court's
// four corners in a view from above.
const CORNERS = ["near-left", "near-right", "far-right", "far-left"]

export default function SplatPanel({ world, venueName, onClose, phone }) {
  const venue = world?.venue || "riverside"
  const layout = world?.layout
  const courts = layout?.COURTS || []
  const [b, setB] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [align, setAlign] = useState(null) // { centers, court, taps: [] }
  const fileRef = useRef(null)

  const refresh = async () => setB(await getBackdrop(venue))
  useEffect(() => {
    refresh()
  }, [venue])

  const center = () => {
    if (!courts.length) return [0, 0]
    let x = 0
    let z = 0
    for (const c of courts) (x += c.x), (z += c.z)
    return [x / courts.length, z / courts.length]
  }
  // the demo starts outside the venue: past its farthest court and building
  const reach = (c) => {
    let r = 30
    for (const k of courts) r = Math.max(r, Math.hypot(k.x - c[0], k.z - c[1]) + 12)
    // every collision box (pens, buildings, bleachers...): its center plus its half-size
    for (const b of layout?.BOXES || []) if (Number.isFinite(b.cx)) r = Math.max(r, Math.hypot(b.cx - c[0], b.cz - c[1]) + Math.hypot(b.hx || 0, b.hz || 0))
    return r + 20
  }

  const useBytes = async (bytes, format, meta) => {
    const size = checkSize(bytes)
    if (!size.ok) throw new Error(size.error)
    const saved = await saveBackdrop(venue, bytes, { format, ...meta })
    if (!saved.ok) throw new Error(saved.error)
    const shown = await world.splat.show(bytes, format, meta.transform || null, meta.splats || 0)
    if (!shown) throw new Error(world.splat.info.error || "That splat couldn't be drawn.")
    await refresh()
  }

  const run = (label, fn) => async (...args) => {
    setError(null)
    setBusy(label)
    try {
      await fn(...args)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setBusy(null)
    }
  }

  const importFile = run("Opening the splat...", async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const format = detectFormat(bytes, file.name)
    if (!format) throw new Error("That isn't a splat file (.ply, .spz, .splat, .ksplat or .sog).")
    await useBytes(bytes, format, { source: "import", title: file.name })
    startAlign(bytes, format)
  })

  const demo = run("Making the demo backdrop...", async () => {
    const c = center()
    const inner = reach(c)
    const bytes = synthBackdrop({ count: phone ? 300000 : 600000, center: c, inner, outer: inner + 95 })
    await useBytes(bytes, "splat", { source: "demo", title: "Demo hills and trees", splats: bytes.length / 32 })
  })

  const capture = run("Recording...", async () => {
    const cap = await import("./capture.js")
    setBusy("Recording: walk slowly around the court (up to 40 s). Tap Stop when done.")
    const rec = await cap.record({})
    stopRef.current = rec.stop
    const blob = await rec.blob
    setBusy("Picking frames from your video...")
    const frames = await cap.sampleFrames(blob, cap.FRAMES)
    const glb = await cap.reconstruct(frames, { onStatus: setBusy })
    setBusy("Turning the 3D points into a backdrop...")
    const { positions, colors } = await cap.glbPoints(glb)
    const bytes = pointsToSplat(positions, colors, { size: 0.03, maxPoints: 250000 }) // ~8 MB: small enough to sync
    await useBytes(bytes, "splat", { source: "capture", title: `Captured ${new Date().toLocaleDateString()}`, splats: bytes.length / 32 })
    startAlign(bytes, "splat")
  })
  const stopRef = useRef(null)

  const startAlign = async (bytes, format) => {
    let centers = null
    try {
      centers = format === "splat" ? centersFromSplat(bytes) : format === "ply" ? centersFromPly(bytes) : world.splat.centers()
    } catch {}
    if (!centers?.length) centers = world.splat.centers()
    if (!centers?.length) return setError("This splat can't be lined up here; it shows as captured.")
    setAlign({ centers, court: courts[0]?.id ?? null, taps: [], view: project(centers) })
  }

  const alignExisting = run("Opening the backdrop...", async () => {
    if (!b) return
    const bytes = await readBytes(b.file)
    await startAlign(bytes, b.format)
  })

  const remove = run("Removing...", async () => {
    await removeBackdrop(venue)
    world.splat.hide()
    await refresh()
  })

  if (align) return <AlignView align={align} setAlign={setAlign} courts={courts} onCancel={() => setAlign(null)} onDone={async (T) => {
    world.splat.place(T)
    await setPlacement(venue, T)
    setAlign(null)
    refresh()
  }} />

  return (
    <div className="pkCenter pkDim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pkPanel window pkSplatPanel" data-park="splat">
        <div className="title-bar">
          <div className="title-bar-text">Photoreal backdrop · {venueName}</div>
        </div>
        <div className="window-body">
          <p>{b ? <>Showing <b>{b.title || "a backdrop"}</b>{b.splats ? ` (${Math.round(b.splats / 1000)}k splats)` : ""}. {b.file?.textLength > MAX_SYNCED_BYTES * 1.37 ? "Kept on this device only (too big to sync)." : "Synced with your files."}</> : "No backdrop yet. Put a real, photographic 3D copy of the place behind the courts."}</p>
          {busy && <p className="pkSplatBusy" role="status">{busy}</p>}
          {busy?.startsWith("Recording") && (
            <button type="button" className="pkPrimary" onClick={() => stopRef.current?.()}>
              Stop recording
            </button>
          )}
          {error && <p className="pkSplatError">{error}</p>}
          <div className="pkSplatButtons">
            <button type="button" className="pkPrimary" disabled={!!busy} onClick={capture} data-splat="capture">
              Capture this court...
            </button>
            <button type="button" disabled={!!busy} onClick={() => fileRef.current?.click()} data-splat="import">
              Import a splat file...
            </button>
            <button type="button" disabled={!!busy} onClick={demo} data-splat="demo">
              Demo backdrop
            </button>
            {b && (
              <button type="button" disabled={!!busy} onClick={alignExisting} data-splat="align">
                Line it up...
              </button>
            )}
            {b && (
              <button type="button" disabled={!!busy} onClick={remove} data-splat="remove">
                Remove
              </button>
            )}
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".ply,.spz,.splat,.ksplat,.sog" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} data-splat="file" />
          <p className="pkSplatHint">Capture: walk slowly around the court filming for 20 to 40 seconds; Meta's free MapAnything service (on Hugging Face, your own daily free allowance) builds it in 3D. Or make a splat with a capture app such as Scaniverse and import it. Graphics: Low hides backdrops.</p>
        </div>
      </div>
    </div>
  )
}

// a view from above: the splat's centers flattened onto its ground plane
const project = (centers) => {
  const { up, center } = upAxis(centers)
  // a basis on the ground plane
  const ref = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const norm = (v) => {
    const l = Math.hypot(...v) || 1
    return v.map((x) => x / l)
  }
  const a = norm(cross(up, ref))
  const bb = norm(cross(up, a))
  const n = centers.length / 3
  const uv = new Float32Array(n * 2)
  const h = new Float32Array(n)
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  for (let i = 0; i < n; i++) {
    const d = [centers[i * 3] - center[0], centers[i * 3 + 1] - center[1], centers[i * 3 + 2] - center[2]]
    const u = d[0] * a[0] + d[1] * a[1] + d[2] * a[2]
    const v = d[0] * bb[0] + d[1] * bb[1] + d[2] * bb[2]
    uv[i * 2] = u
    uv[i * 2 + 1] = v
    h[i] = d[0] * up[0] + d[1] * up[1] + d[2] * up[2]
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
  }
  return { up, center, a, b: bb, uv, h, box: [minU, maxU, minV, maxV] }
}

// back from a tap on the map to a 3D point: on the plane, at the ground height near the tap
const toPoint = (view, u, v) => {
  const n = view.h.length
  const near = []
  const r2 = ((view.box[1] - view.box[0]) * 0.02) ** 2
  for (let i = 0; i < n; i++) {
    const du = view.uv[i * 2] - u
    const dv = view.uv[i * 2 + 1] - v
    if (du * du + dv * dv < r2) near.push(view.h[i])
  }
  near.sort((x, y) => x - y)
  const hh = near.length ? near[Math.floor(near.length * 0.2)] : 0 // the ground: low among nearby splats
  const { center: c, a, b, up } = view
  return [0, 1, 2].map((k) => c[k] + a[k] * u + b[k] * v + up[k] * hh)
}

const AlignView = ({ align, setAlign, courts, onCancel, onDone }) => {
  const ref = useRef(null)
  const { view, taps } = align
  const S = 320
  const [u0, u1, v0, v1] = view.box
  const span = Math.max(u1 - u0, v1 - v0) || 1
  const toPx = (u, v) => [((u - u0) / span) * S, ((v - v0) / span) * S]
  const toUv = (x, y) => [u0 + (x / S) * span, v0 + (y / S) * span]
  useEffect(() => {
    const ctx = ref.current?.getContext("2d")
    if (!ctx) return
    ctx.fillStyle = "#101418"
    ctx.fillRect(0, 0, S, S)
    ctx.fillStyle = "rgba(170, 220, 255, 0.5)"
    const n = view.h.length
    const step = Math.max(1, Math.floor(n / 40000))
    for (let i = 0; i < n; i += step) {
      const [x, y] = toPx(view.uv[i * 2], view.uv[i * 2 + 1])
      ctx.fillRect(x, y, 1, 1)
    }
    ctx.fillStyle = "#ffcc00"
    ctx.font = "12px sans-serif"
    taps.forEach((t, i) => {
      const [x, y] = toPx(t[0], t[1])
      ctx.beginPath()
      ctx.arc(x, y, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillText(String(i + 1), x + 7, y - 7)
    })
  }, [view, taps])
  const court = courts.find((c) => c.id === align.court) || courts[0]
  const tap = (e) => {
    if (taps.length >= 4) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * S
    const y = ((e.clientY - r.top) / r.height) * S
    setAlign({ ...align, taps: [...taps, toUv(x, y)] })
  }
  const finish = () => {
    const src = taps.map(([u, v]) => toPoint(view, u, v))
    const T = similarity(src, courtCorners(court))
    onDone(T)
  }
  return (
    <div className="pkCenter pkDim">
      <div className="pkPanel window pkSplatPanel" data-park="splat-align">
        <div className="title-bar">
          <div className="title-bar-text">Line up the backdrop</div>
        </div>
        <div className="window-body">
          <p>
            Tap the court's corners in order: <b>{taps.length < 4 ? `${taps.length + 1}. ${CORNERS[taps.length]}` : "done"}</b> (standing at the near baseline).
          </p>
          {courts.length > 1 && (
            <label className="pkField">
              <span>Court</span>
              <Combo value={court?.id} options={courts.map((c) => [c.id, c.name || `Court ${c.id}`])} onChange={(v) => setAlign({ ...align, court: v })} ariaLabel="Court" name="splatCourt" />
            </label>
          )}
          <canvas ref={ref} width={S} height={S} className="pkSplatMap" onClick={tap} data-splat="map" />
          <div className="pkSplatButtons">
            <button type="button" className="pkPrimary" disabled={taps.length < 4 || !court} onClick={finish} data-splat="align-done">
              Line it up
            </button>
            <button type="button" onClick={() => setAlign({ ...align, taps: taps.slice(0, -1) })} disabled={!taps.length}>
              Undo tap
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
