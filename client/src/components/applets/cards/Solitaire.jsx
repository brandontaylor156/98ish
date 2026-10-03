import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import Dialog from "../../shared/Dialog"
import CardTable, { useSize } from "./CardTable"
import WinCascade from "./WinCascade"
import { unlock } from "../../../utils/achievements"
import { BACKS, DEFAULT_BACK, backUrl } from "./art"
import { load, save } from "./storage"
import * as K from "./klondike"

const SETTINGS_KEY = "98ish.solitaire"
const BANK_KEY = "98ish.solitaire.vegas"
const DEFAULTS = { draw: 1, scoring: "standard", timed: true, statusBar: true, keepScore: false, autoFinish: true, back: DEFAULT_BACK }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// A new game: the cards, the undo stack and the clock
const fresh = (settings, dealId = 0) => ({
  state: K.deal(settings),
  past: [], // [{ state, ticks }] for Undo
  started: null, // when the first move was made
  ticks: 0, // 10-second time penalties charged so far
  status: "playing", // "playing" | "won"
  dealId: dealId + 1,
})

const money = (n) => (n < 0 ? `-$${-n}` : `$${n}`)

// Run the time penalties forward on a state taken back by Undo
const penalize = (state, n) => {
  let s = state
  for (let i = 0; i < n; i++) s = K.applyTimePenalty(s)
  return s
}

const Solitaire = ({ onClose }) => {
  const chatItem = useGameChatMenuItem("solitaire")
  const [settings, setSettings] = useState(() => load(SETTINGS_KEY, DEFAULTS))
  const [play, setPlay] = useState(() => fresh(settings))
  const [selection, setSelection] = useState(null) // { pile, index } picked up by a tap
  const [dialog, setDialog] = useState(null)
  const [seconds, setSeconds] = useState(0)
  const [win, setWin] = useState(null) // { launches, launched } while the cards bounce
  const bank = useRef(load(BANK_KEY, 0)) // cumulative Vegas dollars before this game
  const rootRef = useRef(null)
  const tableRef = useRef(null)
  const size = useSize(tableRef)
  const playRef = useRef(play)
  playRef.current = play
  const { state } = play

  const vegasTotal = settings.scoring === "vegas" && settings.keepScore

  // ---- playing ----

  // A player's move: remember the position for Undo and start the clock
  const commit = (next) => {
    if (!next) return false
    setPlay((p) => ({ ...p, state: next, past: [...p.past, { state: p.state, ticks: p.ticks }], started: p.started ?? Date.now() }))
    setSelection(null)
    return true
  }

  const newGame = (nextSettings = settings) => {
    // cumulative Vegas: this game's dollars go into the running total
    if (vegasTotal) bank.current += playRef.current.state.score
    setPlay((p) => fresh(nextSettings, p.dealId))
    setSelection(null)
    setSeconds(0)
    setWin(null)
    setDialog(null)
  }

  const undo = () => {
    setPlay((p) => {
      if (!p.past.length || p.status !== "playing") return p
      const last = p.past[p.past.length - 1]
      return { ...p, state: penalize(last.state, p.ticks - last.ticks), past: p.past.slice(0, -1) }
    })
    setSelection(null)
  }

  const changeSettings = (patch) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    save(SETTINGS_KEY, next)
    // a different game (draw or scoring) needs a new deal
    if ((patch.draw && patch.draw !== settings.draw) || (patch.scoring && patch.scoring !== settings.scoring)) newGame(next)
  }

  // keys go back to the game when a dialog closes
  useEffect(() => {
    if (!dialog && document.activeElement === document.body) {
      rootRef.current.focus({ preventScroll: true })
    }
  }, [dialog])

  // ---- the clock and time penalties ----
  // Turning Timed on mid-game starts the penalties from now (not all the missed ones at once)
  const wasTimed = useRef(settings.timed)
  useEffect(() => {
    if (settings.timed && !wasTimed.current && play.started && play.status === "playing") {
      const due = Math.floor((Date.now() - play.started) / 10000)
      // (Undo charges the penalties since each step: count the skipped ones as paid there too)
      const skip = (ticks) => Math.max(ticks, due)
      setPlay((p) => ({ ...p, ticks: skip(p.ticks), past: p.past.map((e) => ({ ...e, ticks: skip(e.ticks) })) }))
    }
    wasTimed.current = settings.timed
  }, [settings.timed])
  useEffect(() => {
    if (!play.started || play.status !== "playing") return
    const tick = () => {
      const s = Math.floor((Date.now() - play.started) / 1000)
      setSeconds(s)
      if (!settings.timed) return
      setPlay((p) => {
        const due = Math.floor(s / 10)
        if (p.status !== "playing" || due <= p.ticks) return p
        return { ...p, state: penalize(p.state, due - p.ticks), ticks: due }
      })
    }
    tick()
    const timer = setInterval(tick, 500)
    return () => clearInterval(timer)
  }, [play.started, play.status, settings.timed])

  // ---- Vegas: the running total is saved as it changes ----
  useEffect(() => {
    if (vegasTotal) save(BANK_KEY, bank.current + state.score)
  }, [state, vegasTotal])

  // ---- winning ----
  useEffect(() => {
    if (play.status !== "playing" || !K.isWon(state)) return
    const elapsed = play.started ? Math.floor((Date.now() - play.started) / 1000) : 0
    const bonus = settings.timed ? K.timeBonus(state, elapsed) : 0
    setSeconds(elapsed)
    setPlay((p) => ({ ...p, status: "won", state: { ...p.state, score: p.state.score + bonus } }))
    setSelection(null)
    unlock("solitaire")
  }, [state, play.status])

  // ---- auto-finish: once every card is face up, play them home ----
  useEffect(() => {
    if (!settings.autoFinish || play.status !== "playing" || !K.canAutoFinish(state)) return
    const timer = setTimeout(() => {
      setPlay((p) => {
        const next = K.finishStep(p.state)
        return next ? { ...p, state: next } : p
      })
    }, 90)
    return () => clearTimeout(timer)
  }, [state, settings.autoFinish, play.status])

  // ---- layout ----
  const layout = useMemo(() => {
    const W = size.width
    const H = size.height
    if (!W || !H) return null
    const gap = clamp(W * 0.012, 3, 12)
    const byWidth = (W - 8 * gap) / 7
    const byHeight = ((H - 2.6 * gap) / 4.1) * (71 / 96)
    const cw = Math.floor(clamp(Math.min(byWidth, byHeight), 24, 71 * 1.75))
    const ch = Math.round((cw * 96) / 71)
    const left = Math.round((W - (7 * cw + 6 * gap)) / 2)
    const colX = (i) => Math.round(left + i * (cw + gap))
    const topY = Math.round(gap)
    const tabY = Math.round(topY + ch + gap * 1.5)
    const thick = (i) => Math.floor(i / 10) * Math.max(1, cw / 60) // a stack shows its depth
    const cards = []
    const add = (card, pile, index, x, y) => cards.push({ card, pile, index, x: Math.round(x), y: Math.round(y), z: index + 1 })

    state.stock.forEach((c, i) => add(c, "stock", i, colX(0) + thick(i), topY + thick(i)))

    const n = state.waste.length
    const fanned = n ? clamp(state.fan, 1, Math.min(3, n)) : 0
    const fanDx = Math.round(cw * 0.2)
    state.waste.forEach((c, i) => {
      const k = i - (n - fanned)
      const base = thick(Math.min(i, n - fanned))
      add(c, "waste", i, colX(1) + base + Math.max(0, k) * fanDx, topY + base)
    })

    state.foundations.forEach((f, j) => f.forEach((c, i) => add(c, "f" + j, i, colX(3 + j) + thick(i), topY + thick(i))))

    const room = H - tabY - ch - gap
    const tall = H > W * 1.2 // a phone held upright has room to spread the columns out
    const rects = {}
    state.tableau.forEach((col, j) => {
      const downs = col.filter((c) => !c.up).length
      const ups = Math.max(0, col.length - downs - 1)
      let down = Math.max(3, ch * (tall ? 0.1 : 0.07))
      let up = ch * (tall ? 0.32 : 0.25)
      const need = downs * down + ups * up
      if (need > room && need > 0) {
        const s = room / need
        down *= s
        up *= s
      }
      let y = tabY
      col.forEach((c, i) => {
        add(c, "t" + j, i, colX(j), y)
        y += c.up ? up : down
      })
      const bottom = col.length ? cards[cards.length - 1].y + ch : tabY + ch
      rects["t" + j] = { x: colX(j), y: tabY, w: cw, h: Math.max(ch, bottom - tabY) }
    })
    K.FOUNDATIONS.forEach((f, j) => (rects[f] = { x: colX(3 + j), y: topY, w: cw, h: ch }))

    // the empty stock: O to turn the waste over, X once Vegas allows no more passes
    const recycleKind = state.stock.length ? "outline" : state.waste.length && !K.canRecycle(state) ? "done" : "recycle"
    const slots = [
      { pile: "stock", x: colX(0), y: topY, kind: recycleKind },
      ...K.FOUNDATIONS.map((f, j) => ({ pile: f, x: colX(3 + j), y: topY, kind: "outline" })),
      ...K.TABLEAU.map((t, j) => ({ pile: t, x: colX(j), y: tabY, kind: "outline" })),
    ]
    return { cw, ch, cards, slots, rects, dealFrom: { x: colX(0), y: topY } }
  }, [state, size])

  // the bounce starts once the won game has been drawn (a game won while minimized, by
  // auto-finish, waits for the table to have a size again)
  const bounced = useRef(false)
  useEffect(() => {
    if (play.status !== "won") bounced.current = false
    if (play.status !== "won" || !layout || bounced.current) return
    bounced.current = true
    const launches = []
    for (let rank = 13; rank >= 1; rank--) {
      for (let f = 0; f < 4; f++) {
        const card = state.foundations[f][rank - 1]
        const at = layout.cards.find((c) => c.card.id === card.id)
        launches.push({ card, x: at.x, y: at.y })
      }
    }
    setWin({ launches, launched: 0 })
  }, [play.status, !!layout])

  // selection and the cards already flown off in the win animation
  const shown = useMemo(() => {
    if (!layout) return []
    const gone = new Set(win ? win.launches.slice(0, win.launched).map((l) => l.card.id) : [])
    return layout.cards.map((c) => ({
      ...c,
      selected: selection && c.pile === selection.pile && c.index >= selection.index,
      hidden: gone.has(c.card.id),
    }))
  }, [layout, selection, win])

  // ---- input ----
  const busy = play.status !== "playing"

  const onTap = (pile, index, pointer) => {
    const s = playRef.current.state
    if (pile === "stock") {
      setSelection(null)
      return commit(K.drawStock(s))
    }
    if (pile === null) return setSelection(null)
    const cards = K.pile(s, pile)
    // turn over a face-down card (as in Windows 98, it takes a click)
    if (pile[0] === "t" && cards.length && !cards[cards.length - 1].up && (index === cards.length - 1 || index === -1)) {
      return commit(K.flip(s, pile))
    }
    // fingers: tap a card to pick it up, tap where it goes
    if (pointer === "mouse") return setSelection(null)
    if (selection) {
      if (selection.pile !== pile && commit(K.move(s, selection.pile, selection.index, pile))) return
      if (selection.pile === pile && selection.index === index) return setSelection(null)
    }
    setSelection(index >= 0 && K.canPickUp(s, pile, index) ? { pile, index } : null)
  }

  const onDoubleTap = (pile, index, pointer) => {
    const s = playRef.current.state
    if (pile === "stock") return commit(K.drawStock(s))
    setSelection(null)
    const cards = K.pile(s, pile)
    if (index !== cards.length - 1) return onTap(pile, index, pointer)
    if (!commit(K.toFoundation(s, pile)) && pointer !== "mouse" && K.canPickUp(s, pile, index)) {
      // a second tap that can't go home just keeps the card picked up
      setSelection({ pile, index })
    }
  }

  const onKeyDown = (e) => {
    if (e.key === "F2") {
      e.preventDefault()
      newGame()
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault()
      undo()
    } else if (e.key === "Escape") setSelection(null)
  }

  // Tests and tinkering in development: window.__solitaire.load(state)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__solitaire = {
      get: () => playRef.current,
      load: (s) => {
        setWin(null)
        setDialog(null)
        setSelection(null)
        setPlay((p) => ({ ...p, state: { ...K.deal(settings), ...s }, past: [], status: "playing" }))
      },
    }
    return () => delete window.__solitaire
  }, [settings])

  const menus = [
    {
      label: "Game",
      items: [
        { label: "Deal F2", onClick: () => newGame() },
        "-",
        { label: "Undo Ctrl+Z", disabled: !play.past.length || busy, onClick: undo },
        { label: "Deck...", onClick: () => setDialog({ kind: "deck", back: settings.back }) },
        { label: "Options...", onClick: () => setDialog({ kind: "options", ...settings }) },
        chatItem,
        "-",
        { label: "Exit", onClick: () => onClose?.() },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "How to Play...", onClick: () => setDialog({ kind: "help" }) },
        { label: "About Solitaire...", onClick: () => setDialog({ kind: "about" }) },
      ],
    },
  ]

  const scoreText =
    settings.scoring === "none" ? null : settings.scoring === "vegas" ? money(vegasTotal ? bank.current + state.score : state.score) : String(state.score)

  return (
    <div className="cardsRoot" ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      <MenuBar menus={menus} />
      <GameChat game="solitaire" title="Solitaire" />
      <div className="cardsFelt">
        <CardTable
          tableRef={tableRef}
          cards={shown}
          slots={layout?.slots || []}
          dropRects={layout?.rects || {}}
          cw={layout?.cw || 71}
          ch={layout?.ch || 96}
          back={settings.back}
          dealKey={play.dealId}
          dealFrom={layout?.dealFrom}
          locked={busy}
          canPickUp={(pile, index) => K.canPickUp(playRef.current.state, pile, index)}
          canDrop={(pile, index, to) => K.canMove(playRef.current.state, pile, index, to)}
          onDrop={(pile, index, to) => commit(K.move(playRef.current.state, pile, index, to))}
          onTap={onTap}
          onDoubleTap={onDoubleTap}
          onRightClick={() => commit(K.autoPlay(playRef.current.state))}
        >
          {win && layout && (
            <WinCascade
              launches={win.launches}
              cw={layout.cw}
              ch={layout.ch}
              width={size.width}
              height={size.height}
              onLaunch={(n) => setWin((w) => (w ? { ...w, launched: n } : w))}
              onDone={() => {
                setWin(null)
                setDialog({ kind: "again" })
              }}
            />
          )}
        </CardTable>
      </div>
      {settings.statusBar && (
        <div className="status-bar cardsStatus">
          <p className="status-bar-field">{play.status === "won" ? "You win!" : settings.draw === 3 ? "Draw Three" : "Draw One"}</p>
          {scoreText !== null && <p className="status-bar-field">Score: {scoreText}</p>}
          {settings.timed && <p className="status-bar-field">Time: {seconds}</p>}
        </div>
      )}

      {dialog?.kind === "again" && (
        <Dialog title="Solitaire" okLabel="Yes" cancelLabel="No" onOk={() => newGame()} onCancel={() => setDialog(null)}>
          <p className="dialogText">Deal again?</p>
        </Dialog>
      )}

      {dialog?.kind === "options" && (
        <Dialog
          title="Options"
          onOk={() => {
            const { kind, ...next } = dialog
            changeSettings(next)
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <div className="cardsOptions">
            <fieldset className="cardsGroup">
              <legend>Draw</legend>
              {[
                [1, "Draw One"],
                [3, "Draw Three"],
              ].map(([value, label]) => (
                <div className="field-row cardsRadio" key={value}>
                  <input type="radio" id={`sol-draw-${value}`} checked={dialog.draw === value} onChange={() => setDialog({ ...dialog, draw: value })} />
                  <label htmlFor={`sol-draw-${value}`}>{label}</label>
                </div>
              ))}
            </fieldset>
            <fieldset className="cardsGroup">
              <legend>Scoring</legend>
              {[
                ["standard", "Standard"],
                ["vegas", "Vegas"],
                ["none", "None"],
              ].map(([value, label]) => (
                <div className="field-row cardsRadio" key={value}>
                  <input type="radio" id={`sol-score-${value}`} checked={dialog.scoring === value} onChange={() => setDialog({ ...dialog, scoring: value })} />
                  <label htmlFor={`sol-score-${value}`}>{label}</label>
                </div>
              ))}
            </fieldset>
          </div>
          <div className="cardsChecks">
            {[
              ["timed", "Timed game"],
              ["statusBar", "Status bar"],
              ["autoFinish", "Auto-finish"],
              ["keepScore", "Keep score", dialog.scoring !== "vegas"],
            ].map(([key, label, disabled]) => (
              <div className="field-row cardsRadio" key={key}>
                <input
                  type="checkbox"
                  id={`sol-${key}`}
                  checked={!!dialog[key]}
                  disabled={disabled}
                  onChange={() => setDialog({ ...dialog, [key]: !dialog[key] })}
                />
                <label htmlFor={`sol-${key}`}>{label}</label>
              </div>
            ))}
          </div>
        </Dialog>
      )}

      {dialog?.kind === "deck" && (
        <Dialog
          title="Select Card Back"
          onOk={() => {
            changeSettings({ back: dialog.back })
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <div className="cardsBacks">
            {BACKS.map((b) => (
              <button
                key={b.id}
                type="button"
                className={dialog.back === b.id ? "is-on" : ""}
                aria-label={b.name}
                title={b.name}
                onClick={() => setDialog({ ...dialog, back: b.id })}
                onDoubleClick={() => {
                  changeSettings({ back: b.id })
                  setDialog(null)
                }}
              >
                <img src={backUrl(b.id)} alt="" draggable={false} />
              </button>
            ))}
          </div>
        </Dialog>
      )}

      {dialog?.kind === "help" && (
        <Dialog title="How to Play" onOk={() => setDialog(null)}>
          <p className="dialogText">
            Build four piles up by suit, ace to king, at the top right. In the row below, stack cards down in alternating
            colors; only a king goes in an empty space.
            <br />
            <br />
            <b>Click the deck</b> to deal; when it's empty, click it again to turn the pile over. <b>Drag</b> cards (or a run of
            them) to move them, <b>click</b> a face-down card to turn it over, and <b>double-click</b> a card to send it up
            to its suit. <b>Right-click</b> sends everything that can go up.
            <br />
            <br />
            On a touch screen you can also <b>tap</b> a card to pick it up and tap where it goes.
          </p>
        </Dialog>
      )}

      {dialog?.kind === "about" && (
        <Dialog title="About Solitaire" onOk={() => setDialog(null)}>
          <p className="dialogText">
            <b>Solitaire</b> for 98ish.
            <br />
            Klondike, with Draw One or Three, Standard or Vegas scoring and a choice of {BACKS.length} card backs.
          </p>
        </Dialog>
      )}
    </div>
  )
}

export default Solitaire
