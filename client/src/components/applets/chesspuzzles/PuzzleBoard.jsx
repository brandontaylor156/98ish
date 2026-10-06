import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ChessPiece, PIECE_NAMES } from "../network/games/ChessPieces"
import * as chess from "../network/rules/chess.js"

// The puzzle board: tap a piece then a square, or drag it. Pieces slide when a move is
// played for you (the opponent's moves, the solution). Shows hints, the last move, a
// wrong move for a moment, and check.

const FILES = "abcdefgh"
const COLOR_NAME = { w: "White", b: "Black" }

// A piece that slides in from `from` when it first appears on `to`
const Sliding = ({ piece, slide, size }) => {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !slide) return
    el.style.transition = "none"
    el.style.transform = `translate(${slide.dx * size}px, ${slide.dy * size}px)`
    el.getBoundingClientRect()
    el.style.transition = "transform 260ms ease-out"
    el.style.transform = "translate(0, 0)"
  }, [slide?.key])
  return (
    <span className="cpSlide" ref={ref}>
      <ChessPiece piece={piece} />
    </span>
  )
}

const PuzzleBoard = ({ game, you, flipped: flipSetting = false, interactive, onMove, hint, wrong, slide, size }) => {
  const [sel, setSel] = useState(null)
  const [promo, setPromo] = useState(null)
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(null)
  const draggedRef = useRef(false)
  const flipped = (you === "b") !== flipSetting
  const legal = interactive ? chess.movesForView(game) : []
  useEffect(() => {
    setSel(null)
    setPromo(null)
  }, [game, interactive])

  const movesFrom = (sq) => legal.filter((m) => m.from === sq)
  const active = drag?.moved ? drag.from : sel
  const targets = active === null ? [] : movesFrom(active)
  const targetSet = new Set(targets.map((m) => m.to))
  const mine = (sq) => chess.colorOf(game.board[sq]) === you

  const go = (from, to) => {
    const m = legal.find((x) => x.from === from && x.to === to)
    if (!m) return false
    setSel(null)
    if (m.promotion) setPromo({ from, to })
    else onMove({ from, to })
    return true
  }

  const click = (sq) => {
    if (draggedRef.current) return (draggedRef.current = false)
    if (!interactive || promo) return
    if (sel !== null && targetSet.has(sq)) return go(sel, sq)
    if (mine(sq) && movesFrom(sq).length) return setSel(sq === sel ? null : sq)
    setSel(null)
  }

  const startDrag = (e, sq) => {
    if (!interactive || promo || !mine(sq) || !movesFrom(sq).length) return
    if (e.button !== undefined && e.button !== 0) return
    dragRef.current = { from: sq, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false }
    setDrag(dragRef.current)
  }
  useEffect(() => {
    if (!drag) return
    const move = (e) => {
      const d = dragRef.current
      if (!d) return
      dragRef.current = { ...d, x: e.clientX, y: e.clientY, moved: d.moved || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6 }
      if (dragRef.current.moved) setDrag(dragRef.current)
    }
    const up = (e) => {
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!d?.moved) return
      draggedRef.current = true
      setTimeout(() => (draggedRef.current = false), 50)
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-square]")
      if (el) go(d.from, Number(el.dataset.square))
      else setSel(null)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
    }
  }, [!!drag, game])

  const board = wrong?.board || game.board
  const last = wrong ? wrong.last : game.last
  const checkSq = (wrong ? wrong.check : game.check) ? board.indexOf((wrong ? wrong.turn : game.turn) === "w" ? "K" : "k") : -1
  const order = Array.from({ length: 64 }, (_, i) => (flipped ? 63 - i : i))
  const cell = size / 8
  const fileLabels = flipped ? [...FILES].reverse() : [...FILES]
  const rankLabels = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1]
  // square -> its screen column/row (for slides)
  const pos = (sq) => {
    const i = flipped ? 63 - sq : sq
    return { c: i % 8, r: Math.floor(i / 8) }
  }
  const slideFor = (sq) => {
    if (!slide || slide.to !== sq || wrong) return null
    const a = pos(slide.from)
    const b = pos(slide.to)
    return { dx: a.c - b.c, dy: a.r - b.r, key: slide.key }
  }

  return (
    <div className="chFrame cpFrame" style={{ width: size + 16, height: size + 16 }}>
      <div className="chRanks" aria-hidden="true">
        {rankLabels.map((r) => (
          <span key={r}>{r}</span>
        ))}
      </div>
      <div className="chBoard" style={{ width: size, height: size }} role="grid" aria-label="Chessboard" data-touch-surface>
        {order.map((sq) => {
          const piece = board[sq]
          const light = (Math.floor(sq / 8) + (sq % 8)) % 2 === 0
          const cls = ["chSquare", light ? "is-light" : "is-dark"]
          if (last && (last.from === sq || last.to === sq)) cls.push(wrong ? "is-wrong" : "is-last")
          if (active === sq) cls.push("is-selected")
          if (targetSet.has(sq)) cls.push(piece || (game.board[active]?.toLowerCase() === "p" && sq % 8 !== active % 8) ? "is-capture" : "is-target")
          if (sq === checkSq) cls.push("is-check")
          if (hint && (hint.from === sq || hint.to === sq)) cls.push("is-hint")
          if (interactive && mine(sq) && movesFrom(sq).length) cls.push("is-movable")
          const lifted = drag?.moved && drag.from === sq
          const s = slideFor(sq)
          return (
            <button
              type="button"
              key={sq}
              className={cls.join(" ")}
              data-square={sq}
              data-name={chess.squareName(sq)}
              onClick={() => click(sq)}
              onPointerDown={(e) => startDrag(e, sq)}
              aria-label={`${chess.squareName(sq)}${piece ? ` ${COLOR_NAME[chess.colorOf(piece)]} ${PIECE_NAMES[piece.toLowerCase()]}` : ""}`}
            >
              {piece && (s ? <Sliding piece={piece} slide={s} size={cell} /> : <ChessPiece piece={piece} className={lifted ? "chPiece is-lifted" : "chPiece"} />)}
            </button>
          )
        })}
      </div>
      <div className="chFiles" aria-hidden="true">
        {fileLabels.map((f) => (
          <span key={f}>{f}</span>
        ))}
      </div>
      {promo && (
        <div className="chPromo" role="dialog" aria-label="Promote to">
          <p>Promote to:</p>
          <div>
            {["q", "r", "b", "n"].map((p) => (
              <button type="button" key={p} data-promote={p} aria-label={PIECE_NAMES[p]} onClick={() => (setPromo(null), onMove({ ...promo, promotion: p }))}>
                <ChessPiece piece={you === "w" ? p.toUpperCase() : p} />
              </button>
            ))}
          </div>
          <button type="button" className="chPromoCancel" onClick={() => setPromo(null)}>
            Cancel
          </button>
        </div>
      )}
      {drag?.moved && (
        <div className="chDragGhost" style={{ left: drag.x, top: drag.y, width: cell, height: cell }}>
          <ChessPiece piece={game.board[drag.from]} />
        </div>
      )}
    </div>
  )
}

export default PuzzleBoard
