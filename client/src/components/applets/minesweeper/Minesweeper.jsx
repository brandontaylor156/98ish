import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import { useIsTouch } from "../../../hooks/useMediaQuery"
import { LEVELS, LIMITS, chord, clampCustom, createGame, createSeededGame, cycleMark, elapsedSeconds, maxMinesFor, minesLeft, neighbors, reveal } from "./engine"
import { Face, FlagIcon, Led, MineIcon } from "./graphics"
import "./Minesweeper.css"

const SETTINGS_KEY = "98ish.minesweeper"
const BEST_KEY = "98ish.minesweeper.best"
const LONG_PRESS_MS = 350
const TOUCH_SLOP = 10 // px a finger can drift before a long press is cancelled
const DESKTOP_CELL = 20

const load = (key, fallback) => {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key)) }
  } catch {
    return fallback
  }
}
const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable: settings last for this visit
  }
}

const DEFAULT_SETTINGS = { level: "beginner", custom: { rows: 16, cols: 30, mines: 99 }, marks: true }
const DEFAULT_BEST = Object.fromEntries(Object.keys(LEVELS).map((level) => [level, { seconds: 999, name: "Anonymous" }]))

const fieldFor = (settings) => (settings.level === "custom" ? clampCustom(settings.custom) : LEVELS[settings.level])

const Cell = React.memo(({ index, cell, pressed, exploded, lost }) => {
  const open = cell.state === "revealed"
  const classes = ["msCell"]
  if (open || (pressed && cell.state !== "flagged")) classes.push("is-open")
  if (exploded) classes.push("is-exploded")
  if (open && !cell.mine && cell.adjacent) classes.push(`n${cell.adjacent}`)

  let content = null
  if (cell.state === "flagged") content = lost && cell.wrongFlag ? <MineIcon crossed /> : <FlagIcon />
  else if (cell.state === "question") content = "?"
  else if (open && cell.mine) content = <MineIcon />
  else if (open && cell.adjacent) content = cell.adjacent

  return (
    <div className={classes.join(" ")} data-index={index}>
      {content}
    </div>
  )
})

// Minesweeper Race (Network Neighborhood) plays on a board fixed by a seed:
// race = { seed, round, field, startAt, frozen, over, onProgress(game), onResign, panel, overlay }
const raceGame = (race) => ({ ...createSeededGame(race.field, race.seed), startedAt: race.startAt })

const Minesweeper = ({ fitWindow, onClose, race }) => {
  const touch = useIsTouch()
  const [settings, setSettings] = useState(() => load(SETTINGS_KEY, DEFAULT_SETTINGS))
  const [best, setBest] = useState(() => load(BEST_KEY, DEFAULT_BEST))
  const [game, setGame] = useState(() => (race ? raceGame(race) : createGame(fieldFor(settings))))
  const [now, setNow] = useState(Date.now())
  const [pressed, setPressed] = useState(null) // { mode: "reveal" | "chord", index }
  const [flagMode, setFlagMode] = useState(false)
  const [dialog, setDialog] = useState(null)
  const [area, setArea] = useState({ width: 0, height: 0 })

  const rootRef = useRef(null)
  const areaRef = useRef(null)
  const gameRef = useRef(null)
  const boardRef = useRef(null)
  const press = useRef(null)
  const gameState = useRef(game)
  gameState.current = game

  const update = (next) => {
    gameState.current = next
    setGame(next)
  }

  const newGame = (nextSettings = settings) => {
    if (race) return
    update(createGame(fieldFor(nextSettings)))
    setPressed(null)
    press.current = null
  }

  const changeSettings = (patch) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    save(SETTINGS_KEY, next)
    if (patch.level || patch.custom) newGame(next)
  }

  // ---- racing: a rematch deals a new board; every move is reported ----
  const raceRound = race && `${race.seed}:${race.round}`
  const firstRound = useRef(raceRound)
  useEffect(() => {
    if (!race || raceRound === firstRound.current) return
    firstRound.current = raceRound
    update(raceGame(race))
    endPress()
  }, [raceRound])
  useEffect(() => {
    race?.onProgress?.(game)
  }, [game])

  // ---- clock ----
  useEffect(() => {
    if (game.status !== "playing" || race?.over) return
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [game.status])

  // ---- winning: a new best time asks for your name, like the original ----
  useEffect(() => {
    if (game.status !== "won" || settings.level === "custom" || race) return
    const seconds = elapsedSeconds(game)
    if (seconds < best[settings.level].seconds) setDialog({ kind: "record", seconds, name: "Anonymous" })
  }, [game.status])

  // ---- size: on a desktop the window fits the board; on a phone the board fits the screen ----
  useEffect(() => {
    const el = areaRef.current
    // the space inside the area's padding
    const measure = () => {
      const style = getComputedStyle(el)
      setArea({
        width: el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height: el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const { rows, cols } = game
  const fitted = !fitWindow // phones and maximized windows: scale cells to the space
  const layout = useMemo(() => {
    if (!fitted || !area.width) return { cell: DESKTOP_CELL, transposed: false }
    // room left for the grid: the panel's padding and borders take 24px each way, the
    // header 47px and the touch Dig/Flag bar 42px
    const w = area.width - 24
    const h = area.height - 24 - 47 - (touch ? 42 : 0) - (race ? 50 : 0)
    // Fingers need at least 22px squares (Expert turned sideways just fits a phone's
    // width at that size); a board too big for that scrolls instead
    const sizeFor = (c, r) => Math.max(touch ? 22 : 14, Math.min(44, Math.floor(Math.min(w / c, h / r))))
    const straight = sizeFor(cols, rows)
    const turned = sizeFor(rows, cols)
    const overflow = (c, r, size) => Math.max(0, c * size - w) + Math.max(0, r * size - h)
    if (turned === straight) {
      // same square size either way: turn only if that scrolls less
      return { cell: straight, transposed: overflow(rows, cols, turned) < overflow(cols, rows, straight) }
    }
    // Wide boards (Expert) turn sideways on a tall screen when that makes the cells bigger
    return turned > straight ? { cell: turned, transposed: true } : { cell: straight, transposed: false }
  }, [fitted, area, rows, cols, touch])

  useLayoutEffect(() => {
    if (!fitWindow) return
    const root = rootRef.current
    const windowEl = root.closest(".window")
    const frameW = windowEl.offsetWidth - root.clientWidth
    const frameH = windowEl.offsetHeight - root.clientHeight
    const menuH = root.querySelector(".menuBar").offsetHeight
    fitWindow(gameRef.current.offsetWidth + frameW + 16, gameRef.current.offsetHeight + menuH + frameH + 16)
  }, [rows, cols, layout.cell, !!fitWindow])

  // ---- input ----
  const finished = game.status === "won" || game.status === "lost"

  const indexAt = (event) => {
    const el = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-index]")
    return el && boardRef.current.contains(el) ? Number(el.dataset.index) : null
  }

  // mode: "reveal" (left / touch), "chord" (middle, or left + right), "right" (right button
  // alone: already flagged on press, but becomes a chord if left joins in)
  const startPress = (event, mode, index) => {
    press.current = { mode, index, id: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY }
    setPressed(mode === "right" ? null : { mode, index })
  }

  const endPress = () => {
    clearTimeout(press.current?.timer)
    press.current = null
    setPressed(null)
  }

  const onPointerDown = (event) => {
    if (finished || press.current || race?.frozen) return
    const index = indexAt(event)
    if (index === null) return
    event.preventDefault()
    rootRef.current.focus({ preventScroll: true }) // for F2
    boardRef.current.setPointerCapture(event.pointerId)

    if (event.pointerType === "mouse") {
      if (event.button === 2) {
        update(cycleMark(gameState.current, index, settings.marks))
        return startPress(event, "right", index)
      }
      if (event.button === 1) return startPress(event, "chord", index)
      if (event.button === 0) return startPress(event, "reveal", index)
      return
    }
    // Touch: tap reveals (or flags, in flag mode); a long press flags
    startPress(event, "reveal", index)
    press.current.timer = setTimeout(() => {
      if (!press.current || press.current.id !== event.pointerId) return
      press.current.longPressed = true
      navigator.vibrate?.(15)
      update(cycleMark(gameState.current, press.current.index, settings.marks))
      setPressed(null)
    }, LONG_PRESS_MS)
  }

  const onPointerMove = (event) => {
    const p = press.current
    if (!p || p.id !== event.pointerId || p.longPressed) return
    if (p.type !== "mouse" && Math.hypot(event.clientX - p.x, event.clientY - p.y) > TOUCH_SLOP) clearTimeout(p.timer)
    // Left + right together = chord (the second button arrives as a move, not a press)
    if (p.type === "mouse" && event.buttons === 3) p.mode = "chord"
    else if (p.type === "mouse" && p.mode === "chord" && p.chorded === undefined && event.buttons !== 3 && event.buttons !== 4) {
      // one of the two buttons came up: chord now, ignore the rest of this press
      p.chorded = true
      if (p.index !== null) update(chord(gameState.current, p.index))
      return setPressed(null)
    }
    const index = indexAt(event)
    p.index = index
    if (p.mode === "right") return
    setPressed(index === null ? null : { mode: p.mode, index })
  }

  const onPointerUp = (event) => {
    const p = press.current
    if (!p || p.id !== event.pointerId) return
    const index = indexAt(event) ?? null
    const current = gameState.current
    if (!p.longPressed && !p.chorded && p.mode !== "right" && index !== null) {
      const cell = current.cells[index]
      if (p.mode === "chord" || cell.state === "revealed") update(chord(current, index))
      else if (flagMode && p.type !== "mouse") update(cycleMark(current, index, settings.marks))
      else update(reveal(current, index))
    }
    endPress()
  }

  // ---- render ----
  const pressedSet = useMemo(() => {
    if (!pressed || pressed.index === null) return new Set()
    const cells = game.cells
    if (pressed.mode === "chord") {
      return new Set([pressed.index, ...neighbors(game, pressed.index)].filter((i) => cells[i].state === "hidden" || cells[i].state === "question"))
    }
    return cells[pressed.index].state === "hidden" || cells[pressed.index].state === "question" ? new Set([pressed.index]) : new Set()
  }, [pressed, game])

  const face = game.status === "lost" ? "dead" : game.status === "won" ? "cool" : pressed ? "oh" : "smile"
  const displayCols = layout.transposed ? rows : cols
  const displayRows = layout.transposed ? cols : rows
  const order = useMemo(() => {
    const list = []
    for (let r = 0; r < displayRows; r++) for (let c = 0; c < displayCols; c++) list.push(layout.transposed ? c * cols + r : r * cols + c)
    return list
  }, [displayRows, displayCols, layout.transposed, cols])

  const levelLabel = settings.level === "custom" ? "Custom" : LEVELS[settings.level].label

  const menus = race
    ? [
        {
          label: "Game",
          items: [
            { label: "Resign", disabled: race.over, onClick: () => race.onResign?.() },
            "-",
            { label: "Marks (?)", checked: settings.marks, onClick: () => changeSettings({ marks: !settings.marks }) },
            "-",
            { label: "Exit", onClick: () => onClose?.() },
          ],
        },
        { label: "Help", items: [{ label: "How to Play...", onClick: () => setDialog({ kind: "help" }) }] },
      ]
    : [
    {
      label: "Game",
      items: [
        { label: "New F2", onClick: () => newGame() },
        "-",
        ...Object.entries(LEVELS).map(([level, { label }]) => ({
          label,
          checked: settings.level === level,
          onClick: () => changeSettings({ level }),
        })),
        { label: "Custom...", checked: settings.level === "custom", onClick: () => setDialog({ kind: "custom", ...fieldFor({ ...settings, level: "custom" }) }) },
        "-",
        { label: "Marks (?)", checked: settings.marks, onClick: () => changeSettings({ marks: !settings.marks }) },
        "-",
        { label: "Best Times...", onClick: () => setDialog({ kind: "best" }) },
        "-",
        { label: "Exit", onClick: () => onClose?.() },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "How to Play...", onClick: () => setDialog({ kind: "help" }) },
        { label: "About Minesweeper...", onClick: () => setDialog({ kind: "about" }) },
      ],
    },
  ]

  return (
    <div
      className="msRoot"
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "F2") {
          e.preventDefault()
          newGame()
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuBar menus={menus} />
      <div className="msArea" ref={areaRef}>
        <div className="msGame" ref={gameRef} style={{ "--ms-cell": `${layout.cell}px`, ...(race && { position: "relative" }) }}>
          {race?.panel}
          <div className="msHeader">
            <Led value={minesLeft(game)} label="Mines left" />
            <button type="button" className="msFaceButton" aria-label={race ? "Face" : "New game"} onClick={() => newGame()}>
              <Face face={face} />
            </button>
            <Led value={elapsedSeconds(game, now)} label="Seconds" />
          </div>
          {touch && (
            <div className="msModeBar">
              <button type="button" className={flagMode ? "" : "is-on"} aria-pressed={!flagMode} onClick={() => setFlagMode(false)}>
                Dig
              </button>
              <button type="button" className={flagMode ? "is-on" : ""} aria-pressed={flagMode} onClick={() => setFlagMode(true)}>
                <FlagIcon /> Flag
              </button>
            </div>
          )}
          <div
            className="msBoard"
            ref={boardRef}
            style={{ gridTemplateColumns: `repeat(${displayCols}, var(--ms-cell))` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={endPress}
          >
            {order.map((index) => (
              <Cell
                key={index}
                index={index}
                cell={game.cells[index]}
                pressed={pressedSet.has(index)}
                exploded={game.exploded === index}
                lost={game.status === "lost"}
              />
            ))}
          </div>
          {race?.overlay}
        </div>
      </div>

      {dialog?.kind === "custom" && (
        <Dialog
          title="Custom Field"
          onOk={() => {
            changeSettings({ level: "custom", custom: clampCustom(dialog) })
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          {[
            ["rows", "Height", LIMITS.minRows, LIMITS.maxRows],
            ["cols", "Width", LIMITS.minCols, LIMITS.maxCols],
            ["mines", "Mines", LIMITS.minMines, maxMinesFor(LIMITS.maxRows, LIMITS.maxCols)],
          ].map(([key, label, min, max]) => (
            <label key={key} className="msField">
              <span>{label}:</span>
              <input
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                value={dialog[key]}
                onChange={(e) => setDialog({ ...dialog, [key]: e.target.value })}
              />
            </label>
          ))}
        </Dialog>
      )}

      {dialog?.kind === "record" && (
        <Dialog
          title="Congratulations"
          onOk={() => {
            const next = { ...best, [settings.level]: { seconds: dialog.seconds, name: dialog.name.trim() || "Anonymous" } }
            setBest(next)
            save(BEST_KEY, next)
            setDialog({ kind: "best" })
          }}
        >
          <p className="dialogText">
            You have the fastest time for {levelLabel.toLowerCase()} level. Please type your name:
          </p>
          <input value={dialog.name} maxLength={32} onChange={(e) => setDialog({ ...dialog, name: e.target.value })} />
        </Dialog>
      )}

      {dialog?.kind === "best" && (
        <Dialog title="Fastest Mine Sweepers" onOk={() => setDialog(null)}>
          <table className="msBest">
            <tbody>
              {Object.entries(LEVELS).map(([level, { label }]) => (
                <tr key={level}>
                  <th>{label}:</th>
                  <td>{best[level].seconds} sec</td>
                  <td>{best[level].name}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="msResetScores"
            onClick={() => {
              setBest(DEFAULT_BEST)
              save(BEST_KEY, DEFAULT_BEST)
            }}
          >
            Reset Scores
          </button>
        </Dialog>
      )}

      {dialog?.kind === "help" && (
        <Dialog title="How to Play" onOk={() => setDialog(null)}>
          <p className="dialogText">
            Find every mine without stepping on one. Numbers tell you how many mines touch that square.
            <br />
            <br />
            <b>Left-click</b> a square to uncover it. <b>Right-click</b> to place a flag (again for a ?).{" "}
            <b>Click a number</b> (or press both buttons on it) when all its mines are flagged to uncover the rest of its
            neighbors.
            <br />
            <br />
            On a touch screen: <b>tap</b> to uncover, <b>press and hold</b> to flag, or switch to <b>Flag</b> mode.
          </p>
        </Dialog>
      )}

      {dialog?.kind === "about" && (
        <Dialog title="About Minesweeper" onOk={() => setDialog(null)}>
          <p className="dialogText">
            <b>Minesweeper</b> for 98ish.
            <br />
            Beginner, Intermediate, Expert and Custom fields, best times, marks and chording, just like the original.
          </p>
        </Dialog>
      )}
    </div>
  )
}

export default Minesweeper
