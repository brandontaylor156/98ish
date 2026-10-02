import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import Dialog from "../../shared/Dialog"
import { unlock } from "../../../utils/achievements"
import * as E from "./engine"
import { createSounds } from "./audio"
import { bestFor, loadData, loadGame, recordScore, saveGame, savePrefs } from "./storage"
import "./BlockTen.css"

// Block Ten: drag pieces onto a 10x10 board; full rows and columns clear. Three pieces at
// a time, no rotating. The game ends when none of the pieces left fits anywhere.
// Modes: Classic, Daily Challenge (the same pieces for everyone today) and Blast (3 minutes).

const THEMES = [
  { id: "classic", label: "Classic 98" },
  { id: "neon", label: "Neon" },
  { id: "pastel", label: "Pastel" },
]
const MODE_LABELS = { classic: "Classic", daily: "Daily Challenge", blast: "Blast (3 minutes)" }
const fmtTime = (s) => {
  const t = Math.ceil(s)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`
}
const fmtNum = (n) => n.toLocaleString("en-US")

// how big everything is, from the space the game has (board on top and the tray below
// in a tall window; side by side in a wide one)
const PAD = 8
const GAP = 8
const SCORE_H = 46
const FRAME = 8 // the board's bevel and padding, both sides together
const layoutFor = (W, H) => {
  const portrait = Math.min(W - 2 * PAD, (H - 2 * PAD - SCORE_H - 2 * GAP) / 1.34)
  const landscape = Math.min(H - 2 * PAD, (W - 2 * PAD - GAP) / 1.5)
  const wide = landscape > portrait * 1.04
  const board = Math.max(120, Math.floor(wide ? landscape : portrait))
  const cell = Math.floor((board - FRAME) / 10)
  const boardPx = cell * 10 + FRAME
  let slotW, slotH, trayRow
  if (!wide) {
    trayRow = true
    slotW = Math.floor(boardPx / 3)
    slotH = Math.floor(Math.max(boardPx * 0.34, Math.min(slotW, H - 2 * PAD - SCORE_H - 2 * GAP - boardPx)))
  } else {
    const side = Math.max(140, Math.min(W - 2 * PAD - GAP - boardPx, boardPx * 0.95))
    const trayH = boardPx - SCORE_H - GAP
    // three in a row or three stacked: whichever gives bigger slots
    trayRow = Math.min(side / 3, trayH) >= Math.min(side, trayH / 3)
    slotW = Math.floor(trayRow ? side / 3 : side)
    slotH = Math.floor(trayRow ? Math.min(trayH, side / 3 + 20) : trayH / 3)
  }
  const mini = Math.max(8, Math.min(Math.round(cell * 0.62), Math.floor((Math.min(slotW, slotH) - 10) / 5)))
  return { wide, cell, boardPx, slotW, slotH, trayRow, mini, sideW: wide ? (trayRow ? slotW * 3 : slotW) : boardPx }
}

// a piece drawn as blocks, `size` px each
const PieceView = ({ id, size, className = "", style }) => {
  const p = E.PIECES[id]
  return (
    <div className={`btPiece ${className}`} style={{ width: p.w * size, height: p.h * size, ...style }}>
      {p.cells.map(([r, c]) => (
        <div key={`${r},${c}`} className={`btBlock btC${p.color}`} style={{ left: c * size, top: r * size, width: size, height: size }} />
      ))}
    </div>
  )
}

const BlockTen = ({ onClose, mobile }) => {
  const chatItem = useGameChatMenuItem("blockten")
  const rootRef = useRef(null)
  const stageRef = useRef(null)
  const gridRef = useRef(null)
  const ghostRef = useRef(null)
  const slotRefs = useRef([])
  const soundsRef = useRef(null)
  if (!soundsRef.current) soundsRef.current = createSounds()
  const sounds = soundsRef.current

  const [data, setData] = useState(loadData)
  const [dayKey, setDayKey] = useState(E.dailyKey)
  const [game, setGameState] = useState(() => {
    const saved = loadGame()
    if (saved && (saved.game.mode !== "daily" || saved.dayKey === E.dailyKey())) return saved.game
    return E.newGame()
  })
  const gameRef = useRef(game)
  const setGame = (next) => {
    gameRef.current = typeof next === "function" ? next(gameRef.current) : next
    setGameState(gameRef.current)
  }
  const [layout, setLayout] = useState(null)
  const [drag, setDrag] = useState(null) // { slot, id, touch, returning }
  const dragRef = useRef(null)
  const [preview, setPreview] = useState(null) // { id, r, c, rows, cols }
  const [effects, setEffects] = useState({ clears: [], pops: [], landed: [] })
  const [over, setOver] = useState(null) // { score, best, place, reason }
  const [dialog, setDialog] = useState(null)
  const [shown, setShown] = useState(game.score) // the score counting up
  const fxId = useRef(0)

  const theme = THEMES.some((t) => t.id === data.theme) ? data.theme : "classic"
  const best = Math.max(bestFor(data, game.mode, dayKey), over ? 0 : shown)

  useEffect(() => {
    sounds.setEnabled(data.sound)
  }, [data.sound])
  useEffect(() => () => sounds.close(), [])

  // ---- sizing ----
  useLayoutEffect(() => {
    const el = stageRef.current
    const fit = () => {
      const r = el.getBoundingClientRect()
      if (r.width && r.height) setLayout(layoutFor(r.width, r.height))
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ---- keep the game in progress ----
  useEffect(() => {
    if (!game.over) saveGame(game, dayKey)
    else saveGame(null)
  }, [game])

  // ---- the score counts up ----
  useEffect(() => {
    if (shown === game.score) return
    if (shown > game.score) return setShown(game.score)
    const id = requestAnimationFrame(() => setShown((s) => Math.min(game.score, s + Math.max(1, Math.ceil((game.score - s) / 6)))))
    return () => cancelAnimationFrame(id)
  }, [shown, game.score])

  // ---- starting over ----
  const start = (mode = gameRef.current.mode) => {
    const key = E.dailyKey()
    setDayKey(key)
    setGame(E.newGame({ mode, seed: mode === "daily" ? E.dailySeed(key) : undefined }))
    setShown(0)
    setOver(null)
    setPreview(null)
    setEffects({ clears: [], pops: [], landed: [] })
    cancelDrag()
    rootRef.current?.focus()
  }

  const doUndo = () => {
    if (!E.canUndo(gameRef.current)) return
    setGame(E.undo(gameRef.current))
    setOver(null)
    setEffects({ clears: [], pops: [], landed: [] })
    sounds.pick()
  }

  // ---- the end of a game: record the score once ----
  useEffect(() => {
    if (!game.over || game.recorded) return
    const g = { ...game, recorded: true }
    setGame(g)
    const entry = { score: g.score, lines: g.lines, date: Date.now() }
    const saved = recordScore(g.mode, entry, dayKey)
    setData(saved.data)
    setOver({ score: g.score, place: saved.place, best: saved.best, reason: g.over })
    if (saved.best) setTimeout(() => sounds.best(), 500)
    else sounds.over()
  }, [game.over])

  // ---- Blast's clock (stops while the page is hidden or a dialog is open) ----
  useEffect(() => {
    if (game.mode !== "blast" || game.over || dialog) return
    let last = performance.now()
    const id = setInterval(() => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      if (document.hidden) return
      const before = gameRef.current.timeLeft
      setGame((g) => E.tick(g, dt))
      const after = gameRef.current.timeLeft
      if (after <= 10 && Math.ceil(after) < Math.ceil(before)) sounds.tick()
      if (gameRef.current.over) cancelDrag()
    }, 200)
    return () => clearInterval(id)
  }, [game.mode, !!game.over, !!dialog])

  // ---- effects: popping cells and floating scores, cleaned up when they're done ----
  const addEffects = (result) => {
    const key = ++fxId.current
    const pitch = layout.cell
    // the middle of the placed piece, where the score floats up from
    const cy = (result.placed.reduce((s, i) => s + Math.floor(i / 10), 0) / result.placed.length + 0.5) * pitch
    // (kept away from the sides so the text isn't cut off)
    const cx = Math.max(1.6, Math.min(8.4, result.placed.reduce((s, i) => s + (i % 10), 0) / result.placed.length + 0.5)) * pitch
    const mid = { r: cy / pitch - 0.5, c: result.placed.reduce((s, i) => s + (i % 10), 0) / result.placed.length }
    const clears = result.cleared.map(({ i, color }) => ({
      key: `${key}-${i}`,
      i,
      color,
      delay: Math.round(Math.hypot(Math.floor(i / 10) - mid.r, (i % 10) - mid.c) * 28),
    }))
    const pops = [{ key: `${key}-p`, x: cx, y: cy, text: `+${result.points}`, kind: result.combo ? "big" : "" }]
    if (result.combo >= 2) pops.push({ key: `${key}-c`, x: cx, y: cy - pitch * 0.9, text: `Combo x${result.combo}!`, kind: "combo" })
    if (result.streak >= 2) pops.push({ key: `${key}-s`, x: cx, y: cy - pitch * (result.combo >= 2 ? 1.7 : 0.9), text: `Streak x${result.streak}`, kind: "streak" })
    if (result.boardBonus) pops.push({ key: `${key}-b`, x: pitch * 5, y: pitch * 5, text: `Clean board! +${result.boardBonus}`, kind: "combo" })
    setEffects((fx) => ({ clears: [...fx.clears, ...clears], pops: [...fx.pops, ...pops], landed: result.placed }))
    setTimeout(() => {
      setEffects((fx) => ({
        ...fx,
        clears: fx.clears.filter((c) => !c.key.startsWith(`${key}-`)),
        pops: fx.pops.filter((p) => !p.key.startsWith(`${key}-`)),
      }))
    }, 1100)
  }

  const commit = (slot, r, c) => {
    const res = E.place(gameRef.current, slot, r, c)
    if (!res) return false
    const { result } = res
    setGame(res.state)
    sounds.place(E.PIECES[result.id].cells.length)
    if (result.combo) setTimeout(() => sounds.clear(result.combo, result.streak), 40)
    else if (result.dealt && !result.over) setTimeout(() => sounds.deal(), 120)
    addEffects(result)
    if (result.combo >= 3) unlock("blockten-combo")
    if (res.state.score >= 1000) unlock("blockten-1000")
    return true
  }

  // ---- dragging a piece from the tray ----
  // the ghost is moved directly (no re-render per move); only the landing preview is state
  const local = (e) => {
    const r = rootRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const lift = () => Math.max(40, layout.cell * 1.1)
  const ghostAt = (d, p) => {
    const piece = E.PIECES[d.id]
    const w = piece.w * layout.cell
    const h = piece.h * layout.cell
    // on a touch screen the piece rides above the finger so you can see where it goes
    return d.touch ? { x: p.x - w / 2, y: p.y - h - lift() } : { x: p.x - w / 2, y: p.y - h / 2 }
  }
  const moveGhost = (pos, scale = 1) => {
    if (ghostRef.current) ghostRef.current.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${scale})`
  }
  const targetFor = (d, pos) => {
    const grid = gridRef.current.getBoundingClientRect()
    const root = rootRef.current.getBoundingClientRect()
    const r = Math.round((pos.y - (grid.top - root.top)) / layout.cell)
    const c = Math.round((pos.x - (grid.left - root.left)) / layout.cell)
    const piece = E.PIECES[d.id]
    const onBoard = r > -piece.h && c > -piece.w && r < 10 && c < 10
    return { r, c, onBoard, ok: E.canPlace(gameRef.current.board, d.id, r, c) }
  }
  const updatePreview = (d, t) => {
    const key = t.ok ? `${d.id}:${t.r}:${t.c}` : null
    if (d.previewKey === key) return
    d.previewKey = key
    setPreview(t.ok ? { id: d.id, r: t.r, c: t.c, ...E.wouldClear(gameRef.current.board, d.id, t.r, t.c) } : null)
  }

  const slotOrigin = (slot, id) => {
    // where the tray drawing of a piece sits (for the snap back)
    const el = slotRefs.current[slot]
    const root = rootRef.current.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const p = E.PIECES[id]
    return { x: r.left - root.left + (r.width - p.w * layout.mini) / 2, y: r.top - root.top + (r.height - p.h * layout.mini) / 2 }
  }

  const cancelDrag = () => {
    dragRef.current = null
    setDrag(null)
    setPreview(null)
  }

  const onSlotDown = (slot) => (e) => {
    const g = gameRef.current
    const id = g.tray[slot]
    if (!id || g.over || dragRef.current || !layout || e.button > 0) return
    e.preventDefault()
    rootRef.current?.focus({ preventScroll: true })
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const d = { slot, id, pointerId: e.pointerId, touch: e.pointerType !== "mouse", previewKey: null }
    dragRef.current = d
    d.pos = ghostAt(d, local(e))
    setDrag({ slot, id, touch: d.touch, start: d.pos })
    sounds.pick()
  }
  const onSlotMove = (e) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId || d.returning) return
    d.pos = ghostAt(d, local(e))
    moveGhost(d.pos)
    updatePreview(d, targetFor(d, d.pos))
  }
  const onSlotUp = (e) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId || d.returning) return
    if (e.type === "pointerup") {
      d.pos = ghostAt(d, local(e))
      const t = targetFor(d, d.pos)
      if (t.ok && commit(d.slot, t.r, t.c)) return cancelDrag()
      if (t.onBoard) sounds.bad()
    }
    // didn't fit: fly back to the tray
    d.returning = true
    setPreview(null)
    const home = slotOrigin(d.slot, d.id)
    const el = ghostRef.current
    if (el) {
      el.classList.add("is-returning")
      moveGhost(home, layout.mini / layout.cell)
    }
    setTimeout(() => dragRef.current === d && cancelDrag(), 190)
  }

  // the ghost appears where the drag started
  useLayoutEffect(() => {
    if (drag && !drag.returning && ghostRef.current) moveGhost(drag.start)
  }, [drag])

  // ---- keys ----
  const onKeyDown = (e) => {
    const used = () => (e.preventDefault(), e.stopPropagation())
    if (e.key === "F2") return used(), start()
    if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) return used(), doUndo()
    if (e.key === "Escape" && dragRef.current) return used(), onSlotUp({ pointerId: dragRef.current.pointerId, type: "cancel" })
  }

  // ---- options ----
  const setPref = (patch) => {
    savePrefs(patch)
    setData((d) => ({ ...d, ...patch }))
  }

  // ---- dev hook for tests: look at and set up the game ----
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__blockten = {
      state: () => gameRef.current,
      layout: () => layoutFor(stageRef.current.clientWidth, stageRef.current.clientHeight),
      // a board from 10 strings ("." empty, a digit 1-9 for a color) and a tray
      setup: ({ rows, tray, ...rest } = {}) => {
        const board = rows ? rows.flatMap((row) => [...row].map((ch) => (ch === "." ? 0 : Number(ch) || 1))) : gameRef.current.board
        setGame({ ...gameRef.current, board, tray: tray || gameRef.current.tray, over: null, recorded: false, ...rest })
        setOver(null)
      },
      // re-checks whether any move is left (after setup)
      check: () => setGame((g) => ({ ...g, over: E.anyMove(g) ? null : "stuck" })),
    }
    return () => delete window.__blockten
  }, [])

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true })
  }, [])

  // ---- what to draw ----
  const mode = game.mode
  const menus = [
    {
      label: "Game",
      items: [
        { label: "New (F2)", onClick: () => start() },
        { label: "Undo (Ctrl+Z)", disabled: !E.canUndo(game), onClick: doUndo },
        "-",
        ...E.MODES.map((m) => ({ label: MODE_LABELS[m], checked: mode === m, onClick: () => start(m) })),
        "-",
        { label: "High Scores...", onClick: () => setDialog("scores") },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    {
      label: "Options",
      items: [
        { label: "Sound", checked: data.sound, onClick: () => setPref({ sound: !data.sound }) },
        chatItem,
        "-",
        ...THEMES.map((t) => ({ label: t.label, checked: theme === t.id, onClick: () => setPref({ theme: t.id }) })),
      ],
    },
    { label: "Help", items: [{ label: "How to Play...", onClick: () => setDialog("help") }] },
  ]

  const previewCells = new Set()
  const glow = new Set()
  if (preview) {
    for (const [dr, dc] of E.PIECES[preview.id].cells) previewCells.add(E.at(preview.r + dr, preview.c + dc))
    for (const row of preview.rows) for (let j = 0; j < 10; j++) glow.add(E.at(row, j))
    for (const col of preview.cols) for (let j = 0; j < 10; j++) glow.add(E.at(j, col))
  }
  const previewColor = preview ? E.PIECES[preview.id].color : 0
  const landed = new Set(effects.landed)
  const L = layout

  const scoreBar = L && (
    <div className="btScoreBar" style={{ width: L.wide ? L.sideW : L.boardPx, height: SCORE_H }}>
      <div className="btCounter">
        <span className="btLabel">Score</span>
        <span className="btNum" data-score={game.score}>
          {fmtNum(shown)}
        </span>
      </div>
      {mode === "blast" ? (
        <div className={game.timeLeft <= 10 ? "btCounter btTime is-low" : "btCounter btTime"}>
          <span className="btLabel">Time</span>
          <span className="btNum">{fmtTime(game.timeLeft)}</span>
        </div>
      ) : mode === "daily" ? (
        <div className="btCounter btMode">
          <span className="btLabel">Daily</span>
          <span className="btNum btSmall">{dayKey.slice(5).replace("-", "/")}</span>
        </div>
      ) : null}
      <div className="btCounter btBest">
        <span className="btLabel">Best</span>
        <span className="btNum" data-best={best}>
          {fmtNum(best)}
        </span>
      </div>
    </div>
  )

  const board = L && (
    <div className="btFrame" style={{ width: L.boardPx, height: L.boardPx }}>
      <div className="btGrid" ref={gridRef} style={{ width: L.cell * 10, height: L.cell * 10, "--cell": `${L.cell}px` }}>
        {game.board.map((v, i) => {
          const color = v || (previewCells.has(i) ? previewColor : 0)
          let cls = "btCell"
          if (v) cls += ` btBlock btC${v}`
          else if (previewCells.has(i)) cls += ` btBlock btC${previewColor} is-preview`
          if (glow.has(i) && color) cls += " is-glow"
          if (v && landed.has(i)) cls += " is-landed"
          return <div key={i} className={cls} data-cell={i} />
        })}
        {effects.clears.map((c) => (
          <div
            key={c.key}
            className={`btBlock btC${c.color} btPop`}
            style={{ left: (c.i % 10) * L.cell, top: Math.floor(c.i / 10) * L.cell, width: L.cell, height: L.cell, animationDelay: `${c.delay}ms` }}
          />
        ))}
        {effects.pops.map((p) => (
          <div key={p.key} className={`btFloat ${p.kind ? `is-${p.kind}` : ""}`} style={{ left: p.x, top: p.y }}>
            {p.text}
          </div>
        ))}
      </div>
    </div>
  )

  const tray = L && (
    <div className={L.trayRow ? "btTray" : "btTray is-column"}>
      {game.tray.map((id, slot) => {
        const dead = id && !E.fitsAnywhere(game.board, id)
        const lifted = drag && drag.slot === slot
        return (
          <div
            key={slot}
            ref={(el) => (slotRefs.current[slot] = el)}
            className={`btSlot${dead ? " is-dead" : ""}${id ? "" : " is-empty"}`}
            data-slot={slot}
            data-piece={id || ""}
            style={{ width: L.slotW, height: L.slotH }}
            onPointerDown={onSlotDown(slot)}
            onPointerMove={onSlotMove}
            onPointerUp={onSlotUp}
            onPointerCancel={onSlotUp}
            onLostPointerCapture={(e) => dragRef.current && !dragRef.current.returning && dragRef.current.pointerId === e.pointerId && onSlotUp({ pointerId: e.pointerId, type: "cancel" })}
          >
            {id && <PieceView id={id} size={L.mini} className={lifted ? "is-lifted" : "is-dealt"} key={id} />}
          </div>
        )
      })}
    </div>
  )

  return (
    <div
      className={`btRoot btTheme-${theme}${mobile ? " is-mobile" : ""}`}
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      data-mode={mode}
    >
      <MenuBar menus={menus} />
      <GameChat game="blockten" title="Block Ten" />
      <div className="btStage" ref={stageRef}>
        {L && (
          <div className={L.wide ? "btLayout is-wide" : "btLayout"}>
            {!L.wide && scoreBar}
            {board}
            {L.wide ? (
              <div className="btSide" style={{ width: L.sideW, height: L.boardPx }}>
                {scoreBar}
                {tray}
              </div>
            ) : (
              tray
            )}
          </div>
        )}
        {over && (
          <div className="btOverlay">
            <div className="btPanel">
              <b>{over.reason === "time" ? "Time's up!" : "No more room!"}</b>
              <p>
                {MODE_LABELS[mode]}
                {mode === "daily" ? ` (${dayKey})` : ""}
              </p>
              <p>
                Score: <b className="btFinal">{fmtNum(over.score)}</b>
                <br />
                {game.lines} lines cleared, best combo {game.bestCombo}
              </p>
              {over.best && <p className="btNewBest">New best score!</p>}
              <div className="btPanelButtons">
                <button type="button" onClick={() => start()} autoFocus>
                  Play Again
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {!mobile && (
        <div className="status-bar btStatus">
          <p className="status-bar-field">{MODE_LABELS[mode]}</p>
          <p className="status-bar-field">Lines {game.lines}</p>
          <p className="status-bar-field">{game.streak > 1 ? `Streak x${game.streak}` : `Moves ${game.moves}`}</p>
          <p className="status-bar-field">{E.canUndo(game) ? "Undo ready" : game.undos ? "Drag a piece onto the board" : "Undo used"}</p>
        </div>
      )}

      {drag && L && (
        <div className={drag.touch ? "btGhost is-touch" : "btGhost"} ref={ghostRef} style={{ transform: `translate(${drag.start.x}px, ${drag.start.y}px)` }}>
          <PieceView id={drag.id} size={L.cell} />
        </div>
      )}

      {dialog === "scores" && (
        <Dialog title="Block Ten High Scores" onOk={() => setDialog(null)}>
          <ScoreTables data={data} dayKey={dayKey} />
        </Dialog>
      )}
      {dialog === "help" && (
        <Dialog title="How to Play Block Ten" onOk={() => setDialog(null)}>
          <p className="dialogText btHelp">
            Drag a piece from the tray onto the board. Fill a whole row or column and it clears. Pieces can't be turned, so
            plan ahead!
            <br />
            <br />
            When all three pieces are down you get three more. The game ends when none of the pieces left fits anywhere
            (pieces with no room left turn gray).
            <br />
            <br />
            Every block placed is worth 1 point. Lines score 10, and clearing several at once scores more: 30 for two, 60
            for three... Clear lines on moves in a row for a streak bonus, and empty the whole board for 300 more.
            <br />
            <br />
            Daily Challenge deals everyone the same pieces today. Blast gives you three minutes. One Undo per game (Ctrl+Z).
          </p>
        </Dialog>
      )}
    </div>
  )
}

const ScoreTables = ({ data, dayKey }) => (
  <div className="btScores">
    {E.MODES.map((m) => (
      <div key={m}>
        <b>
          {MODE_LABELS[m]}
          {m === "daily" && data.daily[dayKey] ? ` (today: ${fmtNum(data.daily[dayKey])})` : ""}
        </b>
        {data.scores[m]?.length ? (
          <table>
            <tbody>
              {data.scores[m].slice(0, 5).map((s, i) => (
                <tr key={i}>
                  <td>{i + 1}.</td>
                  <td className="btScoreCol">{fmtNum(s.score)}</td>
                  <td>{s.lines} lines</td>
                  <td>{new Date(s.date).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No games yet.</p>
        )}
      </div>
    ))}
  </div>
)

export default BlockTen
