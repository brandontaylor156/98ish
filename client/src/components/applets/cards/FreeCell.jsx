import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import Dialog from "../../shared/Dialog"
import CardTable, { useSize } from "./CardTable"
import { DEFAULT_BACK } from "./art"
import { load, save } from "./storage"
import * as F from "./freecellEngine"
import { unlock } from "../../../utils/achievements"

const SETTINGS_KEY = "98ish.freecell"
const STATS_KEY = "98ish.freecell.stats"
const DEFAULTS = { messages: false, quickPlay: false }
const NO_STATS = { won: 0, lost: 0, winStreak: 0, lossStreak: 0, current: 0, currentType: "" }
const session = { won: 0, lost: 0 } // "this session": until the page reloads

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const percent = (won, lost) => (won + lost ? Math.round((won * 100) / (won + lost)) : 0)

const fresh = (game, dealId = 0) => ({
  state: F.dealGame(game),
  past: [],
  status: "playing", // "playing" | "won" | "lost"
  counted: false, // already in the statistics
  dealId: dealId + 1,
})

// Record a won or lost game in the statistics
const record = (won) => {
  const stats = load(STATS_KEY, NO_STATS)
  const type = won ? "won" : "lost"
  const current = stats.currentType === type ? stats.current + 1 : 1
  const next = {
    ...stats,
    won: stats.won + (won ? 1 : 0),
    lost: stats.lost + (won ? 0 : 1),
    current,
    currentType: type,
    winStreak: won ? Math.max(stats.winStreak, current) : stats.winStreak,
    lossStreak: won ? stats.lossStreak : Math.max(stats.lossStreak, current),
  }
  session[type]++
  save(STATS_KEY, next)
}

// The king between the cells and home looks toward your cursor, and grins when you win
const King = ({ size, look, happy }) => (
  <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
    <path d="M9 15 8 4l6 5 6-7 6 7 6-5-1 11z" fill="#f2c200" stroke="#000" strokeWidth="1" strokeLinejoin="round" />
    <circle cx="20" cy="4" r="1.6" fill="#d40000" stroke="#000" strokeWidth=".6" />
    <rect x="8.5" y="13" width="23" height="3.4" fill="#1d3fae" stroke="#000" strokeWidth=".8" />
    <ellipse cx="20" cy="24" rx="9.5" ry="9" fill="#fbe0b6" stroke="#000" strokeWidth="1" />
    <ellipse cx="16" cy="22" rx="2.4" ry="2.6" fill="#fff" stroke="#000" strokeWidth=".6" />
    <ellipse cx="24" cy="22" rx="2.4" ry="2.6" fill="#fff" stroke="#000" strokeWidth=".6" />
    <circle cx={16 + look * 1.2} cy="22.4" r="1.2" />
    <circle cx={24 + look * 1.2} cy="22.4" r="1.2" />
    <path d="M12 28c2 7 14 7 16 0-2 1.5-5 2-8 2s-6-.5-8-2z" fill="#fff" stroke="#000" strokeWidth=".8" />
    <path d={happy ? "M16 29.5c2.4 2.4 5.6 2.4 8 0" : "M17 30h6"} stroke="#d40000" strokeWidth="1.2" fill="none" strokeLinecap="round" />
  </svg>
)

const FreeCell = ({ onClose, onTitle }) => {
  const chatItem = useGameChatMenuItem("freecell")
  const [settings, setSettings] = useState(() => load(SETTINGS_KEY, DEFAULTS))
  const [play, setPlay] = useState(() => fresh(F.randomGame()))
  const [selected, setSelected] = useState(null) // a pile id
  const [dialog, setDialog] = useState(null)
  const [look, setLook] = useState(-1)
  const rootRef = useRef(null)
  const tableRef = useRef(null)
  const size = useSize(tableRef)
  const playRef = useRef(play)
  playRef.current = play
  const { state } = play

  useEffect(() => {
    onTitle?.(`FreeCell Game #${state.game}`)
  }, [state.game])

  // ---- playing ----

  const commit = (next) => {
    if (!next) return false
    setPlay((p) => ({ ...p, state: next, past: [...p.past, p.state] }))
    setSelected(null)
    return true
  }

  const illegal = () => {
    setSelected(null)
    if (settings.messages) setDialog({ kind: "illegal" })
  }

  // Starting another game abandons this one: ask, and count it as lost
  const leave = (action) => {
    const p = playRef.current
    if (p.status === "playing" && p.past.length && !p.counted) setDialog({ kind: "resign", action })
    else action()
  }

  const startGame = (game) => {
    setPlay((p) => fresh(game, p.dealId))
    setSelected(null)
    setDialog(null)
  }

  const undo = () => {
    setPlay((p) => (p.past.length && p.status === "playing" ? { ...p, state: p.past[p.past.length - 1], past: p.past.slice(0, -1) } : p))
    setSelected(null)
  }

  const changeSettings = (patch) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    save(SETTINGS_KEY, next)
  }

  // keys go back to the game when a dialog closes
  useEffect(() => {
    if (!dialog && document.activeElement === document.body) {
      rootRef.current.focus({ preventScroll: true })
    }
  }, [dialog])

  // ---- automatic moves home, then win or lose ----
  const auto = useMemo(() => (play.status === "playing" ? F.autoStep(state) : null), [state, play.status])

  useEffect(() => {
    if (!auto) return
    const timer = setTimeout(() => setPlay((p) => ({ ...p, state: auto.state })), settings.quickPlay ? 0 : 110)
    return () => clearTimeout(timer)
  }, [auto, settings.quickPlay])

  const moves = useMemo(() => (play.status === "playing" && !auto ? F.legalMoves(state) : null), [state, auto, play.status])

  useEffect(() => {
    if (play.status !== "playing" || auto) return
    if (F.isWon(state)) {
      record(true)
      unlock("freecell")
      setPlay((p) => ({ ...p, status: "won", counted: true }))
      setDialog({ kind: "won" })
    } else if (moves && !moves.length) {
      if (!play.counted) record(false)
      setPlay((p) => ({ ...p, status: "lost", counted: true }))
      setDialog({ kind: "lost" })
    }
  }, [state, auto, moves])

  // ---- layout ----
  const layout = useMemo(() => {
    const W = size.width
    const H = size.height
    if (!W || !H) return null
    const gap = clamp(W * 0.01, 2, 10)
    const byWidth = (W - 9 * gap) / 8
    const byHeight = ((H - 3 * gap) / 3.9) * (71 / 96)
    const cw = Math.floor(clamp(Math.min(byWidth, byHeight), 22, 71 * 1.75))
    const ch = Math.round((cw * 96) / 71)
    const left = Math.round((W - (8 * cw + 7 * gap)) / 2)
    const right = left + 8 * cw + 7 * gap
    const colX = (i) => Math.round(left + i * (cw + gap))
    const topY = Math.round(gap * 0.6) + 1
    const tabY = Math.round(topY + ch + gap * 2 + 4)
    const cellX = (i) => left + i * cw
    const homeX = (i) => right - (4 - i) * cw
    const cards = []
    const rects = {}
    const add = (card, pile, index, x, y) => cards.push({ card, pile, index, x: Math.round(x), y: Math.round(y), z: index + 1 })

    state.cells.forEach((c, i) => c.forEach((card) => add(card, F.CELLS[i], 0, cellX(i), topY)))
    state.homes.forEach((h, i) => h.forEach((card, j) => add(card, F.HOMES[i], j, homeX(i), topY)))
    F.CELLS.forEach((c, i) => (rects[c] = { x: cellX(i), y: topY, w: cw, h: ch }))
    F.HOMES.forEach((h, i) => (rects[h] = { x: homeX(i), y: topY, w: cw, h: ch }))

    const room = H - tabY - ch - gap
    state.columns.forEach((col, j) => {
      let step = ch * (H > W * 1.2 ? 0.3 : 0.24)
      if ((col.length - 1) * step > room && col.length > 1) step = room / (col.length - 1)
      col.forEach((card, i) => add(card, F.COLUMNS[j], i, colX(j), tabY + i * step))
      const bottom = tabY + Math.max(0, col.length - 1) * step + ch
      rects[F.COLUMNS[j]] = { x: colX(j), y: tabY, w: cw, h: Math.max(ch, bottom - tabY) }
    })

    const slots = [
      ...F.CELLS.map((c, i) => ({ pile: c, x: cellX(i), y: topY, kind: "cell" })),
      ...F.HOMES.map((h, i) => ({ pile: h, x: homeX(i), y: topY, kind: "home" })),
      ...F.COLUMNS.map((c, i) => ({ pile: c, x: colX(i), y: tabY, kind: "none" })),
    ]
    const between = homeX(0) - cellX(4)
    const kingSize = Math.min(between - 6, ch * 0.62)
    const king = kingSize >= 22 ? { size: kingSize, x: cellX(4) + (between - kingSize) / 2, y: topY + (ch - kingSize) / 2 } : null
    return { cw, ch, cards, slots, rects, king, dealFrom: { x: (W - cw) / 2, y: topY } }
  }, [state, size])

  const shown = useMemo(() => {
    if (!layout) return []
    const top = selected ? F.pile(state, selected).length - 1 : -1
    return layout.cards.map((c) => ({ ...c, selected: c.pile === selected && c.index === top }))
  }, [layout, selected, state])

  // ---- input: click a card, click where it goes (or drag it) ----
  const busy = play.status !== "playing" || !!auto

  const moveSelected = (from, to) => {
    const s = playRef.current.state
    const cards = F.pile(s, from)
    // a run onto an empty column: the whole run, or just one card?
    if (from[0] === "t" && to[0] === "t" && !F.pile(s, to).length) {
      const n = F.countFor(s, from, to)
      if (n > 1) return setDialog({ kind: "column", from, to, n })
    }
    const n = F.countFor(s, from, to)
    if (!n || !commit(F.move(s, from, cards.length - n, to))) illegal()
  }

  const onTap = (pile) => {
    const s = playRef.current.state
    if (!selected) {
      if (pile && pile[0] !== "h" && F.pile(s, pile).length) setSelected(pile)
      return
    }
    if (pile === null || pile === selected) return setSelected(null)
    moveSelected(selected, pile)
  }

  // Double-click: home if it can go, otherwise to a free cell
  const onDoubleTap = (pile) => {
    setSelected(null)
    const s = playRef.current.state
    const cards = pile ? F.pile(s, pile) : []
    if (!cards.length || pile[0] === "h") return
    const card = cards[cards.length - 1]
    const home = F.homeFor(s, card)
    if (home) return commit(F.move(s, pile, cards.length - 1, home))
    const cell = pile[0] === "t" && F.freeCell(s)
    if (!cell || !commit(F.move(s, pile, cards.length - 1, cell))) illegal()
  }

  const onKeyDown = (e) => {
    const keys = { F2: () => leave(() => startGame(F.randomGame())), F3: () => leave(() => setDialog({ kind: "select", value: String(state.game) })), F4: () => setDialog({ kind: "stats" }), F5: () => setDialog({ kind: "options", ...settings }), F10: undo }
    if (keys[e.key]) {
      e.preventDefault()
      keys[e.key]()
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault()
      undo()
    } else if (e.key === "Escape") setSelected(null)
  }

  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__freecell = {
      get: () => playRef.current,
      load: (s) => {
        setDialog(null)
        setSelected(null)
        setPlay((p) => ({ ...p, state: { ...p.state, ...s }, past: [], status: "playing", counted: false }))
      },
    }
    return () => delete window.__freecell
  }, [])

  const menus = [
    {
      label: "Game",
      items: [
        { label: "New Game F2", onClick: () => leave(() => startGame(F.randomGame())) },
        { label: "Select Game... F3", onClick: () => leave(() => setDialog({ kind: "select", value: String(state.game) })) },
        { label: "Restart Game", onClick: () => startGame(state.game) },
        "-",
        { label: "Statistics... F4", onClick: () => setDialog({ kind: "stats" }) },
        { label: "Options... F5", onClick: () => setDialog({ kind: "options", ...settings }) },
        chatItem,
        "-",
        { label: "Undo F10", disabled: !play.past.length || play.status !== "playing", onClick: undo },
        "-",
        { label: "Exit", onClick: () => onClose?.() },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "How to Play...", onClick: () => setDialog({ kind: "help" }) },
        { label: "About FreeCell...", onClick: () => setDialog({ kind: "about" }) },
      ],
    },
  ]

  const left = F.cardsLeft(state)
  const stats = dialog?.kind === "stats" ? load(STATS_KEY, NO_STATS) : null
  const selectedNumber = Number(dialog?.value)
  const validNumber = Number.isInteger(selectedNumber) && selectedNumber >= 1 && selectedNumber <= F.MAX_GAME

  return (
    <div className="cardsRoot" ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      <div className="cardsMenuRow">
        <MenuBar menus={menus} />
        <GameChat game="freecell" title="FreeCell" />
        <span className="cardsMenuInfo">{moves && moves.length === 1 ? <b>1 move left!</b> : `Cards Left: ${left}`}</span>
      </div>
      <div className="cardsFelt">
        <CardTable
          tableRef={tableRef}
          cards={shown}
          slots={layout?.slots || []}
          dropRects={layout?.rects || {}}
          cw={layout?.cw || 71}
          ch={layout?.ch || 96}
          back={DEFAULT_BACK}
          dealKey={play.dealId}
          dealFrom={layout?.dealFrom}
          locked={busy}
          canPickUp={(pile, index) => F.canPickUp(playRef.current.state, pile, index)}
          canDrop={(pile, index, to) => F.canMove(playRef.current.state, pile, index, to)}
          onDrop={(pile, index, to) => commit(F.move(playRef.current.state, pile, index, to))}
          onTap={onTap}
          onDoubleTap={onDoubleTap}
          onPointerMoveTable={(e) => {
            if (!layout?.king) return
            const box = tableRef.current.getBoundingClientRect()
            setLook(e.clientX - box.left < layout.king.x + layout.king.size / 2 ? -1 : 1)
          }}
        >
          {layout?.king && (
            <div className="fcKing" style={{ left: layout.king.x, top: layout.king.y }}>
              <King size={layout.king.size} look={look} happy={play.status === "won"} />
            </div>
          )}
        </CardTable>
      </div>

      {dialog?.kind === "column" && (
        <Dialog
          title="Move to Empty Column"
          okLabel="Move column"
          noLabel="Single card"
          onOk={() => {
            const s = playRef.current.state
            setDialog(null)
            commit(F.move(s, dialog.from, F.pile(s, dialog.from).length - dialog.n, dialog.to))
          }}
          onNo={() => {
            const s = playRef.current.state
            setDialog(null)
            commit(F.move(s, dialog.from, F.pile(s, dialog.from).length - 1, dialog.to))
          }}
          onCancel={() => {
            setDialog(null)
            setSelected(null)
          }}
        >
          <p className="dialogText">Move the whole column of {dialog.n} cards, or just one card?</p>
        </Dialog>
      )}

      {dialog?.kind === "illegal" && (
        <Dialog title="FreeCell" onOk={() => setDialog(null)}>
          <p className="dialogText">That move is not allowed.</p>
        </Dialog>
      )}

      {dialog?.kind === "won" && (
        <Dialog title="Game Over" okLabel="Yes" cancelLabel="No" onOk={() => startGame(F.randomGame())} onCancel={() => setDialog(null)}>
          <p className="dialogText">
            Congratulations, you win!
            <br />
            Do you want to play again?
          </p>
        </Dialog>
      )}

      {dialog?.kind === "lost" && (
        <Dialog
          title="Game Over"
          okLabel="Yes"
          cancelLabel="No"
          onOk={() => startGame(state.game)}
          onCancel={() => startGame(F.randomGame())}
        >
          <p className="dialogText">
            Sorry, you lose. There are no more legal moves.
            <br />
            Would you like to play game #{state.game} again?
          </p>
        </Dialog>
      )}

      {dialog?.kind === "resign" && (
        <Dialog
          title="FreeCell"
          okLabel="Yes"
          cancelLabel="No"
          onOk={() => {
            record(false)
            setPlay((p) => ({ ...p, counted: true }))
            dialog.action()
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">Do you want to resign this game? It will count as a loss.</p>
        </Dialog>
      )}

      {dialog?.kind === "select" && (
        <Dialog
          title="Game Number"
          okDisabled={!validNumber}
          onOk={() => startGame(selectedNumber)}
          onCancel={() => setDialog(null)}
        >
          <label className="cardsGameNumber">
            <span>Select a game number from 1 to {F.MAX_GAME}:</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={F.MAX_GAME}
              value={dialog.value}
              onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
            />
          </label>
        </Dialog>
      )}

      {stats && (
        <Dialog
          title="FreeCell Statistics"
          noLabel="Clear"
          onOk={() => setDialog(null)}
          onNo={() => {
            save(STATS_KEY, NO_STATS)
            session.won = 0
            session.lost = 0
            setDialog({ kind: "stats" })
          }}
        >
          <table className="cardsStats">
            <tbody>
              <tr>
                <td>This session:</td>
                <td>{session.won} won,</td>
                <td>{session.lost} lost</td>
                <td>{percent(session.won, session.lost)}%</td>
              </tr>
              <tr>
                <td>Total:</td>
                <td>{stats.won} won,</td>
                <td>{stats.lost} lost</td>
                <td>{percent(stats.won, stats.lost)}%</td>
              </tr>
              <tr>
                <td>Streaks:</td>
                <td>{stats.winStreak} wins,</td>
                <td>{stats.lossStreak} losses</td>
                <td />
              </tr>
              <tr>
                <td>Current:</td>
                <td colSpan={3}>
                  {stats.current ? `${stats.current} ${stats.currentType === "won" ? (stats.current === 1 ? "win" : "wins") : stats.current === 1 ? "loss" : "losses"}` : "none"}
                </td>
              </tr>
            </tbody>
          </table>
        </Dialog>
      )}

      {dialog?.kind === "options" && (
        <Dialog
          title="FreeCell Options"
          onOk={() => {
            changeSettings({ messages: dialog.messages, quickPlay: dialog.quickPlay })
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          {[
            ["messages", "Display messages on illegal moves"],
            ["quickPlay", "Quick play (no animation)"],
          ].map(([key, label]) => (
            <div className="field-row cardsRadio" key={key}>
              <input type="checkbox" id={`fc-${key}`} checked={!!dialog[key]} onChange={() => setDialog({ ...dialog, [key]: !dialog[key] })} />
              <label htmlFor={`fc-${key}`}>{label}</label>
            </div>
          ))}
        </Dialog>
      )}

      {dialog?.kind === "help" && (
        <Dialog title="How to Play" onOk={() => setDialog(null)}>
          <p className="dialogText">
            Move every card to the four <b>home cells</b> at the top right, building each suit up from the ace.
            <br />
            <br />
            In the columns, stack cards down in alternating colors. The four <b>free cells</b> at the top left hold one card
            each; any card can go in an empty column. You can move several cards at once when there are enough free cells
            and empty columns to shuffle them through.
            <br />
            <br />
            <b>Click</b> (or tap) a column, then click where it goes, or <b>drag</b> cards. <b>Double-click</b> sends a card
            home, or to a free cell. Cards that are no longer needed go home on their own.
            <br />
            <br />
            Every game from 1 to 32000 is the deal you remember, and all but one can be won.
          </p>
        </Dialog>
      )}

      {dialog?.kind === "about" && (
        <Dialog title="About FreeCell" onOk={() => setDialog(null)}>
          <p className="dialogText">
            <b>FreeCell</b> for 98ish.
            <br />
            The 32,000 numbered deals of the original, with statistics, undo and supermoves.
          </p>
        </Dialog>
      )}
    </div>
  )
}

export default FreeCell
