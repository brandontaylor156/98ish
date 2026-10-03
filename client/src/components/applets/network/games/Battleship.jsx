import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import MenuBar from "../../../shared/MenuBar"
import GameChat, { useGameChatMenuItem } from "../../../shared/GameChat"
import { GameButtons, GameOver, ResignDialog, ResultBanner, RulesDialog, usePlayOnlineItem, waitingText } from "./GameParts"
import { useNetGame, useSoloBattleship } from "./useBoardGame"
import { SHIPS, SIZE, cellsOf, fits, randomFleet, shipInfo } from "../rules/battleship.js"
import "./BoardGames.css"

// Battleship against another computer on the network, or against this one. First place
// your five ships (drag them, or tap a ship then a square; Rotate turns it), then take turns
// firing at the other grid. Over the network the other fleet stays on their computer's side
// of the server until the game is over.

const ROWS = "ABCDEFGHIJ"
const cellName = (c) => `${ROWS[Math.floor(c / SIZE)]}${(c % SIZE) + 1}`
const nameOf = (id) => shipInfo(id)?.name || "ship"

// Where each ship's cells are, and which end is which (for drawing hulls)
const hullMap = (fleet) => {
  const map = new Map()
  for (const ship of fleet || []) {
    const cells = cellsOf(ship)
    cells.forEach((c, k) => map.set(c, { id: ship.id, dir: ship.dir, end: k === 0 ? "bow" : k === cells.length - 1 ? "stern" : null, k }))
  }
  return map
}

const Grid = ({ cell, label, hulls, shots, sunkCells, ghost, onCell, onCellDown, onContext, clickable, className = "", gridRef, testId }) => {
  const shotAt = new Map((shots || []).map((s) => [s.cell, s]))
  return (
    <div className={`bsGridWrap ${className}`}>
      {label && <div className="bsGridLabel">{label}</div>}
      <div
        className="bsGrid"
        ref={gridRef}
        data-grid={testId}
        style={{ gridTemplateColumns: `repeat(${SIZE + 1}, ${cell}px)`, gridAutoRows: `${cell}px`, fontSize: Math.max(9, Math.min(13, cell * 0.42)) }}
        onContextMenu={(e) => {
          if (!onContext) return
          e.preventDefault()
          onContext()
        }}
      >
        <span className="bsCorner" />
        {Array.from({ length: SIZE }, (_, c) => (
          <span key={`c${c}`} className="bsHead">
            {c + 1}
          </span>
        ))}
        {Array.from({ length: SIZE }, (_, r) => (
          <React.Fragment key={r}>
            <span className="bsHead">{ROWS[r]}</span>
            {Array.from({ length: SIZE }, (_, c) => {
              const i = r * SIZE + c
              const hull = hulls?.get(i)
              const shot = shotAt.get(i)
              const classes = ["bsCell"]
              if (hull) classes.push("is-ship", `is-${hull.dir}`, hull.end && `is-${hull.end}`)
              if (sunkCells?.has(i)) classes.push("is-sunk")
              if (shot) classes.push(shot.hit ? "is-hit" : "is-miss")
              if (ghost?.cells.has(i)) classes.push(ghost.ok ? "is-ghost" : "is-bad")
              if (clickable && !shot) classes.push("is-open")
              return (
                <button
                  type="button"
                  key={i}
                  className={classes.filter(Boolean).join(" ")}
                  data-cell={i}
                  data-name={cellName(i)}
                  aria-label={`${cellName(i)}${hull ? ` ${nameOf(hull.id)}` : ""}${shot ? (shot.hit ? " hit" : " miss") : ""}`}
                  onClick={() => onCell?.(i)}
                  onPointerDown={(e) => onCellDown?.(e, i)}
                >
                  {shot && <span className="bsMark" />}
                </button>
              )
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

const FleetList = ({ sunk, title }) => (
  <ul className="bsFleetList" aria-label={title}>
    {SHIPS.map((s) => (
      <li key={s.id} className={sunk.includes(s.id) ? "is-sunk" : ""}>
        <span className="bsTrayHull bsPips" aria-hidden="true">
          {Array.from({ length: s.length }, (_, k) => (
            <i key={k} />
          ))}
        </span>{" "}
        {s.name}
      </li>
    ))}
  </ul>
)

// ---------- placing the fleet ----------

const Placement = ({ view, act, size }) => {
  const [fleet, setFleet] = useState({}) // id -> ship
  const [selected, setSelected] = useState(SHIPS[0].id)
  const [dir, setDir] = useState("h")
  const [hover, setHover] = useState(null) // cell under the pointer
  const [grab, setGrab] = useState(0) // which part of the ship is held
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const [pendingDrop, setPendingDrop] = useState(null) // a ship dropped by dragging
  const dragRef = useRef(null)
  const suppressClick = useRef(false)
  const gridRef = useRef(null)
  const placedAll = SHIPS.every((s) => fleet[s.id])
  const sent = view.placed.you

  const others = (id) => new Set(Object.values(fleet).filter((s) => s.id !== id).flatMap(cellsOf))
  const shipAtAnchor = (id, cell, d = dir, k = grab) => {
    const row = Math.floor(cell / SIZE) - (d === "v" ? k : 0)
    const col = (cell % SIZE) - (d === "h" ? k : 0)
    return { id, row, col, dir: d }
  }
  const ghostShip = selected && hover !== null ? shipAtAnchor(selected, hover) : null
  const ghostOk = ghostShip ? fits(ghostShip, others(selected)) : false
  // the squares of the ship being placed that are on the grid (red if it doesn't fit)
  const ghostCells = (ship) => {
    const out = new Set()
    for (let k = 0; k < shipInfo(ship.id).length; k++) {
      const r = ship.row + (ship.dir === "v" ? k : 0)
      const c = ship.col + (ship.dir === "h" ? k : 0)
      if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) out.add(r * SIZE + c)
    }
    return out
  }
  const ghost = ghostShip && { ok: ghostOk, cells: ghostCells(ghostShip) }

  const nextUnplaced = (after) => SHIPS.find((s) => !after[s.id])?.id || null

  const put = (ship) => {
    if (!fits(ship, others(ship.id))) return setError(`The ${nameOf(ship.id)} doesn't fit there.`)
    const next = { ...fleet, [ship.id]: ship }
    setFleet(next)
    setSelected(nextUnplaced(next))
    setGrab(0)
    setError(null)
  }

  const pickUp = (id) => {
    const ship = fleet[id]
    const next = { ...fleet }
    delete next[id]
    setFleet(next)
    setSelected(id)
    if (ship) setDir(ship.dir)
  }

  const clickCell = (cell) => {
    if (suppressClick.current) return (suppressClick.current = false)
    if (sent) return
    const here = Object.values(fleet).find((s) => cellsOf(s).includes(cell))
    if (selected) return put(shipAtAnchor(selected, cell, dir, grab))
    if (here) {
      setGrab(cellsOf(here).indexOf(cell))
      pickUp(here.id)
      setHover(cell)
    }
  }

  const rotate = () => {
    setDir((d) => (d === "h" ? "v" : "h"))
    setError(null)
  }

  // Dragging from the tray or a placed ship
  const startDrag = (e, id, k, origin) => {
    if (sent || (e.button !== undefined && e.button !== 0)) return
    dragRef.current = { id, k, origin, x: e.clientX, y: e.clientY, moved: false }
  }
  useEffect(() => {
    const cellUnder = (x, y) => {
      const el = document.elementFromPoint(x, y)?.closest?.("[data-cell]")
      return el && gridRef.current?.contains(el) ? Number(el.dataset.cell) : null
    }
    const move = (e) => {
      const d = dragRef.current
      if (!d) return
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return
      if (!d.moved) {
        d.moved = true
        if (d.origin === "grid") pickUp(d.id)
        else setSelected(d.id)
        setGrab(d.k)
      }
      setHover(cellUnder(e.clientX, e.clientY))
    }
    const up = (e) => {
      const d = dragRef.current
      dragRef.current = null
      if (!d?.moved) return
      suppressClick.current = true
      setTimeout(() => (suppressClick.current = false), 60)
      const cell = cellUnder(e.clientX, e.clientY)
      if (cell !== null) setHover(cell)
      if (cell !== null) setPendingDrop({ id: d.id, cell, k: d.k })
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
    }
  })
  // a drop is placed on the next render, once the picked-up ship is out of the fleet
  useEffect(() => {
    if (!pendingDrop) return
    setPendingDrop(null)
    put(shipAtAnchor(pendingDrop.id, pendingDrop.cell, dir, pendingDrop.k))
  }, [pendingDrop])

  const ready = async () => {
    setSending(true)
    const r = await act.move({ fleet: SHIPS.map((s) => fleet[s.id]) })
    setSending(false)
    if (!r.ok) setError(r.error)
  }

  const random = () => {
    const f = randomFleet()
    setFleet(Object.fromEntries(f.map((s) => [s.id, s])))
    setSelected(null)
    setError(null)
  }

  const hulls = hullMap(Object.values(fleet))
  const status = sent
    ? view.placed.them
      ? "Both fleets are ready!"
      : `Your fleet is ready. Waiting for ${view.names.them} to place their ships...`
    : selected
      ? `Place your ${nameOf(selected)} (${shipInfo(selected).length} squares, ${dir === "h" ? "across" : "down"}). Rotate turns it.`
      : placedAll
        ? "All ships placed. Press Ready when you're happy with them."
        : "Pick a ship to place."

  return (
    <div
      className={size.wide ? "bsPlace is-wide" : "bsPlace"}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "r" || e.key === "R") rotate()
      }}
    >
      <Grid
        cell={size.cell}
        label="Your fleet"
        hulls={hulls}
        ghost={sent ? null : ghost}
        gridRef={gridRef}
        testId="own"
        onCell={clickCell}
        onCellDown={(e, cell) => {
          const here = Object.values(fleet).find((s) => cellsOf(s).includes(cell))
          if (here && !selected) startDrag(e, here.id, cellsOf(here).indexOf(cell), "grid")
        }}
        onContext={rotate}
        className="bsOwn bsPlacing"
      />
      <div className="bsTray">
        {!sent && (
          <>
            <div className="bsTrayShips" role="listbox" aria-label="Ships">
              {SHIPS.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  role="option"
                  aria-selected={selected === s.id}
                  data-ship={s.id}
                  className={["bsTrayShip", selected === s.id && "is-selected", fleet[s.id] && "is-placed"].filter(Boolean).join(" ")}
                  onClick={() => {
                    if (suppressClick.current) return
                    if (fleet[s.id]) pickUp(s.id)
                    else setSelected(selected === s.id ? null : s.id)
                    setGrab(0)
                  }}
                  onPointerDown={(e) => startDrag(e, s.id, 0, "tray")}
                >
                  <span className="bsTrayHull" aria-hidden="true">
                    {Array.from({ length: s.length }, (_, k) => (
                      <i key={k} />
                    ))}
                  </span>
                  <span>{s.name}</span>
                  {fleet[s.id] && <span className="bsTrayAt">{cellName(cellsOf(fleet[s.id])[0])}</span>}
                </button>
              ))}
            </div>
            <div className="bsTrayButtons">
              <button type="button" onClick={rotate} aria-label="Rotate">
                Rotate ({dir === "h" ? "across" : "down"})
              </button>
              <button type="button" onClick={random}>
                Random
              </button>
              <button type="button" onClick={() => (setFleet({}), setSelected(SHIPS[0].id))}>
                Clear
              </button>
            </div>
            <button type="button" className="bsReady" disabled={!placedAll || sending} onClick={ready}>
              Ready!
            </button>
          </>
        )}
        {sent && <div className="bsWaitBox">{view.solo ? "Ready!" : <><div className="netHourglass" aria-hidden="true" /> Waiting for {view.names.them}...</>}</div>}
      </div>
      <div className="status-bar bsStatus">
        <p className={error ? "status-bar-field ckError" : "status-bar-field"} role="status">
          {error || status}
        </p>
      </div>
    </div>
  )
}

// ---------- the battle ----------

const newsFor = (last, them) => {
  if (!last) return null
  const where = cellName(last.cell)
  if (last.by === "you") return last.result === "sunk" ? `${where}: you sank their ${nameOf(last.ship)}!` : last.result === "hit" ? `${where}: hit!` : `${where}: miss.`
  return last.result === "sunk" ? `${them} sank your ${nameOf(last.ship)}!` : last.result === "hit" ? `${them} hit your ship at ${where}!` : `${them} fired at ${where} and missed.`
}

const Battle = ({ view, act, size }) => {
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const them = view.names.them
  const result = view.result

  useEffect(() => setError(null), [view.last?.cell, view.last?.by])

  const fire = async (cell) => {
    setError(null)
    if (result) return
    if (!view.yourTurn) return setError(view.solo ? "Wait for the computer's shot." : `It's ${them}'s turn.`)
    if (view.enemy.shots.some((s) => s.cell === cell)) return setError("You already fired there.")
    if (sending) return
    setSending(true)
    const r = await act.move({ cell })
    setSending(false)
    if (!r.ok) setError(r.error)
  }

  const enemyHulls = hullMap(view.enemyFleet || view.enemy.sunk.map((s) => ({ id: s.id, ...shipFromCells(s.cells) })))
  const enemySunk = new Set(view.enemy.sunk.flatMap((s) => s.cells))
  const ownHulls = hullMap(view.own.fleet)
  const ownSunk = new Set((view.own.fleet || []).filter((s) => view.own.sunk.includes(s.id)).flatMap(cellsOf))
  const news = newsFor(view.last, them)
  const resultText = result
    ? result.reason === "resigned"
      ? result.youWon
        ? `${them} gave up. You win!`
        : "You gave up."
      : result.youWon
        ? `You sank ${view.solo ? "the computer's" : `${them}'s`} whole fleet. You win!`
        : `${them} sank your whole fleet.`
    : null
  const status = result ? resultText : view.yourTurn ? "Your turn: fire at the enemy grid." : waitingText(view, them)

  const newsClass = error ? "bsNews is-error" : view.last?.result === "sunk" ? "bsNews is-sunk" : view.last?.result === "hit" ? "bsNews is-hit" : "bsNews"
  const enemyGrid = (
    <Grid cell={size.enemyCell} label={`${view.solo ? "Computer's" : `${them}'s`} waters`} hulls={enemyHulls} shots={view.enemy.shots} sunkCells={enemySunk} onCell={fire} clickable={view.yourTurn && !result} testId="enemy" className={view.enemyFleet ? "bsEnemy is-revealed" : "bsEnemy"} />
  )

  // Phones: the enemy grid as big as it can be, your fleet as a small map underneath, and
  // the news line doubling as the status bar
  if (!size.wide) {
    return (
      <div className="bsBattle">
        <div className={newsClass} role="status" aria-live="polite">
          {error || (news && !result ? `${news} ${view.yourTurn ? "Your turn." : ""}` : news) || status}
        </div>
        <div className="bsGrids">{enemyGrid}</div>
        <div className="bsMini">
          <Grid cell={size.ownCell} label="Your fleet" hulls={ownHulls} shots={view.own.shots} sunkCells={ownSunk} testId="own" className="bsOwn" />
          <div className="bsLists">
            <b>Theirs</b>
            <FleetList sunk={view.enemy.sunk.map((s) => s.id)} title="Their ships" />
            <b>Yours</b>
            <FleetList sunk={view.own.sunk} title="Your ships" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bsBattle is-wide">
      <div className={newsClass} role="status" aria-live="polite">
        {news || (view.yourTurn ? "You fire first!" : `${them} fires first.`)}
      </div>
      <div className="bsGrids">
        <div className="bsSide">
          {enemyGrid}
          <FleetList sunk={view.enemy.sunk.map((s) => s.id)} title="Their ships" />
        </div>
        <div className="bsSide">
          <Grid cell={size.ownCell} label="Your fleet" hulls={ownHulls} shots={view.own.shots} sunkCells={ownSunk} testId="own" className="bsOwn" />
          <FleetList sunk={view.own.sunk} title="Your ships" />
        </div>
      </div>
      <div className="status-bar bsStatus">
        <p className={error ? "status-bar-field ckError" : "status-bar-field"}>{error || status}</p>
      </div>
    </div>
  )
}

// A sunk ship's placement from its cells (all the other side learns about it)
const shipFromCells = (cells) => {
  const sorted = [...cells].sort((a, b) => a - b)
  const dir = sorted.length > 1 && sorted[1] - sorted[0] === SIZE ? "v" : "h"
  return { row: Math.floor(sorted[0] / SIZE), col: sorted[0] % SIZE, dir }
}

const BattleshipGame = ({ view, act, onClose }) => {
  const chatItem = useGameChatMenuItem("battleship")
  const onlineItem = usePlayOnlineItem("battleship")
  const [dialog, setDialog] = useState(null)
  const [size, setSize] = useState({ wide: true, cell: 24, enemyCell: 24, ownCell: 24 })
  const areaRef = useRef(null)
  const them = view.names.them
  const placing = view.phase === "placing" && !view.result

  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      const wide = w >= 520
      const cols = SIZE + 1
      let next
      if (placing) {
        const cell = wide ? Math.min((w - 210) / cols, (h - 52) / (cols + 1)) : Math.min((w - 16) / cols, (h - 230) / (cols + 1))
        next = { wide, cell: Math.max(16, Math.floor(cell)), enemyCell: 24, ownCell: 24 }
      } else if (wide) {
        const cell = Math.max(14, Math.floor(Math.min((w - 40) / (2 * cols), (h - 100) / (cols + 1))))
        next = { wide, cell, enemyCell: cell, ownCell: cell }
      } else {
        // news line, enemy label and grid, then the small map of your fleet
        const ownCell = Math.max(9, Math.min(12, Math.floor((h - 300) / cols)))
        const enemyCell = Math.max(16, Math.floor(Math.min((w - 12) / cols, (h - 36 - 18 - (ownCell * cols + 22)) / cols)))
        next = { wide, cell: enemyCell, enemyCell, ownCell }
      }
      setSize((s) => (JSON.stringify(s) === JSON.stringify(next) ? s : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [placing])

  const menus = [
    {
      label: "Game",
      items: [
        ...(view.solo ? [{ label: "New Game", onClick: () => act.rematch() }, onlineItem, "-"] : []),
        { label: "Resign...", disabled: !!view.result, onClick: () => setDialog("resign") },
        ...(view.solo ? [] : [{ label: "Rematch", disabled: !view.result || view.rematch.you || view.left, onClick: () => act.rematch() }]),
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    { label: "Options", items: [chatItem] },
    { label: "Help", items: [{ label: "Rules...", onClick: () => setDialog("rules") }] },
  ]

  return (
    <div className="netApp ckRoot bsRoot" data-game="battleship" data-phase={placing ? "placing" : view.result ? "over" : "playing"}>
      <MenuBar menus={menus} />
      <GameChat game="battleship" title="Battleship" room={view.solo ? undefined : `match:${view.id}`} />
      <div className="bsArea" ref={areaRef}>
        {placing ? <Placement key={view.round} view={view} act={act} size={size} /> : <Battle view={view} act={act} size={size} />}
      </div>
      <GameButtons view={view} act={act} onClose={onClose} onResign={() => setDialog("resign")} />
      {(view.away || view.left) && !view.result && <div className="bsAway">{waitingText(view, them)}</div>}
      <ResultBanner view={view} them={them} />

      {dialog === "resign" && <ResignDialog them={them} onResign={() => (act.resign(), setDialog(null))} onCancel={() => setDialog(null)} />}
      {dialog === "rules" && (
        <RulesDialog title="Battleship Rules" onOk={() => setDialog(null)}>
          Place your five ships on your grid: drag them, or pick one and tap a square. Rotate (or the R key, or a
          right-click) turns it. Ships can touch but not overlap.
          <br />
          <br />
          Then take turns firing at the other grid, one shot each. A white dot is a miss, red is a hit. Sink all five ships
          to win.
        </RulesDialog>
      )}
    </div>
  )
}

const NetBattleship = ({ matchId, onClose }) => {
  const { view, act } = useNetGame(matchId)
  if (!view) return <GameOver />
  return <BattleshipGame view={view} act={act} onClose={onClose} />
}

const SoloBattleship = ({ onClose }) => {
  const { view, act } = useSoloBattleship()
  return <BattleshipGame view={view} act={act} onClose={onClose} />
}

const Battleship = ({ matchId, onClose }) => (matchId ? <NetBattleship matchId={matchId} onClose={onClose} /> : <SoloBattleship onClose={onClose} />)

export default Battleship
