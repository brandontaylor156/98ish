import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import * as S from "./slide.js"
import { formatTime } from "./image"

// A slide puzzle: click or tap a square in the gap's row or column to slide it (and the
// ones between) over. Arrow keys slide the square next to the gap. When it's solved the
// missing corner comes back.

const SlidePuzzle = ({ picture, setup, seed, initial, prefs, sounds, onChange, onSolved, solved: solvedProp }) => {
  const n = setup.size
  const [tiles, setTiles] = useState(() => (initial?.tiles?.length === n * n && S.isSolvable(initial.tiles, n) ? initial.tiles : S.shuffle(n, seed)))
  const [moves, setMoves] = useState(initial?.moves || 0)
  const elapsedBase = useRef(initial?.elapsed || 0)
  const startedAt = useRef(Date.now())
  const [now, setNow] = useState(Date.now())
  const boxRef = useRef(null)
  const [box, setBox] = useState(null)
  const solved = solvedProp || S.isSolved(tiles)
  const elapsed = () => (solved ? elapsedBase.current : elapsedBase.current + (Date.now() - startedAt.current))

  useLayoutEffect(() => {
    const el = boxRef.current
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (solved) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [solved])

  // for the tests: the board as it is, and a way to deal an easy one
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__puzzle = { ...(window.__puzzle || {}), slide: () => ({ n, tiles }), slideScramble: (k) => setTiles(S.scramble(n, k, 7)) }
  })

  const slide = (index) => {
    if (solved) return
    const result = S.move(tiles, n, index)
    if (!result.moved) return
    sounds?.slide()
    const next = result.tiles
    const count = moves + 1
    setTiles(next)
    setMoves(count)
    if (S.isSolved(next)) {
      elapsedBase.current = elapsed()
      onChange?.({ tiles: next, moves: count, elapsed: elapsedBase.current })
      onSolved?.(elapsedBase.current, count)
    } else onChange?.({ tiles: next, moves: count, elapsed: elapsed() })
  }

  // arrows: the square on that side of the gap slides into it
  const onKeyDown = (e) => {
    const gap = tiles.indexOf(0)
    const r = Math.floor(gap / n)
    const c = gap % n
    const target = { ArrowUp: r < n - 1 ? gap + n : -1, ArrowDown: r > 0 ? gap - n : -1, ArrowLeft: c < n - 1 ? gap + 1 : -1, ArrowRight: c > 0 ? gap - 1 : -1 }[e.key]
    if (target === undefined) return
    e.preventDefault()
    if (target >= 0) slide(target)
  }
  const rootRef = useRef(null)
  useEffect(() => rootRef.current?.focus({ preventScroll: true }), [])

  // the board: as big as fits, the picture's shape
  const aspect = picture.width / picture.height
  let bw = 0
  let bh = 0
  if (box) {
    bw = Math.min(box.w - 16, (box.h - 16) * aspect)
    bh = bw / aspect
  }
  const tw = bw / n
  const th = bh / n

  return (
    <div className="pzSlide" ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="pzStatus">
        <span>⏱ {formatTime(solved ? elapsedBase.current : elapsedBase.current + (now - startedAt.current))}</span>
        <span>{moves} {moves === 1 ? "move" : "moves"}</span>
      </div>
      <div className="pzSlideBox" ref={boxRef}>
        {box && bw > 0 && (
          <div className={`pzSlideBoard${solved ? " is-solved" : ""}`} style={{ width: bw, height: bh }}>
            {tiles.map((t, i) => {
              if (t === 0 && !solved) return null
              const home = (t === 0 ? n * n : t) - 1
              const r = Math.floor(i / n)
              const c = i % n
              const hr = Math.floor(home / n)
              const hc = home % n
              const movable = !solved && S.canMove(tiles, n, i)
              return (
                <button
                  type="button"
                  key={t}
                  data-tile={t}
                  data-index={i}
                  className={`pzTile${movable ? " is-movable" : ""}${t === 0 ? " is-last" : ""}`}
                  style={{
                    width: tw,
                    height: th,
                    transform: `translate(${c * tw}px, ${r * th}px)`,
                    backgroundImage: `url(${picture.data})`,
                    backgroundSize: `${bw}px ${bh}px`,
                    backgroundPosition: `${-hc * tw}px ${-hr * th}px`,
                  }}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    slide(i)
                  }}
                  aria-label={`Tile ${t}`}
                >
                  {prefs.numbers && t !== 0 && <span className="pzTileNum">{t}</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default SlidePuzzle
