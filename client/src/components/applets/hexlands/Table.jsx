import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import BoardView from "./BoardView.jsx"
import { PlayersPanel, HandPanel, BuildMenu, LogPanel, Secs, buildSpots, buildBlocker, rename } from "./Panels.jsx"
import { TradePanel, IncomingOffer } from "./Trade.jsx"
import { DiscardDialog, VictimDialog, DevDialog, EndScreen } from "./Dialogs.jsx"
import { Die, ResSvg, R } from "./art.jsx"
import { geometry } from "./board.js"
import { COSTS, RES, banditTiles, hasAll, legalRoads, legalSettlements, total, victimsAt } from "./logic.js"

// The game table, the same for games against the computer and online ones: the island,
// the dice, the players, your hand, building, trading, the log and the end of the game.
// view: your view of the game (rules.js view()); act(action) -> Promise<{ ok, error }>;
// names / seats: who sits where (online seats can turn into computer players); coach:
// tips for a first game. Layouts: "desk" (a side panel), "tall" (a phone held upright),
// "side" (a phone on its side, or a short window).

const useLayout = (ref, mobile) => {
  const [size, setSize] = useState({ w: 900, h: 600 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const { w, h } = size
  if (!mobile && w >= 760 && h >= 460) return "desk"
  return h > w * 1.05 ? "tall" : "side"
}

const isCoarse = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches

// cards flying from a tile to a player
const Flyer = ({ f, onDone }) => {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el?.animate) return onDone(f.id)
    const anim = el.animate(
      [
        { transform: `translate(${f.x0}px, ${f.y0}px) scale(.6)`, opacity: 0 },
        { transform: `translate(${f.x0}px, ${f.y0 - 26}px) scale(1.1)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${f.x1}px, ${f.y1}px) scale(.7)`, opacity: 0.9 },
      ],
      { duration: 900, delay: f.delay, easing: "cubic-bezier(.45,.05,.4,1)", fill: "both" }
    )
    anim.onfinish = () => onDone(f.id)
    return () => anim.cancel()
  }, [])
  return (
    <div ref={ref} className={`hxFlyer hx-${f.r}`} style={{ transform: `translate(${f.x0}px, ${f.y0}px)`, opacity: 0 }}>
      <ResSvg r={f.r} size={22} />
    </div>
  )
}

const Sheet = ({ title, onClose, children, name }) => (
  <div className="hxSheetBack" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="hxSheet" role="dialog" aria-label={title} data-sheet={name}>
      <div className="hxSheetHead">
        <span className="hxSheetHandle" />
        <b>{title}</b>
        <button type="button" className="hxClose" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="hxSheetBody">{children}</div>
    </div>
  </div>
)

const Table = ({ view, names: rawNames, seats, act, mobile = false, sounds, serverNow = Date.now, coach = false, endFooter = null, onEvent }) => {
  const rootRef = useRef(null)
  const boardRef = useRef(null)
  const layout = useLayout(rootRef, mobile)
  const touch = mobile || isCoarse()
  const names = useMemo(() => view.players.map((p, i) => rawNames?.[i] || p.name), [rawNames, view.players])
  const me = view.you
  const spectator = me == null
  const n = view.players.length
  const builderNow = view.phase === "special" ? view.special?.queue[view.special.at] : view.turn
  const myTurn = !spectator && view.turn === me
  const canAct = !spectator && builderNow === me && (view.phase === "main" || view.phase === "special")
  const canTrade = !spectator && myTurn && view.phase === "main"

  const [mode, setMode] = useState(null)
  const [selected, setSelected] = useState(null)
  const [preview, setPreview] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [devCard, setDevCard] = useState(null)
  const [victims, setVictims] = useState(null)
  const [toast, setToast] = useState(null)
  const [banner, setBanner] = useState(null)
  const [rolling, setRolling] = useState(false)
  const [hot, setHot] = useState(null)
  const [fresh, setFresh] = useState(() => new Set())
  const [flyers, setFlyers] = useState([])
  const [showEnd, setShowEnd] = useState(true)

  const toastTimer = useRef(null)
  const say = (text, kind = "info", ms = 2600) => {
    setToast({ text, kind, id: Math.random() })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }
  const send = async (a) => {
    const r = await act(a)
    if (!r?.ok) {
      sounds?.play("error")
      say(r?.error || "That didn't work.", "error")
    }
    return r
  }

  // leave building mode when the moment passes
  useEffect(() => {
    setSelected(null)
    if (!canAct) setMode(null)
  }, [view.phase, view.turn, view.special?.at, canAct])
  useEffect(() => {
    if (mode && canAct && buildBlocker(view, mode, canAct)) setMode(null)
  }, [view])
  useEffect(() => {
    if (!canTrade && sheet === "trade" && !view.trade) setSheet(null)
  }, [canTrade])

  // ---------- what the board lets you pick ----------
  let pick = null
  if (!spectator && view.phase !== "over") {
    if (view.phase === "setup" && myTurn) pick = view.setupVertex == null ? { kind: "settlement", spots: legalSettlements(view, me, true) } : { kind: "road", spots: legalRoads(view, me, view.setupVertex) }
    else if (view.phase === "roads" && myTurn) pick = { kind: "road", spots: legalRoads(view, me) }
    else if (view.phase === "bandit" && myTurn) pick = { kind: "bandit", spots: banditTiles(view, me) }
    else if (mode && canAct) pick = { kind: mode, spots: buildSpots(view, mode) }
  }
  if (pick) pick.selected = pick.spots.includes(selected) ? selected : null

  const commit = async (kind, id) => {
    setSelected(null)
    if (kind === "bandit") {
      const list = victimsAt(view, id, me, (p) => view.players[p].cards)
      if (list.length > 1) return setVictims({ tile: id, list })
      return send({ type: "bandit", tile: id, victim: list[0] ?? null })
    }
    const r = await send({ type: "build", what: kind, at: id })
    if (r?.ok && mode) setMode(null)
  }
  const onPick = (id) => {
    if (!pick) return
    if (touch && pick.selected !== id) return setSelected(id)
    commit(pick.kind, id)
  }

  // ---------- reacting to what just happened (animations and sounds) ----------
  const seen = useRef(null)
  useEffect(() => {
    const log = view.log
    const lastId = log.at(-1)?.id ?? 0
    if (seen.current == null) {
      seen.current = lastId
      return
    }
    const news = log.filter((e) => e.id > seen.current)
    seen.current = lastId
    let wait = 0
    for (const e of news) {
      onEvent?.(e)
      if (e.k === "roll") {
        setRolling(true)
        sounds?.play("roll")
        const sum = e.dice[0] + e.dice[1]
        setTimeout(() => {
          setRolling(false)
          if (sum !== 7) {
            setHot(sum)
            setTimeout(() => setHot((h) => (h === sum ? null : h)), 2400)
          }
        }, 650)
        wait = 700
      } else if (e.k === "produce") {
        const gains = e.gains || []
        setTimeout(() => {
          fly(gains)
          if (gains.length) sounds?.play("gain", gains.reduce((a, g) => a + g.n, 0))
        }, wait)
      } else if (e.k === "build") {
        const key = `${e.what === "road" ? "e" : "v"}${e.at}`
        setFresh((s) => new Set(s).add(key))
        setTimeout(() => setFresh((s) => {
          const next = new Set(s)
          next.delete(key)
          return next
        }), 900)
        sounds?.play(e.what === "city" ? "city" : "build")
      } else if (e.k === "steal") {
        sounds?.play("steal")
        if (e.r && e.from === me) say(`${names[e.by]} took your ${e.r}!`, "bad")
        else if (e.r && e.by === me) say(`You took ${e.r} from ${names[e.from]}.`, "good")
      } else if (e.k === "bandit") sounds?.play("bandit")
      else if (e.k === "seven") {
        sounds?.play("bandit")
        setBanner({ text: "Seven! The Bandit strikes", kind: "seven", id: e.id })
      } else if (e.k === "trade" || e.k === "bank") sounds?.play("trade")
      else if (e.k === "offer") {
        if (view.trade && view.trade.from !== me && view.trade.to.includes(me)) sounds?.play("offer")
      } else if (e.k === "play") {
        sounds?.play("dev")
        setBanner({ text: rename(e.text, view, names).replace(/\.$/, ""), kind: "dev", id: e.id })
      } else if (e.k === "buy") sounds?.play("card")
      else if (e.k === "discard") sounds?.play("card")
      else if (e.k === "longest" || e.k === "army") {
        if (e.p != null) {
          sounds?.play("award")
          setBanner({ text: rename(e.text, view, names).replace(/!$/, ""), kind: "award", id: e.id })
        }
      } else if (e.k === "turn" && e.p === me) {
        sounds?.play("turn")
        setBanner({ text: "Your turn!", kind: "turn", id: e.id })
      } else if (e.k === "win") {
        sounds?.play(e.p === me ? "win" : "lose")
        setShowEnd(true)
      }
    }
  }, [view.log])
  useEffect(() => {
    if (!banner) return
    const h = setTimeout(() => setBanner((b) => (b?.id === banner.id ? null : b)), 2000)
    return () => clearTimeout(h)
  }, [banner])

  const fly = (gains) => {
    if (view.phase === "over") return
    const root = rootRef.current?.getBoundingClientRect()
    if (!root || !boardRef.current) return
    const target = (p, r) => {
      const el = (p === me && rootRef.current.querySelector(`[data-hand="${r}"]`)) || rootRef.current.querySelector(`[data-player-row="${p}"] .hxAvatar`)
      const b = el?.getBoundingClientRect()
      return b ? { x: b.left + b.width / 2 - root.left - 14, y: b.top + b.height / 2 - root.top - 14 } : null
    }
    const items = []
    let k = 0
    for (const g of gains) {
      const from = boardRef.current.tileOnScreen(g.tile)
      const to = target(g.p, g.r)
      if (!from || !to) continue
      for (let i = 0; i < g.n; i++) items.push({ id: `${Date.now()}-${Math.random()}`, r: g.r, x0: from.x - root.left - 14, y0: from.y - root.top - 14, x1: to.x, y1: to.y, delay: k++ * 90 })
    }
    if (items.length) setFlyers((f) => [...f, ...items].slice(-40))
  }

  // ---------- the turn clock (its own little components tick, not the whole table) ----------
  const clockStart = useRef({ deadline: null, start: null })
  if (view.deadline !== clockStart.current.deadline) clockStart.current = { deadline: view.deadline, start: serverNow() }
  const clock = useMemo(() => (view.deadline ? { deadline: view.deadline, start: clockStart.current.start, now: serverNow } : null), [view.deadline])
  const onMe = builderNow === me || myTurn || !!view.discards?.[me]

  // ---------- words ----------
  const who = names[view.turn]
  const status = (() => {
    if (view.phase === "over") return `${names[view.winner]} wins with ${view.players[view.winner].points} points!`
    if (spectator) return `${who}'s turn.`
    switch (view.phase) {
      case "setup":
        if (!myTurn) return `${who} is placing ${view.setupVertex == null ? "a settlement" : "a road"}...`
        if (view.setupVertex != null) return "Now place a road touching your new settlement."
        return view.setupStep >= n ? "Place your second settlement. It collects its resources right away." : "Place your first settlement on a glowing corner."
      case "roll":
        return myTurn ? "Your turn! Roll the dice." : `${who} is rolling...`
      case "discard":
        return view.discards[me] ? `Seven! Discard ${view.discards[me]} cards.` : `Waiting for ${Object.keys(view.discards).map((p) => names[p]).join(", ")} to discard...`
      case "bandit":
        return myTurn ? "Move the Bandit: pick a tile to block, then take a card." : `${who} is moving the Bandit...`
      case "roads":
        return myTurn ? `Place ${view.freeRoads} free road${view.freeRoads === 1 ? "" : "s"}.` : `${who} is building free roads...`
      case "special":
        return builderNow === me ? "Special building: build or buy now, or pass." : `${names[builderNow]} may build...`
      default:
        if (myTurn) return mode ? `Pick a spot for your ${mode}.` : "Build, trade, or end your turn."
        if (view.trade && view.trade.to.includes(me) && !view.trade.replies[me]) return `${who} wants to trade with you.`
        return `${who}'s turn.`
    }
  })()
  const tip = (() => {
    if (!coach || spectator) return null
    const hand = view.players[me].hand
    switch (view.phase) {
      case "setup":
        if (!myTurn) return "Watch where others settle: two settlements can't sit on neighboring corners."
        return view.setupVertex == null
          ? "Tip: corners touching big numbers (6, 8, 5, 9) pay most often: the dots under a number show its odds. A mix of resources is best."
          : "Tip: point the road toward another good corner. That's where your next settlement can go."
      case "roll":
        return myTurn ? "Every tile showing the number you roll pays 1 card to each settlement on its corners (2 to a city)." : "Their roll can pay you too, if you have a building next to the number."
      case "bandit":
        return myTurn ? "Tip: block a tile the leader depends on. The Bandit stops it paying anyone." : null
      case "discard":
        return "Tip: keep the cards you need for your next build."
      case "main":
        if (!myTurn) return view.trade?.to.includes(me) ? "Accept if the trade helps you. You can counter with different cards, too." : null
        if (hasAll(hand, COSTS.city) && buildSpots(view, "city").length) return "You can build a city! Open Build and pick one of your settlements: it doubles what that corner collects."
        if (hasAll(hand, COSTS.settlement) && buildSpots(view, "settlement").length) return "You can build a settlement! Open Build, then pick a glowing corner."
        if (hasAll(hand, COSTS.road)) return "Roads reach new corners for settlements. Open Build to see where they can go."
        if (total(hand) >= 4) return "Short of something? Trade: offer other players a deal, or swap 4 of a kind with the bank for 1 you need."
        return "Nothing to build yet? End your turn. More resources come with every roll."
      default:
        return null
    }
  })()

  // ---------- buttons ----------
  const primary = (() => {
    if (spectator || view.phase === "over") return null
    if (view.phase === "setup" && myTurn) return { label: "Your move", disabled: true, key: "you" }
    if (view.phase === "bandit" && myTurn) return { label: "Pick a tile", disabled: true, key: "you" }
    if (view.phase === "discard" && view.discards?.[me]) return { label: "Discard", disabled: true, key: "you" }
    if (view.phase === "roll" && myTurn) return { label: "Roll dice", act: () => send({ type: "roll" }), key: "roll" }
    if (view.phase === "main" && myTurn) return { label: "End turn", act: () => (setMode(null), send({ type: "end" })), key: "end" }
    if (view.phase === "roads" && myTurn) return { label: "Done", act: () => send({ type: "done" }), key: "done" }
    if (view.phase === "special" && builderNow === me) return { label: "Pass", act: () => send({ type: "end" }), key: "end" }
    return { label: "Waiting...", disabled: true, key: "wait" }
  })()

  const chooseBuild = (what) => {
    setSheet(null)
    setPreview(null)
    if (what === "dev") return send({ type: "buy" })
    setMode(mode === what ? null : what)
  }
  const previewSpots = preview && preview !== "dev" && canAct ? { kind: preview, spots: buildSpots(view, preview) } : null
  const pendingReplies = view.trade && view.trade.from === me ? view.trade.replies : null
  const incoming = !spectator && view.trade && view.trade.from !== me && view.trade.to.includes(me) && view.phase === "main"

  // Keyboard: R roll, E end, B build, T trade, Esc cancels
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.("input, textarea, select")) return
      if (!rootRef.current?.closest(".window")?.contains(document.activeElement) && document.activeElement !== document.body) return
      if (e.key === "Escape") {
        setMode(null)
        setSelected(null)
        setSheet(null)
      } else if ((e.key === "r" || e.key === "R") && primary?.key === "roll") primary.act()
      else if ((e.key === "e" || e.key === "E") && primary?.key === "end" && !primary.disabled) primary.act()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const dice = view.dice || [3, 4]
  const showDice = view.phase !== "setup"
  const meP = spectator ? null : view.players[me]

  const actions = !spectator && view.phase !== "over" && (
    <div className="hxActions">
      <button type="button" className={`hxAct${sheet === "build" || mode ? " is-on" : ""}`} onClick={() => setSheet(sheet === "build" ? null : "build")} disabled={!canAct && !mode} data-action="build">
        <span className="hxActIcon is-build" />
        Build
      </button>
      <button type="button" className={`hxAct${sheet === "trade" ? " is-on" : ""}`} onClick={() => setSheet(sheet === "trade" ? null : "trade")} disabled={!canTrade && !(view.trade && view.trade.from === me)} data-action="trade">
        <span className="hxActIcon is-trade" />
        Trade
      </button>
      {layout !== "desk" && (
        <button type="button" className={`hxAct${sheet === "more" ? " is-on" : ""}`} onClick={() => setSheet(sheet === "more" ? null : "more")} data-action="more">
          <span className="hxActIcon is-log" />
          Players
        </button>
      )}
      {primary && (
        <button type="button" className={`hxPrimary is-${primary.key}`} onClick={primary.act} disabled={primary.disabled} data-primary={primary.key}>
          {primary.label}
          {onMe && <Secs clock={clock} onTick={() => sounds?.play("tick")} />}
        </button>
      )}
    </div>
  )

  // the confirm bar sits away from the spot you picked
  const confirmTop = (() => {
    if (!pick || pick.selected == null || !boardRef.current) return false
    const g = geometry(view.geo)
    const at = pick.kind === "road" ? g.edges[pick.selected] : pick.kind === "bandit" ? g.tiles[pick.selected] : g.vertices[pick.selected]
    const p = boardRef.current.pointOnScreen(at.x * R, at.y * R)
    const box = rootRef.current?.querySelector(".hxBoardBox")?.getBoundingClientRect()
    return !!(p && box && p.y > box.top + box.height * 0.55)
  })()
  const confirmBar = pick && touch && pick.selected != null && (
    <div className={`hxConfirm${confirmTop ? " is-top" : ""}`}>
      <span>{pick.kind === "bandit" ? "Move the Bandit here?" : `Build a ${pick.kind} here?`}</span>
      <button type="button" className="hxGo" onClick={() => commit(pick.kind, pick.selected)} data-confirm-build>
        ✓ {pick.kind === "bandit" ? "Move" : "Build"}
      </button>
      <button type="button" onClick={() => setSelected(null)}>
        ✕
      </button>
    </div>
  )

  const statusEl = (
    <div className={`hxStatus${myTurn || builderNow === me || view.discards?.[me] ? " is-you" : ""}`} data-status>
      <span>{status}</span>
      {mode && canAct && (
        <button type="button" className="hxChip" onClick={() => setMode(null)}>
          Cancel
        </button>
      )}
      {tip && <small className="hxTip">{tip}</small>}
    </div>
  )

  const boardArea = (
    <div className="hxBoardWrap">
      {layout !== "side" && statusEl}
      <div className="hxBoardBox">
      <BoardView ref={boardRef} view={view} pick={pick} preview={previewSpots} hot={hot} fresh={fresh} touch={touch} onPick={onPick} compact={layout !== "desk"} />
      {showDice && (
        <div className="hxDice" data-dice={rolling ? "rolling" : dice.join(",")} title={view.dice ? `Last roll: ${dice[0] + dice[1]}` : "Nobody has rolled yet"}>
          <Die n={rolling ? 1 + Math.floor(Math.random() * 6) : dice[0]} rolling={rolling} />
          <Die n={rolling ? 1 + Math.floor(Math.random() * 6) : dice[1]} rolling={rolling} red />
          {!rolling && view.dice && <b className={dice[0] + dice[1] === 7 ? "is-seven" : ""}>{dice[0] + dice[1]}</b>}
        </div>
      )}
      <div className="hxZoom">
        <button type="button" onClick={() => boardRef.current?.zoomIn()} aria-label="Zoom in" data-zoom="in">
          +
        </button>
        <button type="button" onClick={() => boardRef.current?.zoomOut()} aria-label="Zoom out" data-zoom="out">
          −
        </button>
        <button type="button" onClick={() => boardRef.current?.fit()} aria-label="Fit the board" data-zoom="fit">
          ⤢
        </button>
      </div>
      {incoming && <IncomingOffer view={view} names={names} act={send} />}
      {confirmBar}
      {banner && (
        <div key={banner.id} className={`hxBanner is-${banner.kind}`}>
          {banner.text}
        </div>
      )}
      {view.phase === "over" && !showEnd && (
        <button type="button" className="hxResultsBtn" onClick={() => setShowEnd(true)} data-results>
          Show results
        </button>
      )}
      </div>
    </div>
  )

  const bankInfo = (
    <div className="hxBankInfo" title="The bank's cards and the development deck">
      {RES.map((r) => (
        <span key={r} className={view.bank[r] < 4 ? "is-low" : ""}>
          <ResSvg r={r} size={15} />
          {view.bank[r]}
        </span>
      ))}
      <span title="Development cards left">
        <i className="hxIconDev" />
        {view.deck}
      </span>
    </div>
  )

  const bottom = !spectator && (
    <div className="hxBottom">
      <HandPanel view={view} onDev={setDevCard} compact />
      {actions}
    </div>
  )

  const buildMenu = !spectator && <BuildMenu view={view} canAct={canAct} onChoose={chooseBuild} onHover={(w) => setPreview(w)} mode={mode} />
  const tradePanel = !spectator && <TradePanel view={view} names={names} act={send} canTrade={canTrade} onClose={layout === "desk" ? () => setSheet(null) : null} />

  return (
    <div ref={rootRef} className={`hxTable is-${layout}${touch ? " is-touch" : ""}`} data-layout={layout} data-phase={view.phase}>
      {layout === "desk" ? (
        <>
          <div className="hxMain">
            {boardArea}
            {!spectator && (
              <div className="hxBottom">
                <HandPanel view={view} onDev={setDevCard} />
                {actions}
              </div>
            )}
          </div>
          <aside className="hxSide">
            <PlayersPanel view={view} names={names} seats={seats} clock={clock} replies={pendingReplies} />
            {bankInfo}
            <LogPanel view={view} names={names} />
          </aside>
          {sheet === "build" && (
            <div className="hxPopover is-build" onMouseLeave={() => setPreview(null)}>
              <div className="hxPopHead">
                Build <small>(hover to see where)</small>
                <button type="button" className="hxClose" onClick={() => setSheet(null)} aria-label="Close">
                  ✕
                </button>
              </div>
              {buildMenu}
            </div>
          )}
          {sheet === "trade" && <div className="hxPopover is-trade">{tradePanel}</div>}
        </>
      ) : (
        <>
          {layout === "tall" && <PlayersPanel view={view} names={names} seats={seats} clock={clock} compact replies={pendingReplies} onPick={() => setSheet("more")} />}
          {boardArea}
          {layout === "tall" ? (
            bottom
          ) : (
            <div className="hxSideCol">
              {statusEl}
              <PlayersPanel view={view} names={names} seats={seats} clock={clock} compact replies={pendingReplies} onPick={() => setSheet("more")} />
              {bottom}
            </div>
          )}
          {sheet === "build" && (
            <Sheet title="Build" onClose={() => setSheet(null)} name="build">
              {buildMenu}
            </Sheet>
          )}
          {sheet === "trade" && (
            <Sheet title="Trade" onClose={() => setSheet(null)} name="trade">
              {tradePanel}
            </Sheet>
          )}
          {sheet === "more" && (
            <Sheet title="Players and log" onClose={() => setSheet(null)} name="more">
              <PlayersPanel view={view} names={names} seats={seats} clock={clock} replies={pendingReplies} />
              {bankInfo}
              <LogPanel view={view} names={names} />
            </Sheet>
          )}
        </>
      )}
      {!spectator && view.phase === "discard" && view.discards?.[me] ? <DiscardDialog key={`d${view.turnNo}`} view={view} act={send} /> : null}
      {victims && view.phase === "bandit" && (
        <VictimDialog
          view={view}
          names={names}
          tile={victims.tile}
          victims={victims.list}
          onCancel={() => setVictims(null)}
          onPick={(p) => {
            const t = victims.tile
            setVictims(null)
            send({ type: "bandit", tile: t, victim: p })
          }}
        />
      )}
      {devCard && meP?.dev?.some((d) => d.t === devCard) && <DevDialog view={view} card={devCard} act={send} onClose={() => setDevCard(null)} />}
      {view.phase === "over" && showEnd && <EndScreen view={view} names={names} footer={endFooter} onClose={() => setShowEnd(false)} />}
      {toast && (
        <div key={toast.id} className={`hxToast is-${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}
      <div className="hxFlyers" aria-hidden="true">
        {flyers.map((f) => (
          <Flyer key={f.id} f={f} onDone={(id) => setFlyers((list) => list.filter((x) => x.id !== id))} />
        ))}
      </div>
    </div>
  )
}

export default Table
