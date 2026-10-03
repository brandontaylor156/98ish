import React, { useRef } from "react"

// A board of tiles: the guesses so far (colored), the row being typed, and empty rows.
// New rows flip over one tile at a time; rows already there when the board appeared don't.
// rows: [{ word?, colors? }] (no word: colors only, an opponent's board; no colors: the
// clock ran out on that guess). max: rows to show (0 = as many as needed).

export const FLIP_MS = 250 // between one tile and the next

const Tile = ({ letter, state, flip, index, bounce, length, pop }) => {
  const cls = ["wdTile"]
  if (state) cls.push(`is-${state}`)
  else if (letter) cls.push("is-typed")
  if (flip) cls.push("is-flip")
  if (bounce) cls.push("is-bounce")
  if (pop) cls.push("is-pop")
  const style = flip || bounce ? { "--i": index, "--flipDelay": `${index * FLIP_MS}ms`, "--bounceDelay": `${length * FLIP_MS + index * 90}ms` } : undefined
  return (
    <div className={cls.join(" ")} style={style} data-state={state || (letter ? "typed" : "empty")}>
      <span>{letter ? letter.toUpperCase() : ""}</span>
    </div>
  )
}

const Board = ({ rows = [], length = 5, max = 6, typed = null, solvedAt = null, shake = 0, active = true, tile = 52, label, dim = false, className = "", testId }) => {
  const firstRows = useRef(rows.length) // rows that were already there: no flip
  const showTyped = typed !== null && solvedAt === null && (!max || rows.length < max)
  const count = Math.max(max || 0, rows.length + (showTyped ? 1 : 0), max ? 0 : 6)
  const gap = Math.max(2, Math.round(tile * 0.09))
  const out = []
  for (let r = 0; r < count; r++) {
    const row = rows[r]
    let tiles
    let cls = "wdRow"
    if (row) {
      const flip = r >= firstRows.current
      const solvedRow = r === solvedAt
      if (row.colors) {
        tiles = Array.from({ length }, (_, i) => <Tile key={i} index={i} length={length} letter={row.word?.[i]} state={row.colors[i]} flip={flip} bounce={flip && solvedRow} />)
      } else if (row.word === null || (!row.word && !row.colors)) {
        cls += " is-timeout"
        tiles = Array.from({ length }, (_, i) => <Tile key={i} index={i} length={length} letter="" state="x" flip={flip} />)
      } else {
        tiles = Array.from({ length }, (_, i) => <Tile key={i} index={i} length={length} letter={row.word?.[i]} />)
      }
      if (solvedAt !== null && r > solvedAt) cls += " is-after"
    } else if (r === rows.length && showTyped) {
      cls += " is-current"
      tiles = Array.from({ length }, (_, i) => <Tile key={`${i}:${typed[i] || ""}`} index={i} length={length} letter={typed[i]} pop={!!typed[i] && i === typed.length - 1} />)
      // a new key each time it shakes, so the animation plays again
      out.push(
        <div key={`typing:${r}:${shake}`} className={shake ? `${cls} is-shake` : cls} style={{ gap }}>
          {tiles}
        </div>
      )
      continue
    } else {
      cls += solvedAt !== null ? " is-after" : ""
      tiles = Array.from({ length }, (_, i) => <Tile key={i} index={i} length={length} />)
    }
    out.push(
      <div key={r} className={cls} style={{ gap }}>
        {tiles}
      </div>
    )
  }
  return (
    <div className={`wdBoard${solvedAt !== null ? " is-solved" : ""}${active ? "" : " is-idle"}${dim ? " is-dim" : ""} ${className}`} style={{ "--tile": `${tile}px`, gap }} data-testid={testId}>
      {label && <div className="wdBoardLabel">{label}</div>}
      {out}
    </div>
  )
}

export default Board

// A small board for the opponent strip: just the colors (letters too when `letters`)
export const MiniBoard = ({ rows = [], length = 5, max = 6, size = 9, letters = false, solved = false }) => {
  const count = Math.max(max || 0, rows.length, max ? 0 : 1)
  const shown = count > 10 ? rows.slice(-10) : null
  const list = shown || Array.from({ length: count }, (_, r) => rows[r])
  return (
    <div className={`wdMini${solved ? " is-solved" : ""}`} style={{ "--mini": `${size}px` }}>
      {list.map((row, r) => (
        <div key={r} className="wdMiniRow">
          {Array.from({ length }, (_, i) => (
            <span key={i} className={`wdMiniTile ${row?.colors ? `is-${row.colors[i]}` : row ? "is-x" : ""}`}>
              {letters && row?.word ? row.word[i].toUpperCase() : ""}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}
