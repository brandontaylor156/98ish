import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { geometry, SQ3 } from "./board.js"
import { COLORS } from "./logic.js"
import { BoardDefs, Tile, NumberToken, Bandit, Harbor, RoadPiece, SettlementPiece, CityPiece, HEX_POINTS, R } from "./art.jsx"

// The island in SVG. It always fits its box; the zoom buttons (or a pinch, or Ctrl + the
// mouse wheel) zoom in, and only then can you drag it around, so it never drifts by accident.
//
// pick: { kind: "settlement" | "city" | "road" | "bandit", spots: [ids], selected } shows
// glowing spots; onPick(id) when one is clicked or tapped. preview: { kind, spots } shows
// faint ones (the build menu's hover). hot: a number just rolled (its tiles light up).
// fresh: piece keys ("v12", "e40") that just appeared (they pop in).

const colorOf = (id) => COLORS.find((c) => c.id === id) || COLORS[0]
const MAX_ZOOM = 3

const seaRing = (g) => {
  const land = new Set(g.tiles.map((t) => `${Math.round(t.x * 10)},${Math.round(t.y * 10)}`))
  const out = new Map()
  const dirs = [
    [SQ3, 0],
    [-SQ3, 0],
    [SQ3 / 2, 1.5],
    [-SQ3 / 2, 1.5],
    [SQ3 / 2, -1.5],
    [-SQ3 / 2, -1.5],
  ]
  for (const t of g.tiles)
    for (const [dx, dy] of dirs) {
      const x = t.x + dx
      const y = t.y + dy
      const key = `${Math.round(x * 10)},${Math.round(y * 10)}`
      if (!land.has(key)) out.set(key, { x, y })
    }
  return [...out.values()]
}

const BoardView = forwardRef(function BoardView({ view, pick = null, preview = null, hot = null, fresh = null, touch = false, onPick, compact = false }, ref) {
  const g = geometry(view.geo)
  const svgRef = useRef(null)
  const sea = useMemo(() => seaRing(g), [g])
  const pad = compact ? 0.62 : 0.85
  const base = useMemo(
    () => ({
      x: (g.minX - pad) * R,
      y: (g.minY - pad) * R,
      w: (g.maxX - g.minX + 2 * pad) * R,
      h: (g.maxY - g.minY + 2 * pad) * R,
    }),
    [g, pad]
  )
  const [cam, setCam] = useState({ z: 1, cx: base.x + base.w / 2, cy: base.y + base.h / 2 })
  const [hover, setHover] = useState(null)
  const drag = useRef({ pointers: new Map(), moved: false })

  const clampCam = (c) => {
    const z = Math.max(1, Math.min(MAX_ZOOM, c.z))
    const w = base.w / z
    const h = base.h / z
    const cx = Math.max(base.x + w / 2, Math.min(base.x + base.w - w / 2, c.cx))
    const cy = Math.max(base.y + h / 2, Math.min(base.y + base.h - h / 2, c.cy))
    return { z, cx, cy }
  }
  useEffect(() => setCam(clampCam({ z: 1, cx: 0, cy: 0 })), [base])

  const zoomBy = (f, at = null) =>
    setCam((c) => {
      const z = Math.max(1, Math.min(MAX_ZOOM, c.z * f))
      if (!at) return clampCam({ ...c, z })
      // keep the point under the fingers (or mouse) where it is
      const k = c.z / z
      return clampCam({ z, cx: at.x + (c.cx - at.x) * k, cy: at.y + (c.cy - at.y) * k })
    })
  useImperativeHandle(ref, () => ({
    zoomIn: () => zoomBy(1.4),
    zoomOut: () => zoomBy(1 / 1.4),
    fit: () => setCam(clampCam({ z: 1, cx: 0, cy: 0 })),
    zoom: () => cam.z,
    // where a tile's center is on screen (for the flying cards)
    tileOnScreen: (tile) => pointOnScreen(g.tiles[tile].x * R, g.tiles[tile].y * R),
    pointOnScreen: (x, y) => pointOnScreen(x, y),
  }))
  const pointOnScreen = (x, y) => {
    const svg = svgRef.current
    const m = svg?.getScreenCTM()
    if (!m) return null
    const p = svg.createSVGPoint()
    p.x = x
    p.y = y
    const s = p.matrixTransform(m)
    return { x: s.x, y: s.y }
  }
  const toBoard = (clientX, clientY) => {
    const svg = svgRef.current
    const m = svg?.getScreenCTM()
    if (!m) return null
    const p = svg.createSVGPoint()
    p.x = clientX
    p.y = clientY
    return p.matrixTransform(m.inverse())
  }

  // ---------- pointers: pan (zoomed in only) and pinch ----------
  const onPointerDown = (e) => {
    const d = drag.current
    // a new first finger: forget any pointer whose "up" never arrived
    if (e.isPrimary) {
      d.pointers.clear()
      d.pinch = null
    }
    d.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (d.pointers.size === 1) {
      d.moved = false
      d.startX = e.clientX
      d.startY = e.clientY
    }
    if (d.pointers.size === 2) {
      const [a, b] = [...d.pointers.values()]
      d.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), z: cam.z }
      d.moved = true
    }
  }
  const onPointerMove = (e) => {
    const d = drag.current
    const prev = d.pointers.get(e.pointerId)
    if (!prev) {
      if (!touch && pick) updateHover(e)
      return
    }
    const now = { x: e.clientX, y: e.clientY }
    d.pointers.set(e.pointerId, now)
    if (d.pointers.size >= 2 && d.pinch) {
      const [a, b] = [...d.pointers.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = toBoard((a.x + b.x) / 2, (a.y + b.y) / 2)
      const z = d.pinch.z * (dist / Math.max(1, d.pinch.dist))
      setCam((c) => {
        const k = c.z / Math.max(1, Math.min(MAX_ZOOM, z))
        const nz = Math.max(1, Math.min(MAX_ZOOM, z))
        return mid ? clampCam({ z: nz, cx: mid.x + (c.cx - mid.x) * k, cy: mid.y + (c.cy - mid.y) * k }) : clampCam({ ...c, z: nz })
      })
      return
    }
    const dx = now.x - prev.x
    const dy = now.y - prev.y
    if (!touch && pick) updateHover(e)
    // only a zoomed-in board pans, and only after a real drag
    if (cam.z <= 1.001) return
    const total = Math.hypot(e.clientX - d.startX, e.clientY - d.startY)
    if (!d.moved && total < 8) return
    d.moved = true
    const m = svgRef.current?.getScreenCTM()
    if (!m) return
    setCam((c) => clampCam({ ...c, cx: c.cx - dx / m.a, cy: c.cy - dy / m.d }))
  }
  const onPointerUp = (e) => {
    const d = drag.current
    d.pointers.delete(e.pointerId)
    if (d.pointers.size < 2) d.pinch = null
    if (!d.pointers.size) {
      d.startX = null
      d.startY = null
      // let the click that ends a drag through only if it wasn't a drag
      setTimeout(() => (d.moved = false), 0)
    }
  }
  const onWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey) return
    const at = toBoard(e.clientX, e.clientY)
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, at)
  }
  useEffect(() => {
    // the wheel zooms the board instead of scrolling anything behind it
    const svg = svgRef.current
    if (!svg) return
    const stop = (e) => (e.ctrlKey || e.metaKey) && e.preventDefault()
    svg.addEventListener("wheel", stop, { passive: false })
    return () => svg.removeEventListener("wheel", stop)
  }, [])

  const choose = (id) => {
    if (drag.current.moved) return
    onPick?.(id)
  }

  // the nearest spot under the mouse, for the ghost piece
  const updateHover = (e) => {
    if (!pick || touch) return
    const p = toBoard(e.clientX, e.clientY)
    if (!p) return
    let bestId = null
    let bestD = Infinity
    for (const id of pick.spots) {
      const q = pick.kind === "road" ? { x: g.edges[id].x * R, y: g.edges[id].y * R } : pick.kind === "bandit" ? { x: g.tiles[id].x * R, y: g.tiles[id].y * R } : { x: g.vertices[id].x * R, y: g.vertices[id].y * R }
      const d = Math.hypot(q.x - p.x, q.y - p.y)
      if (d < bestD) [bestId, bestD] = [id, d]
    }
    const reach = pick.kind === "bandit" ? 85 : pick.kind === "road" ? 40 : 38
    setHover(bestD <= reach ? bestId : null)
  }
  useEffect(() => setHover(null), [pick?.kind, pick?.spots?.length])

  const me = view.you
  const myColor = me != null ? colorOf(view.players[me].color) : COLORS[0]
  const vb = (() => {
    const w = base.w / cam.z
    const h = base.h / cam.z
    return `${cam.cx - w / 2} ${cam.cy - h / 2} ${w} ${h}`
  })()

  // the hovered spot can be left over from the last pick (a road's edge id while a
  // settlement is being placed): only a spot of this pick counts
  const hoverHere = hover != null && pick && [...pick.spots].includes(hover) ? hover : null
  const ghostAt = pick ? (touch ? pick.selected : (pick.selected ?? hoverHere)) : null
  const tileGlow = pick?.kind === "bandit" ? new Set(pick.spots) : null

  return (
    <svg
      ref={svgRef}
      className={`hxBoard${pick ? " is-picking" : ""}${cam.z > 1.001 ? " is-zoomed" : ""}`}
      viewBox={vb}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={(e) => {
        onPointerUp(e)
        setHover(null)
      }}
      onWheel={onWheel}
      role="img"
      aria-label="The island"
      data-zoom={cam.z.toFixed(2)}
    >
      <BoardDefs />
      <rect x={base.x - 2000} y={base.y - 2000} width={base.w + 4000} height={base.h + 4000} fill="url(#hx-sea)" />
      <rect x={base.x - 2000} y={base.y - 2000} width={base.w + 4000} height={base.h + 4000} fill="url(#hx-waves)" />
      {/* the sea around the island, in hex tiles like the land */}
      {sea.map((p, i) => (
        <polygon key={i} points={HEX_POINTS} transform={`translate(${p.x * R} ${p.y * R})`} fill="#2a6fb3" fillOpacity=".35" stroke="#7fb4e6" strokeOpacity=".25" strokeWidth="2" />
      ))}
      {/* a sandy shore under the land */}
      {g.tiles.map((t, i) => (
        <polygon key={i} points={HEX_POINTS} transform={`translate(${t.x * R} ${t.y * R}) scale(1.1)`} fill="#e8d59c" stroke="#d2b977" strokeWidth="3" />
      ))}
      {view.harbors.map((h, i) => {
        const e = g.edges[h.e]
        return <Harbor key={i} a={{ x: g.vertices[e.a].x * R, y: g.vertices[e.a].y * R }} b={{ x: g.vertices[e.b].x * R, y: g.vertices[e.b].y * R }} out={e.out} type={h.r} />
      })}
      {view.tiles.map((tile, i) => (
        <g key={i} data-tile={i} className={hot != null && tile.n === hot && i !== view.bandit ? "hxTileHot" : undefined}>
          <Tile t={tile.t} x={g.tiles[i].x * R} y={g.tiles[i].y * R} seed={i * 13 + 5} />
        </g>
      ))}
      {view.tiles.map((tile, i) =>
        tile.n ? <NumberToken key={i} n={tile.n} x={g.tiles[i].x * R + (i === view.bandit ? 22 : 0)} y={g.tiles[i].y * R + (i === view.bandit ? 14 : 0)} dim={i === view.bandit} hot={hot === tile.n && i !== view.bandit} /> : null
      )}
      {/* the Bandit's choices */}
      {tileGlow &&
        [...tileGlow].map((i) => (
          <polygon
            key={i}
            className={`hxTileSpot${ghostAt === i ? " is-on" : ""}`}
            points={HEX_POINTS}
            transform={`translate(${g.tiles[i].x * R} ${g.tiles[i].y * R}) scale(.9)`}
            onClick={() => choose(i)}
            data-spot-tile={i}
          />
        ))}
      <Bandit x={g.tiles[view.bandit].x * R - (view.tiles[view.bandit].n ? 24 : 0)} y={g.tiles[view.bandit].y * R - (view.tiles[view.bandit].n ? 10 : 0)} />
      {pick?.kind === "bandit" && ghostAt != null && ghostAt !== view.bandit && <Bandit x={g.tiles[ghostAt].x * R} y={g.tiles[ghostAt].y * R - 8} ghost />}

      {/* roads */}
      {view.edges.map((p, i) => {
        if (p == null) return null
        const e = g.edges[i]
        const c = colorOf(view.players[p].color)
        return (
          <g key={i} className={fresh?.has(`e${i}`) ? "hxPop" : undefined} data-road={i}>
            <RoadPiece x={e.x * R} y={e.y * R} angle={e.angle} fill={c.fill} dark={c.dark} />
          </g>
        )
      })}
      {/* settlements and cities */}
      {view.verts.map((b, i) => {
        if (!b) return null
        const v = g.vertices[i]
        const c = colorOf(view.players[b.p].color)
        const Piece = b.k === "c" ? CityPiece : SettlementPiece
        return (
          <g key={i} className={fresh?.has(`v${i}`) ? "hxPop" : undefined} data-building={i} data-kind={b.k}>
            <Piece x={v.x * R} y={v.y * R} fill={c.fill} dark={c.dark} scale={b.k === "c" ? 1.15 : 1.25} />
          </g>
        )
      })}

      {/* faint spots (the build menu's hover) */}
      {preview && !pick && <Spots g={g} kind={preview.kind} spots={preview.spots} faint />}
      {/* spots to pick */}
      {pick && pick.kind !== "bandit" && <Spots g={g} kind={pick.kind} spots={pick.spots} onPick={choose} touch={touch} selected={pick.selected} />}
      {/* the piece you're about to place (clicks go through it to the spot) */}
      <g pointerEvents="none">
        {pick && ghostAt != null && pick.kind === "road" && <RoadPiece x={g.edges[ghostAt].x * R} y={g.edges[ghostAt].y * R} angle={g.edges[ghostAt].angle} fill={myColor.fill} dark={myColor.dark} ghost />}
        {pick && ghostAt != null && pick.kind === "settlement" && <SettlementPiece x={g.vertices[ghostAt].x * R} y={g.vertices[ghostAt].y * R} fill={myColor.fill} dark={myColor.dark} ghost scale={1.25} />}
        {pick && ghostAt != null && pick.kind === "city" && <CityPiece x={g.vertices[ghostAt].x * R} y={g.vertices[ghostAt].y * R} fill={myColor.fill} dark={myColor.dark} ghost scale={1.15} />}
      </g>
    </svg>
  )
})

const Spots = ({ g, kind, spots, onPick, faint = false, touch = false, selected = null }) => {
  if (kind === "road")
    return (
      <g className={`hxSpots${faint ? " is-faint" : ""}`}>
        {spots.map((id) => {
          const e = g.edges[id]
          const a = g.vertices[e.a]
          const b = g.vertices[e.b]
          const shrink = (p, q) => ({ x: (p.x + (q.x - p.x) * 0.2) * R, y: (p.y + (q.y - p.y) * 0.2) * R })
          const p1 = shrink(a, b)
          const p2 = shrink(b, a)
          return (
            <g key={id} className={`hxEdgeSpot${selected === id ? " is-selected" : ""}`} onClick={onPick ? () => onPick(id) : undefined} data-spot-edge={id}>
              <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="hxEdgeGlow" />
              {onPick && <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="hxHit" strokeWidth={touch ? 34 : 24} />}
            </g>
          )
        })}
      </g>
    )
  return (
    <g className={`hxSpots${faint ? " is-faint" : ""}`}>
      {spots.map((id) => {
        const v = g.vertices[id]
        return (
          <g key={id} className={`hxVertexSpot${selected === id ? " is-selected" : ""}`} transform={`translate(${v.x * R} ${v.y * R})`} onClick={onPick ? () => onPick(id) : undefined} data-spot-vertex={id}>
            <circle r={kind === "city" ? 24 : 15} className="hxVertexGlow" />
            {onPick && <circle r={touch ? 30 : 24} className="hxHit" />}
          </g>
        )
      })}
    </g>
  )
}

export default BoardView
