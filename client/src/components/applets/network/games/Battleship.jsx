import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import MenuBar from "../../../shared/MenuBar"
import GameChat, { useGameChatMenuItem } from "../../../shared/GameChat"
import { GameButtons, GameOver, ResignDialog, ResultBanner, RulesDialog, usePlayOnlineItem, waitingText } from "./GameParts"
import { useNetGame, useSoloBattleship } from "./useBoardGame"
import { SHIPS, SIZE, cellsOf, fits, randomFleet, shipInfo } from "../rules/battleship.js"
import { allPlaced, firstSpot, onGridCells, shipAt, shipOn, takenBy, turnShip } from "./bsPlacement.js"
import MoreOptions from "../../../shared/MoreOptions"
import "./BoardGames.css"
import { helpItem } from "../../../../utils/help"

// Battleship against another computer on the network, or against this one. First place
// your five ships (drag them from the dock onto the grid, or tap one to drop it in; drag a
// placed ship to move it, tap it to turn it; Random places them all), then take turns
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
          onContext(e)
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
                  onClick={(e) => onCell?.(i, e)}
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
  const [drag, setDrag] = useState(null) // the ship being dragged: { id, k, dir, hover, x, y }
  const [flash, setFlash] = useState(null) // squares shown red for a moment (a turn with no room)
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const [lastId, setLastId] = useState(null) // the ship the R key turns
  const press = useRef(null) // a press on a ship: { id, k, dir, from, cell, x, y, moved }
  const live = useRef({ fleet })
  live.current.fleet = fleet
  const gridRef = useRef(null)
  const rootRef = useRef(null)
  const placedAll = allPlaced(fleet)
  const sent = view.placed.you

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 600)
    return () => clearTimeout(t)
  }, [flash])

  const place = (ship) => {
    setFleet((f) => ({ ...f, [ship.id]: ship }))
    setLastId(ship.id)
    setError(null)
  }

  // tap a placed ship: it turns around the square you tapped
  const turn = (id, cell) => {
    const f = live.current.fleet
    const next = turnShip(f, id, cell ?? cellsOf(f[id])[0])
    setLastId(id)
    if (next) return place(next)
    setError(`No room to turn the ${nameOf(id)} there.`)
    const n = shipInfo(id).length
    setFlash(onGridCells(shipAt(id, cell ?? cellsOf(f[id])[0], f[id].dir === "h" ? "v" : "h", Math.floor(n / 2))))
  }

  // tap a ship in the dock: it goes on the grid at the first open spot, to drag from there
  const drop = (id) => {
    const spot = firstSpot(live.current.fleet, id)
    if (spot) place(spot)
    else setError(`There's no room left for the ${nameOf(id)}. Move a ship or press Random.`)
  }

  const cellUnder = (x, y) => {
    const el = document.elementFromPoint(x, y)?.closest?.("[data-cell]")
    return el && gridRef.current?.contains(el) ? Number(el.dataset.cell) : null
  }
  const local = (x, y) => {
    const r = rootRef.current?.getBoundingClientRect()
    return r ? { x: x - r.left + rootRef.current.scrollLeft, y: y - r.top + rootRef.current.scrollTop } : { x: 0, y: 0 }
  }

  // Press on a ship (on the grid or in the dock). Moving more than a few pixels drags it;
  // letting go without moving is a tap.
  const onShipDown = (e, id, k, from, cell = null) => {
    if (sent || (e.pointerType === "mouse" && e.button !== 0)) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // the pointer is already gone
    }
    const ship = live.current.fleet[id]
    press.current = { id, k, dir: from === "grid" ? ship.dir : "h", from: from === "grid" ? ship : null, cell, x: e.clientX, y: e.clientY, pointerId: e.pointerId, moved: false }
  }

  useEffect(() => {
    const move = (e) => {
      const p = press.current
      if (!p || e.pointerId !== p.pointerId) return
      if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return
      if (!p.moved) {
        p.moved = true
        // the ship leaves its square while it's carried (so it can land overlapping itself)
        if (p.from) setFleet((f) => {
          const next = { ...f }
          delete next[p.id]
          return next
        })
        setError(null)
      }
      setDrag({ id: p.id, k: p.k, dir: p.dir, hover: cellUnder(e.clientX, e.clientY), ...local(e.clientX, e.clientY) })
    }
    const up = (e) => {
      const p = press.current
      if (!p || e.pointerId !== p.pointerId) return
      press.current = null
      if (!p.moved) {
        if (e.type === "pointercancel") return
        return p.from ? turn(p.id, p.cell) : drop(p.id)
      }
      setDrag(null)
      const cell = e.type === "pointercancel" ? null : cellUnder(e.clientX, e.clientY)
      const ship = cell !== null ? shipAt(p.id, cell, p.dir, p.k) : null
      if (ship && fits(ship, takenBy(live.current.fleet, p.id))) return place(ship)
      // no good: back where it came from (or to the dock)
      if (p.from) place(p.from)
      if (cell !== null) setError(`The ${nameOf(p.id)} doesn't fit there.`)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
    }
  }, [sent])

  const ready = async () => {
    setSending(true)
    const r = await act.move({ fleet: SHIPS.map((s) => fleet[s.id]) })
    setSending(false)
    if (!r.ok) setError(r.error)
  }

  const random = () => {
    const f = randomFleet()
    setFleet(Object.fromEntries(f.map((s) => [s.id, s])))
    setError(null)
  }

  const dragShip = drag && drag.hover !== null ? shipAt(drag.id, drag.hover, drag.dir, drag.k) : null
  const ghost = dragShip
    ? { ok: fits(dragShip, takenBy(fleet, drag.id)), cells: onGridCells(dragShip) }
    : flash
      ? { ok: false, cells: flash }
      : null
  const hulls = hullMap(Object.values(fleet))
  const docked = SHIPS.filter((s) => !fleet[s.id] && drag?.id !== s.id)
  const status = sent
    ? view.placed.them
      ? "Both fleets are ready!"
      : `Your fleet is ready. Waiting for ${view.names.them} to place their ships...`
    : drag
      ? `Drop the ${nameOf(drag.id)} on your grid.`
      : placedAll
        ? "All set! Drag a ship to move it, tap it to turn it, then press Ready."
        : "Drag each ship onto your grid (or tap it). Tap a ship on the grid to turn it."

  return (
    <div
      ref={rootRef}
      className={`${size.wide ? "bsPlace is-wide" : "bsPlace"}${drag ? " is-dragging" : ""}`}
      tabIndex={-1}
      onKeyDown={(e) => {
        if ((e.key === "r" || e.key === "R") && lastId && fleet[lastId]) turn(lastId)
      }}
    >
      <Grid
        cell={size.cell}
        label="Your fleet"
        hulls={hulls}
        ghost={sent ? null : ghost}
        gridRef={gridRef}
        testId="own"
        onCell={(cell, e) => {
          // a key press on a square (Enter / Space) turns the ship there; pointers use onCellDown
          const here = shipOn(fleet, cell)
          if (!sent && here && e?.detail === 0) turn(here.id, cell)
        }}
        onCellDown={(e, cell) => {
          const here = shipOn(fleet, cell)
          if (here) onShipDown(e, here.id, cellsOf(here).indexOf(cell), "grid", cell)
        }}
        onContext={(e) => {
          const cell = Number(e.target.closest?.("[data-cell]")?.dataset.cell)
          const here = Number.isInteger(cell) ? shipOn(fleet, cell) : null
          if (!sent && here) turn(here.id, cell)
        }}
        className="bsOwn bsPlacing"
      />
      <div className="bsTray">
        {!sent && (
          <>
            <div className="bsDock" aria-label="Ships to place">
              {docked.length ? (
                docked.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    data-ship={s.id}
                    className="bsTrayShip"
                    title={`Drag the ${s.name} onto your grid, or tap it`}
                    onPointerDown={(e) => onShipDown(e, s.id, Math.floor(s.length / 2), "dock")}
                    onClick={(e) => e.detail === 0 && drop(s.id)}
                  >
                    <span className="bsTrayHull" aria-hidden="true">
                      {Array.from({ length: s.length }, (_, k) => (
                        <i key={k} />
                      ))}
                    </span>
                    <span>{s.name}</span>
                  </button>
                ))
              ) : (
                <div className="bsDockDone">All five ships are on your grid.</div>
              )}
            </div>
            <div className="bsTrayButtons">
              <button type="button" className="bsRandom" onClick={random}>
                Random
              </button>
              <button type="button" className="bsReady" disabled={!placedAll || sending} onClick={ready}>
                Ready!
              </button>
            </div>
            <MoreOptions id="battleship.place" inline>
              <div className="bsTrayButtons">
                <button type="button" disabled={!Object.keys(fleet).length} onClick={() => (setFleet({}), setError(null))}>
                  Clear the grid
                </button>
              </div>
              <p className="bsTip">Turn a ship: tap it, right-click it, or press R.</p>
            </MoreOptions>
          </>
        )}
        {sent && <div className="bsWaitBox">{view.solo ? "Ready!" : <><div className="netHourglass" aria-hidden="true" /> Waiting for {view.names.them}...</>}</div>}
      </div>
      {drag && drag.hover === null && (
        <div className="bsDragShip" aria-hidden="true" style={{ left: drag.x, top: drag.y, "--bs-cell": `${size.cell}px`, "--bs-k": drag.k, flexDirection: drag.dir === "v" ? "column" : "row" }}>
          {Array.from({ length: shipInfo(drag.id).length }, (_, k) => (
            <i key={k} />
          ))}
        </div>
      )}
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
    { label: "Help", items: [helpItem({ program: "Battleship" }), "-", { label: "Rules...", onClick: () => setDialog("rules") }] },
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
          Place your five ships on your grid: drag each one from the dock onto the grid (or tap it to drop it in).
          Drag a placed ship to move it, and tap it to turn it (or right-click it, or press R). Random places the
          whole fleet for you. Ships can touch but not overlap.
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
