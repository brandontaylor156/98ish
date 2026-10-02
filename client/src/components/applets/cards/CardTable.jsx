import React, { useLayoutEffect, useRef, useState } from "react"
import { backUrl, faceUrl } from "./art"
import "./cards.css"

// The green felt both card games play on. The game lays the cards out (positions in px)
// and this draws them and turns pointer input into game actions:
//   drag a card (mouse or finger)    -> canDrop / onDrop
//   click or tap a card or empty slot -> onTap(pile, index, pointerType)   index -1 = slot
//   double-click / tap twice          -> onDoubleTap(pile, index)
//   right-click                       -> onRightClick()
//
// cards: [{ card, pile, index, x, y, z, selected, hidden }]
// slots: [{ pile, x, y, kind }]     outlines drawn under the cards
// dropRects: { pile: { x, y, w, h } } where a dragged card can land

const DRAG_SLOP = { mouse: 4, touch: 8, pen: 6 }
const DOUBLE_MS = 450
const SETTLE_MS = 260

// The size of an element, kept up to date
export const useSize = (ref) => {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return size
}

const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

const CardTable = ({
  tableRef,
  cards,
  slots,
  dropRects,
  cw,
  ch,
  back,
  dealKey,
  dealFrom,
  locked,
  canPickUp,
  canDrop,
  onDrop,
  onTap,
  onDoubleTap,
  onRightClick,
  onPointerMoveTable,
  children,
}) => {
  const [drag, setDrag] = useState(null) // { pile, index, dx, dy }
  const press = useRef(null)
  const lastTap = useRef(null)
  const moved = useRef(new Map()) // card id -> { x, y, at } for lifting cards in flight
  const [dealPhase, setDealPhase] = useState(null) // "start" | "run" | null
  const lastSize = useRef(cw)
  const seenDeal = useRef(dealKey)

  // A new deal: cards start stacked at dealFrom and fly out one after another
  useLayoutEffect(() => {
    if (seenDeal.current === dealKey || !dealFrom) return
    seenDeal.current = dealKey
    setDealPhase("start")
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => setDealPhase("run"))
    })
    const done = setTimeout(() => setDealPhase(null), 250 + cards.length * 18)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(done)
    }
  }, [dealKey])

  // A resize moves every card: don't animate that
  const resized = lastSize.current !== cw
  lastSize.current = cw

  const cardAt = (pile, index) => cards.find((c) => c.pile === pile && c.index === index)

  const targetFor = (p, dx, dy, clientX, clientY) => {
    const lead = cardAt(p.pile, p.index)
    if (!lead) return null
    const rect = { x: lead.x + dx, y: lead.y + dy, w: cw, h: ch }
    const box = tableRef.current.getBoundingClientRect()
    const point = { x: clientX - box.left, y: clientY - box.top, w: 1, h: 1 }
    let best = null
    for (const [pile, r] of Object.entries(dropRects)) {
      if (pile === p.pile || !canDrop(p.pile, p.index, pile)) continue
      // where the finger is counts most, then how much the cards overlap
      const score = overlap(rect, r) + (overlap(point, r) ? cw * ch : 0)
      if (score > 0 && (!best || score > best.score)) best = { pile, score }
    }
    return best?.pile || null
  }

  const onPointerDown = (e) => {
    if (locked || press.current) return
    if (e.pointerType === "mouse" && e.button === 2) {
      e.preventDefault()
      onRightClick?.()
      return
    }
    if (e.button > 0) return
    const el = e.target.closest?.("[data-pile]")
    const pile = el?.dataset.pile ?? null
    const index = el ? Number(el.dataset.index) : -1
    e.preventDefault()
    tableRef.current.closest("[tabindex]")?.focus({ preventScroll: true })
    press.current = {
      id: e.pointerId,
      type: e.pointerType,
      pile,
      index,
      x: e.clientX,
      y: e.clientY,
      draggable: pile !== null && index >= 0 && canPickUp(pile, index),
      dragging: false,
    }
    try {
      tableRef.current.setPointerCapture(e.pointerId)
    } catch {
      // synthetic pointers can't be captured; moves still arrive on the table
    }
  }

  const onPointerMove = (e) => {
    onPointerMoveTable?.(e)
    const p = press.current
    if (!p || p.id !== e.pointerId || !p.draggable) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    if (!p.dragging && Math.hypot(dx, dy) < (DRAG_SLOP[p.type] ?? 5)) return
    p.dragging = true
    setDrag({ pile: p.pile, index: p.index, dx, dy })
  }

  const endPress = () => {
    press.current = null
    setDrag(null)
  }

  const onPointerUp = (e) => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    if (p.dragging) {
      const to = targetFor(p, e.clientX - p.x, e.clientY - p.y, e.clientX, e.clientY)
      // cards dropped (or snapping back) fly from where they were let go
      const at = performance.now()
      for (const c of cards) if (c.pile === p.pile && c.index >= p.index) moved.current.set(c.card.id, { x: c.x, y: c.y, at })
      endPress()
      lastTap.current = null
      if (to) onDrop(p.pile, p.index, to)
      return
    }
    endPress()
    const now = performance.now()
    const last = lastTap.current
    if (last && now - last.at < DOUBLE_MS && last.pile === p.pile && last.index === p.index && p.pile !== null) {
      lastTap.current = null
      onDoubleTap?.(p.pile, p.index, p.type)
      return
    }
    lastTap.current = { pile: p.pile, index: p.index, at: now }
    onTap?.(p.pile, p.index, p.type)
  }

  // ---- render ----
  const now = performance.now()
  const dealing = dealPhase !== null
  let order = 0
  const items = cards.map((c) => {
    const dragged = drag && c.pile === drag.pile && c.index >= drag.index
    let x = c.x
    let y = c.y
    let z = c.z
    if (dragged) {
      x += drag.dx
      y += drag.dy
      z += 2000
    }
    // a card whose spot changed is lifted above the rest while it slides there
    const prev = moved.current.get(c.card.id)
    if (dealing || resized || !prev) moved.current.set(c.card.id, { x: c.x, y: c.y, at: 0 })
    else if (!dragged) {
      if (prev.x !== c.x || prev.y !== c.y) moved.current.set(c.card.id, { x: c.x, y: c.y, at: now })
      if (now - moved.current.get(c.card.id).at < SETTLE_MS) z += 1000
    }
    let transition
    if (dealPhase === "start") {
      x = dealFrom.x
      y = dealFrom.y
      transition = "none"
    } else if (dealPhase === "run") {
      transition = `transform 220ms ease-out ${order++ * 18}ms`
    } else if (dragged || resized) {
      transition = "none"
    }
    return { c, x, y, z, transition }
  })

  return (
    <div
      className={drag ? "cardTable is-dragging" : "cardTable"}
      ref={tableRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endPress}
      onContextMenu={(e) => e.preventDefault()}
    >
      {slots.map((s) => (
        <div
          key={s.pile + s.kind}
          className={`cardSlot is-${s.kind}`}
          data-pile={s.pile}
          data-index={-1}
          style={{ width: cw, height: ch, transform: `translate(${s.x}px, ${s.y}px)` }}
        />
      ))}
      {items.map(({ c, x, y, z, transition }) => (
        <img
          key={c.card.id}
          className={c.selected ? "playingCard is-selected" : "playingCard"}
          src={c.card.up ? faceUrl(c.card) : backUrl(back)}
          alt={c.card.up ? c.card.id : "card"}
          data-card={c.card.id}
          data-pile={c.pile}
          data-index={c.index}
          draggable={false}
          style={{
            width: cw,
            height: ch,
            transform: `translate(${x}px, ${y}px)`,
            zIndex: z,
            transition,
            visibility: c.hidden ? "hidden" : undefined,
          }}
        />
      ))}
      {children}
    </div>
  )
}

export default CardTable

// Load the face images so a canvas can draw them (the win animation)
export const loadImages = (cards) =>
  Promise.all(
    cards.map(
      (card) =>
        new Promise((resolve) => {
          const img = new Image()
          img.onload = () => resolve([card.id, img])
          img.onerror = () => resolve([card.id, null])
          img.src = faceUrl(card)
        })
    )
  ).then((list) => new Map(list))
