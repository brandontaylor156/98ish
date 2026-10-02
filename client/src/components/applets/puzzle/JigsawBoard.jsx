import React, { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react"
import * as J from "./jigsaw.js"
import { formatTime } from "./image"

// A jigsaw on a table: the board (where the picture goes) with loose pieces around it.
// Drag pieces with the mouse or a finger; ones that fit snap together, and a group close
// to its spot snaps onto the board. With rotation on, a click/tap (or right-click) turns a
// piece. The view pans (drag the table) and zooms (wheel, pinch). On phones the loose
// pieces wait in a tray under the board that scrolls sideways; drag one up onto the board.
//
// Pieces are positioned in the picture's own pixels ("world"); the world is scaled to the
// screen with one CSS transform, and each piece is a small canvas drawn once.

const MIN_ZOOM = 0.15
const MAX_ZOOM = 4

// Each piece's picture: a canvas cut to its shape, with a soft bevel
const drawPieces = (cut, img, q) =>
  cut.pieces.map((cp) => {
    const b = cp.bounds
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.ceil(b.w * q))
    canvas.height = Math.max(1, Math.ceil(b.h * q))
    const ctx = canvas.getContext("2d")
    ctx.scale(q, q)
    ctx.translate(-b.x, -b.y)
    const path = new Path2D()
    cp.outline.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)))
    path.closePath()
    ctx.save()
    ctx.clip(path)
    ctx.drawImage(img, 0, 0, cut.width, cut.height)
    // bevel: light on the top-left, shade on the bottom-right
    const w = Math.max(1, Math.min(cut.cellW, cut.cellH) / 40)
    ctx.lineJoin = "round"
    ctx.translate(w * 0.6, w * 0.6)
    ctx.strokeStyle = "rgba(255,255,255,0.55)"
    ctx.lineWidth = w * 1.4
    ctx.stroke(path)
    ctx.translate(-w * 1.2, -w * 1.2)
    ctx.strokeStyle = "rgba(0,0,0,0.35)"
    ctx.stroke(path)
    ctx.restore()
    ctx.strokeStyle = "rgba(40,20,40,0.45)"
    ctx.lineWidth = Math.max(0.6, w * 0.5)
    ctx.stroke(path)
    return canvas
  })

const Jigsaw = ({ picture, img, setup, seed, initial, prefs, mobile, sounds, onChange, onSolved, solved: solvedProp }) => {
  const tableRef = useRef(null)
  const trayRef = useRef(null)
  const elements = useRef(new Map()) // piece id -> its element on the table
  const [, bump] = useReducer((n) => n + 1, 0)
  const [size, setSize] = useState(null) // the table's size in CSS pixels
  const [view, setView] = useState(null) // { z, tx, ty }
  const viewRef = useRef(null)
  viewRef.current = view
  const [dragging, setDragging] = useState(null) // piece id while a tray piece is being dragged
  const [flash, setFlash] = useState(null) // group that just snapped
  const [now, setNow] = useState(Date.now())

  const cut = useMemo(() => J.makeJigsaw({ count: setup.pieces, width: picture.width, height: picture.height, seed }), [picture.width, picture.height, setup.pieces, seed])
  const stateRef = useRef(null)
  if (!stateRef.current) {
    const fresh = J.scatter(cut, { seed, rotate: !!setup.rotate, inTray: !!mobile })
    const saved = initial?.pieces?.length === cut.pieces.length ? initial : null
    stateRef.current = saved ? { ...fresh, ...saved, pieces: saved.pieces.map((p) => ({ ...p })) } : fresh
    // a game saved on a computer, continued on a phone: loose pieces off the board go to the tray
    if (mobile && saved) for (const p of stateRef.current.pieces) if (!p.placed && !p.tray && (p.x < -cut.cellW || p.x > cut.width || p.y < -cut.cellH || p.y > cut.height)) p.tray = true
    // and the other way round: a computer has no tray
    if (!mobile) for (const [i, p] of stateRef.current.pieces.entries()) if (p.tray) Object.assign(p, J.scatter(cut, { seed: seed + i }).pieces[i], { rot: p.rot, group: p.group })
  }
  const s = stateRef.current
  const elapsedBase = useRef(initial?.elapsed || 0)
  const startedAt = useRef(Date.now())
  const solved = solvedProp || J.isSolved(s)
  const elapsed = () => (solved ? elapsedBase.current : elapsedBase.current + (Date.now() - startedAt.current))

  // ---- sizing and the view ----

  useLayoutEffect(() => {
    const el = tableRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fitView = (sz = size) => {
    if (!sz || !sz.w || !sz.h) return null
    const W = cut.width
    const H = cut.height
    // computers: the board and the pieces around it; phones: the board
    const table = J.TABLE(W, H)
    const r = mobile ? { x: -W * 0.03, y: -H * 0.03, w: W * 1.06, h: H * 1.06 } : { x: table.x - W * 0.02, y: table.y - H * 0.03, w: table.w + W * 0.04, h: table.h + H * 0.06 }
    const z = Math.min(sz.w / r.w, sz.h / r.h)
    return { z, tx: (sz.w - r.w * z) / 2 - r.x * z, ty: (sz.h - r.h * z) / 2 - r.y * z }
  }
  useEffect(() => {
    if (size) setView(fitView(size))
  }, [size?.w, size?.h, cut])

  // piece pictures, drawn sharp enough for the fitted view
  const bitmaps = useMemo(() => {
    if (!size) return null
    const fit = fitView(size)
    const q = Math.max(0.35, Math.min(1.5, (fit?.z || 1) * (window.devicePixelRatio || 1) * 1.4))
    return drawPieces(cut, img, q)
  }, [cut, img, !!size])

  // the clock
  useEffect(() => {
    if (solved) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    const save = () => onChange?.(snapshot())
    const hidden = () => document.hidden && save()
    document.addEventListener("visibilitychange", hidden)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", hidden)
    }
  }, [solved])

  const snapshot = () => ({ pieces: s.pieces.map((p) => ({ ...p })), rotate: s.rotate, moves: s.moves, elapsed: elapsed() })

  // ---- geometry ----

  const toWorld = (clientX, clientY) => {
    const rect = tableRef.current.getBoundingClientRect()
    const v = viewRef.current
    return [(clientX - rect.left - v.tx) / v.z, (clientY - rect.top - v.ty) / v.z]
  }
  const hidden = (id) => prefs.edges && !cut.pieces[id].edge && !s.pieces[id].placed

  const styleFor = (id) => {
    const p = s.pieces[id]
    const cp = cut.pieces[id]
    const b = cp.bounds
    return {
      left: p.x + (b.x - cp.x),
      top: p.y + (b.y - cp.y),
      width: b.w,
      height: b.h,
      transformOrigin: `${cp.x + cut.cellW / 2 - b.x}px ${cp.y + cut.cellH / 2 - b.y}px`,
      transform: p.rot ? `rotate(${p.rot * 90}deg)` : "none",
      zIndex: p.placed ? 1 : 10 + p.z,
    }
  }
  const applyStyle = (id) => {
    const el = elements.current.get(id)
    if (!el) return
    const st = styleFor(id)
    el.style.left = `${st.left}px`
    el.style.top = `${st.top}px`
    el.style.transform = st.transform
    el.style.zIndex = st.zIndex
  }

  // the loose piece under a point (top-most first)
  const pieceAt = (wx, wy, loose = false) => {
    const order = s.pieces.map((p, id) => id).sort((a, b) => s.pieces[b].z - s.pieces[a].z)
    let near = null
    for (const id of order) {
      const p = s.pieces[id]
      if (p.tray || p.placed || hidden(id)) continue
      const cp = cut.pieces[id]
      const cx = p.x + cut.cellW / 2
      const cy = p.y + cut.cellH / 2
      const [ux, uy] = J.rotateVec(wx - cx, wy - cy, 4 - p.rot)
      const px = cp.x + cut.cellW / 2 + ux
      const py = cp.y + cut.cellH / 2 + uy
      if (J.insidePolygon(cp.outline, px, py)) return id
      // fingers are big: inside the piece's square is close enough
      if (loose && near === null && Math.abs(ux) < cut.cellW * 0.5 && Math.abs(uy) < cut.cellH * 0.5) near = id
    }
    return near
  }

  // ---- dragging, panning, zooming ----

  const drag = useRef(null) // { pointerId, id, group, x, y, moved, fromTray }
  const pans = useRef(new Map()) // pointerId -> { x, y } for panning/pinching
  const pinch = useRef(null)
  const zTop = useRef(Math.max(0, ...s.pieces.map((p) => p.z)))

  const lift = (group) => {
    zTop.current++
    for (const p of s.pieces) if (p.group === group) p.z = zTop.current
    for (const id of J.groupMembers(s, group)) applyStyle(id)
  }

  const startDrag = (e, id, fromTray = false) => {
    const group = s.pieces[id].group
    drag.current = { pointerId: e.pointerId, id, group, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: fromTray, fromTray }
    lift(group)
    sounds?.pick()
    for (const m of J.groupMembers(s, group)) elements.current.get(m)?.classList.add("is-lifted")
  }

  const moveDrag = (e) => {
    const d = drag.current
    const v = viewRef.current
    const dx = (e.clientX - d.x) / v.z
    const dy = (e.clientY - d.y) / v.z
    d.x = e.clientX
    d.y = e.clientY
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) d.moved = true
    J.moveGroup(s, d.group, dx, dy)
    for (const id of J.groupMembers(s, d.group)) applyStyle(id)
  }

  const overTray = (clientY) => {
    const tray = trayRef.current
    return !!tray && clientY >= tray.getBoundingClientRect().top
  }

  const endDrag = (e, cancelled = false) => {
    const d = drag.current
    drag.current = null
    setDragging(null)
    for (const m of J.groupMembers(s, d.group)) elements.current.get(m)?.classList.remove("is-lifted")
    if (cancelled && d.fromTray) {
      s.pieces[d.id].tray = true
      return bump()
    }
    const members = J.groupMembers(s, d.group)
    if (!d.moved && s.rotate && !cancelled) {
      J.rotateGroup(cut, s, d.id)
      s.moves++
      members.forEach(applyStyle)
    } else if (mobile && members.length === 1 && e && overTray(e.clientY)) {
      // back into the tray
      s.pieces[d.id].tray = true
    } else if (d.moved) {
      s.moves++
      const result = J.settle(cut, s, d.id, Math.max(cut.cellW, cut.cellH) * 0.2)
      if (result.placed) sounds?.place()
      else if (result.joined) sounds?.snap()
      if (result.placed || result.joined) {
        setFlash(s.pieces[d.id].group)
        setTimeout(() => setFlash(null), 450)
      }
      J.groupMembers(s, s.pieces[d.id].group).forEach(applyStyle)
    }
    bump()
    if (J.isSolved(s)) {
      elapsedBase.current = elapsed()
      onChange?.(snapshot())
      onSolved?.(elapsedBase.current, s.moves)
    } else onChange?.(snapshot())
  }

  const onPointerDown = (e) => {
    if (solved || !view) return
    if (e.pointerType === "mouse" && e.button === 2) {
      const id = pieceAt(...toWorld(e.clientX, e.clientY))
      if (id !== null && s.rotate) {
        J.rotateGroup(cut, s, id)
        J.groupMembers(s, s.pieces[id].group).forEach(applyStyle)
        onChange?.(snapshot())
      }
      return
    }
    if (e.pointerType === "mouse" && e.button !== 0) return
    tableRef.current.setPointerCapture?.(e.pointerId)
    if (!drag.current && pans.current.size === 0) {
      const id = pieceAt(...toWorld(e.clientX, e.clientY), e.pointerType !== "mouse")
      if (id !== null) return startDrag(e, id)
    }
    // a second finger while dragging a piece: let go of the piece and pinch instead
    if (drag.current && drag.current.pointerId !== e.pointerId) {
      const d = drag.current
      pans.current.set(d.pointerId, { x: d.x, y: d.y })
      endDrag(null)
    }
    pans.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    pinch.current = null
  }

  const onPointerMove = (e) => {
    if (drag.current?.pointerId === e.pointerId) return moveDrag(e)
    if (!pans.current.has(e.pointerId)) return
    const prev = pans.current.get(e.pointerId)
    pans.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const v = viewRef.current
    if (pans.current.size === 1) {
      setView({ ...v, tx: v.tx + e.clientX - prev.x, ty: v.ty + e.clientY - prev.y })
      return
    }
    const [a, b] = [...pans.current.values()]
    const rect = tableRef.current.getBoundingClientRect()
    const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }
    const dist = Math.hypot(a.x - b.x, a.y - b.y)
    if (!pinch.current) pinch.current = { dist, mid, view: v }
    const p = pinch.current
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (p.view.z * dist) / Math.max(10, p.dist)))
    const wx = (p.mid.x - p.view.tx) / p.view.z
    const wy = (p.mid.y - p.view.ty) / p.view.z
    setView({ z, tx: mid.x - wx * z, ty: mid.y - wy * z })
  }

  const onPointerUp = (e) => {
    if (drag.current?.pointerId === e.pointerId) return endDrag(e, e.type === "pointercancel")
    pans.current.delete(e.pointerId)
    pinch.current = null
  }

  const onWheel = (e) => {
    if (!view) return
    const rect = tableRef.current.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.z * Math.exp(-e.deltaY * 0.0015)))
    const wx = (mx - view.tx) / view.z
    const wy = (my - view.ty) / view.z
    setView({ z, tx: mx - wx * z, ty: my - wy * z })
  }
  // the wheel must not scroll the page behind
  useEffect(() => {
    const el = tableRef.current
    const stop = (e) => e.preventDefault()
    el?.addEventListener("wheel", stop, { passive: false })
    return () => el?.removeEventListener("wheel", stop)
  }, [])

  // ---- the tray (phones) ----

  const trayDown = (e, id) => {
    if (solved) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { pointerId: e.pointerId, id, tray: true, sx: e.clientX, sy: e.clientY }
  }
  const trayMove = (e, id) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    if (d.tray) {
      const dx = e.clientX - d.sx
      const dy = e.clientY - d.sy
      // sideways scrolls the tray; up takes the piece out
      if (Math.abs(dy) < 10 || Math.abs(dy) < Math.abs(dx)) return
      const [wx, wy] = toWorld(e.clientX, e.clientY)
      const p = s.pieces[id]
      p.tray = false
      p.x = wx - cut.cellW / 2
      p.y = wy - cut.cellH * 0.75
      drag.current = null
      startDrag(e, id, true)
      setDragging(id)
      bump()
      return
    }
    moveDrag(e)
  }
  const trayUp = (e) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    if (d.tray) {
      drag.current = null
      return
    }
    endDrag(e, e.type === "pointercancel")
  }

  // ---- for the tests: a nearly finished puzzle, and where things are ----
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__puzzle = {
      ...(window.__puzzle || {}),
      nearlySolve: (leave = 2) => {
        const left = J.nearlySolve(cut, s, leave)
        if (mobile) for (const id of left) s.pieces[id].tray = true
        else
          left.forEach((id, i) => {
            s.pieces[id].x = cut.width + cut.cellW * 0.3
            s.pieces[id].y = cut.cellH * (0.2 + i * 1.6)
          })
        s.pieces.forEach((_, id) => applyStyle(id))
        bump()
        return left
      },
      jigsaw: () => {
        const rect = tableRef.current.getBoundingClientRect()
        const v = viewRef.current
        const screen = (wx, wy) => ({ x: rect.left + v.tx + wx * v.z, y: rect.top + v.ty + wy * v.z })
        return s.pieces.map((p, id) => {
          const cp = cut.pieces[id]
          const trayEl = trayRef.current?.querySelector(`[data-tray="${id}"]`)
          const tr = trayEl?.getBoundingClientRect()
          return {
            id,
            placed: p.placed,
            tray: p.tray,
            rot: p.rot,
            at: p.tray && tr ? { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 } : screen(p.x + cut.cellW / 2, p.y + cut.cellH / 2),
            target: screen(cp.x + cut.cellW / 2, cp.y + cut.cellH / 2),
          }
        })
      },
    }
  })

  const placed = J.placedCount(s)
  const trayPieces = mobile ? s.pieces.map((p, id) => id).filter((id) => (s.pieces[id].tray || dragging === id) && !(prefs.edges && !cut.pieces[id].edge)) : []
  const trayCount = mobile ? s.pieces.filter((p) => p.tray).length : 0
  const thumb = mobile ? 64 : 0

  return (
    <div className={`pzJigsaw${mobile ? " is-mobile" : ""}`}>
      <div className="pzStatus">
        <span title="Time">⏱ {formatTime(solved ? elapsedBase.current : elapsedBase.current + (now - startedAt.current))}</span>
        <span>
          {placed}/{cut.pieces.length} placed
        </span>
        {mobile && trayCount > 0 && <span>{trayCount} in tray</span>}
      </div>
      <div
        className="pzTable"
        ref={tableRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        {view && bitmaps && (
          <div className="pzWorld" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.z})` }}>
            <div className="pzBoard" style={{ width: cut.width, height: cut.height }}>
              {prefs.preview && !solved && <img className="pzGhost" src={picture.data} alt="" draggable={false} />}
            </div>
            {/* finished: the seams melt away */}
            {solved && <img className="pzFinal" src={picture.data} alt="" draggable={false} style={{ width: cut.width, height: cut.height }} />}
            {s.pieces.map((p, id) =>
              p.tray ? null : (
                <canvas
                  key={id}
                  data-piece={id}
                  className={`pzPiece${p.placed ? " is-placed" : ""}${hidden(id) ? " is-hidden" : ""}${flash !== null && p.group === flash ? " is-flash" : ""}${dragging === id ? " is-lifted" : ""}`}
                  style={styleFor(id)}
                  width={bitmaps[id].width}
                  height={bitmaps[id].height}
                  ref={(el) => {
                    if (el) {
                      elements.current.set(id, el)
                      if (el.dataset.drawn !== "1") {
                        el.getContext("2d").drawImage(bitmaps[id], 0, 0)
                        el.dataset.drawn = "1"
                      }
                    } else elements.current.delete(id)
                  }}
                />
              )
            )}
          </div>
        )}
        {solved && <div className="pzSolvedGlow" />}
      </div>
      {mobile && (
        <div className="pzTray" ref={trayRef}>
          {trayPieces.length === 0 ? (
            <span className="pzTrayEmpty">{trayCount ? "Only edge pieces are shown (Options)." : "All the pieces are out. Drag one here to put it back."}</span>
          ) : (
            trayPieces.map((id) => {
              const bm = bitmaps?.[id]
              const scale = bm ? Math.min(thumb / bm.width, thumb / bm.height) : 1
              return (
                <div
                  key={id}
                  data-tray={id}
                  className={`pzTrayItem${dragging === id ? " is-dragging" : ""}`}
                  onPointerDown={(e) => trayDown(e, id)}
                  onPointerMove={(e) => trayMove(e, id)}
                  onPointerUp={trayUp}
                  onPointerCancel={trayUp}
                >
                  {bm && (
                    <canvas
                      width={Math.round(bm.width * scale)}
                      height={Math.round(bm.height * scale)}
                      style={{ transform: s.pieces[id].rot ? `rotate(${s.pieces[id].rot * 90}deg)` : "none" }}
                      ref={(el) => {
                        if (el && el.dataset.drawn !== "1") {
                          el.getContext("2d").drawImage(bm, 0, 0, el.width, el.height)
                          el.dataset.drawn = "1"
                        }
                      }}
                    />
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

export default Jigsaw
