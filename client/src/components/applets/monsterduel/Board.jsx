import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Card, CardBack, MiniCard } from "./Card"
import { CARD } from "./engine/cards"
import "./Board.css"

// The duel table. It draws a match view (engine/rules.js view(): the duel as one seat may
// see it, plus that seat's legal moves) and turns clicks, taps and drags into moves:
// pick a card, pick what to do with it from its menu, then pick tributes or targets on the
// board. Long-press (or hover) shows a card big. Animations come from the duel's effect
// list (fx): a new view is shown a moment late when an attack needs to lunge first.
//
// props: view, seat (null: watching), act(move) -> Promise<{ ok, error }>, sounds, mobile,
// serverNow, respond / onRespond (when to be asked), tutorial ({ text, step, allow(move),
// glow: [selectors] }), overlay (shown over the table when the match ends), menuExtra

const PHASES = ["draw", "standby", "main1", "battle", "main2", "end"]
const SHORT = { draw: "DP", standby: "SP", main1: "M1", battle: "BP", main2: "M2", end: "EP" }
const LONG = { draw: "Draw Phase", standby: "Standby Phase", main1: "Main Phase 1", battle: "Battle Phase", main2: "Main Phase 2", end: "End Phase" }
const REASONS = { chain: "responded to a card", attack: "is attacking", summon: "summoned a monster", battle: "entered the Battle Phase", end: "is ending the turn" }

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

// ---------- sizes ----------

// s: the side of one zone square; layout: wide (side panel), tall (no panel), flat (phone
// on its side: hand on the right)
const useBoardSize = (ref) => {
  const [size, setSize] = useState({ s: 72, layout: "tall" })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (!w || !h) return
      const flat = h < 520 && w > h * 1.3
      const side = !flat && w >= 880 ? Math.min(260, Math.max(210, w * 0.22)) : 0
      let s
      if (flat) s = Math.min((h - 12 - 64) / 4.25, (w - 12 - 132) / (7.25 + 2.3))
      else s = Math.min((w - side - 18) / 7.3, (h - 12 - 40 - 64) / (4.25 + 0.55 + 1.25))
      s = Math.max(30, Math.floor(s))
      // a tall, narrow table (a phone held upright) has height to spare: taller zones and
      // bigger cards
      let zh = s
      if (!flat && !side) {
        const hand = Math.min(s * 1.35, (w - 20) / 5.5) * (86 / 59)
        zh = Math.floor(Math.max(s, Math.min(s * 1.5, (h - 12 - 3 * 34 - s * 0.5 - hand - 30) / 4.3)))
      }
      setSize({ s, zh, layout: flat ? "flat" : side ? "wide" : "tall", side, w, h })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

// ---------- small pieces ----------

const AnimatedNumber = ({ value, className }) => {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (reduced()) return setShown(value)
    const start = performance.now()
    const a = from.current
    let raf
    const step = (t) => {
      const k = Math.min(1, (t - start) / 700)
      const v = Math.round(a + (value - a) * (1 - Math.pow(1 - k, 3)))
      setShown(v)
      if (k < 1) raf = requestAnimationFrame(step)
      else from.current = value
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      from.current = value
    }
  }, [value])
  return <span className={className}>{shown}</span>
}

const Countdown = ({ until, serverNow, className = "" }) => {
  const [now, setNow] = useState(() => serverNow())
  useEffect(() => {
    if (!until) return
    const t = setInterval(() => setNow(serverNow()), 250)
    return () => clearInterval(t)
  }, [until, serverNow])
  if (!until) return null
  const left = Math.max(0, Math.ceil((until - now) / 1000))
  return <span className={`mdClock ${left <= 10 ? "is-low" : ""} ${className}`}>{left >= 60 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : `${left}s`}</span>
}

const idOf = (d, uid) => {
  if (!d || !uid) return null
  for (const p of d.players) {
    for (const z of [p.m, p.s, [p.f]]) for (const x of z) if (x?.uid === uid) return x.id || null
    for (const z of [p.hand, p.gy, p.ban, p.extra]) if (Array.isArray(z)) for (const c of z) if (c.uid === uid) return c.id
  }
  return null
}
const slotOf = (d, uid) => {
  for (const [seat, p] of d.players.entries()) {
    for (const [i, x] of p.m.entries()) if (x?.uid === uid) return { seat, zone: "m", i, slot: x }
    for (const [i, x] of p.s.entries()) if (x?.uid === uid) return { seat, zone: "s", i, slot: x }
    if (p.f?.uid === uid) return { seat, zone: "f", i: 0, slot: p.f }
  }
  return null
}

const moveLabel = (m, d) => {
  const id = idOf(d, m.uid)
  const c = CARD[id]
  switch (m.type) {
    case "summon":
      return m.tributes ? `Tribute Summon (${m.tributes})` : "Normal Summon"
    case "set":
      return c?.kind === "monster" ? (m.tributes ? `Set (tribute ${m.tributes})` : "Set face-down") : "Set face-down"
    case "activate":
      return c?.kind === "monster" ? "Use Effect" : "Activate"
    case "flip":
      return "Flip Summon"
    case "position":
      return slotOf(d, m.uid)?.slot.pos === "atk" ? "Change to Defense" : "Change to Attack"
    case "attack":
      return "Attack"
    default:
      return m.type
  }
}

// ---------- the board ----------

const Board = ({ view, seat, act, sounds, mobile = false, serverNow = Date.now, respond = "auto", onRespond, tutorial = null, overlay = null, onLeave }) => {
  const rootRef = useRef(null)
  const { s, zh = s, layout, w = 800 } = useBoardSize(rootRef)
  // the card in a zone, and how much a Defense Position card shrinks to fit sideways
  const cardW = Math.min(zh * 0.64, s * 0.94)
  const defScale = Math.min(1, (s * 0.97) / ((cardW * 86) / 59))
  const me = seat ?? 0
  const them = 1 - me
  const watching = seat == null

  // the view on screen trails the latest one while an attack lunges
  const [shown, setShown] = useState(view)
  const [flash, setFlash] = useState({}) // uid -> kind
  const [ghosts, setGhosts] = useState([]) // destroyed cards shattering
  const [floats, setFloats] = useState([]) // damage numbers
  const [popups, setPopups] = useState([]) // activated cards
  const [banner, setBanner] = useState(null) // "Your turn"
  const [lunge, setLunge] = useState(null) // { uid, dx, dy }
  const [impact, setImpact] = useState(null)
  const lastSeq = useRef(view?.duel?.seq || 0)
  const commitTimer = useRef(null)

  const [sel, setSel] = useState(null) // { uid, rect }
  const [mode, setMode] = useState(null) // tribute | target | cost | attack
  const [inspect, setInspect] = useState(null) // { id, stats }
  const [zoom, setZoom] = useState(null) // phones: a card shown big
  const [pile, setPile] = useState(null) // { title, cards }
  const [picks, setPicks] = useState([])
  const [toast, setToast] = useState(null)
  const [showLog, setShowLog] = useState(false)
  const [pointer, setPointer] = useState(null)
  const [drag, setDrag] = useState(null) // { uid, x, y, id }
  const busy = useRef(false)

  const d = shown?.duel
  const legal = shown === view ? view?.legal || [] : []
  const myTurn = d && d.active === me
  const wait = d?.wait
  const myWait = wait && wait.seat === me && !watching

  // ---------- animations from the effect list ----------

  const rectIn = useCallback((el) => {
    const root = rootRef.current?.getBoundingClientRect()
    const r = el?.getBoundingClientRect()
    if (!root || !r) return null
    return { x: r.left - root.left, y: r.top - root.top, w: r.width, h: r.height }
  }, [])
  const elFor = (uid) => rootRef.current?.querySelector(`[data-uid="${uid}"]`)

  const playFx = useCallback(
    (list, before) => {
      const flashes = {}
      const nextGhosts = []
      const nextFloats = []
      const nextPopups = []
      let at = 0
      for (const f of list) {
        switch (f.k) {
          case "summon":
            flashes[f.uid] = f.how === "fusion" ? "fusion" : "summon"
            setTimeout(() => sounds?.summon(), at)
            break
          case "set":
            flashes[f.uid] = "set"
            setTimeout(() => sounds?.set(), at)
            break
          case "flip":
            flashes[f.uid] = "flip"
            setTimeout(() => sounds?.flip(), at)
            break
          case "position":
            flashes[f.uid] = "position"
            setTimeout(() => sounds?.position(), at)
            break
          case "buff":
            flashes[f.uid] = f.atk < 0 || f.def < 0 ? "debuff" : "buff"
            break
          case "equip":
            flashes[f.target] = "buff"
            break
          case "draw":
            if (f.uid) flashes[f.uid] = "draw"
            setTimeout(() => sounds?.draw(), at)
            break
          case "tohand":
          case "bounce":
            if (f.uid) flashes[f.uid] = "draw"
            break
          case "activate":
            nextPopups.push({ key: f.n, id: f.id, seat: f.seat, link: f.link })
            setTimeout(() => sounds?.activate(CARD[f.id]?.kind), at)
            at += 120
            break
          case "negate":
            nextPopups.push({ key: `n${f.n}`, id: f.id, negated: true })
            setTimeout(() => sounds?.negate(), at)
            break
          case "destroy":
          case "tribute":
          case "discard":
          case "fuse": {
            const rect = before[f.uid]
            if (rect && f.id) nextGhosts.push({ key: f.n, id: f.id, rect, kind: f.k })
            if (f.k === "destroy") setTimeout(() => sounds?.destroy(), at)
            if (f.k === "tribute") setTimeout(() => sounds?.tribute(), at)
            break
          }
          case "lp":
            nextFloats.push({ key: f.n, seat: f.seat, delta: f.delta })
            setTimeout(() => (f.delta < 0 ? sounds?.damage(-f.delta) : sounds?.heal()), at)
            break
          case "hit":
            setTimeout(() => sounds?.hit(true), at)
            break
          case "turn":
            setBanner({ key: f.n, text: f.seat === me && !watching ? "Your Turn" : `${shown?.names?.[f.seat] || "Opponent"}'s Turn`, mine: f.seat === me })
            setTimeout(() => sounds?.turn(f.seat === me), at)
            break
          case "coin":
            nextPopups.push({ key: `c${f.n}`, coin: f.heads ? "Heads" : "Tails" })
            setTimeout(() => sounds?.coin(), at)
            break
          case "phase":
            setTimeout(() => sounds?.phase(), at)
            break
          default:
        }
      }
      if (Object.keys(flashes).length) {
        setFlash((x) => ({ ...x, ...flashes }))
        setTimeout(() => setFlash((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !(k in flashes)))), 900)
      }
      if (nextGhosts.length) {
        setGhosts((g) => [...g, ...nextGhosts])
        setTimeout(() => setGhosts((g) => g.filter((x) => !nextGhosts.includes(x))), 900)
      }
      if (nextFloats.length) {
        setFloats((g) => [...g, ...nextFloats])
        setTimeout(() => setFloats((g) => g.filter((x) => !nextFloats.includes(x))), 1500)
      }
      if (nextPopups.length) {
        nextPopups.forEach((p, i) => {
          setTimeout(() => setPopups((g) => [...g, p]), i * 450)
          setTimeout(() => setPopups((g) => g.filter((x) => x !== p)), i * 450 + 1300)
        })
      }
    },
    [sounds, me, watching, shown?.names]
  )

  useEffect(() => {
    if (!view) return
    const nd = view.duel
    clearTimeout(commitTimer.current)
    if (!nd || !shown?.duel || nd.seq === lastSeq.current) {
      lastSeq.current = nd?.seq || lastSeq.current
      setShown(view)
      return
    }
    const fresh = nd.fx.filter((f) => f.n > lastSeq.current)
    lastSeq.current = nd.seq
    // where the cards about to vanish are now
    const before = {}
    for (const f of fresh) if (["destroy", "tribute", "discard", "fuse"].includes(f.k)) before[f.uid] = rectIn(elFor(f.uid))
    const attack = fresh.find((f) => f.k === "hit") || fresh.find((f) => f.k === "attack")
    const from = attack && rectIn(elFor(attack.att))
    if (attack && from && !reduced()) {
      const tgtEl = attack.tgt ? elFor(attack.tgt) : rootRef.current?.querySelector(`[data-player="${attack.seat}"]`)
      const to = rectIn(tgtEl)
      if (to) {
        setLunge({ uid: attack.att, dx: (to.x + to.w / 2 - (from.x + from.w / 2)) * (attack.k === "hit" ? 0.8 : 0.35), dy: (to.y + to.h / 2 - (from.y + from.h / 2)) * (attack.k === "hit" ? 0.8 : 0.35), key: attack.n })
        if (fresh.some((f) => f.k === "attack")) sounds?.attack()
        commitTimer.current = setTimeout(() => {
          setLunge(null)
          if (attack.k === "hit") setImpact({ key: attack.n, x: to.x + to.w / 2, y: to.y + to.h / 2 })
          setShown(view)
          playFx(fresh, before)
        }, 360)
        return
      }
    }
    setShown(view)
    playFx(fresh, before)
  }, [view])

  useEffect(() => () => clearTimeout(commitTimer.current), [])
  useEffect(() => {
    if (!impact) return
    const t = setTimeout(() => setImpact(null), 500)
    return () => clearTimeout(t)
  }, [impact])
  useEffect(() => {
    if (!banner) return
    const t = setTimeout(() => setBanner(null), 1300)
    return () => clearTimeout(t)
  }, [banner])

  // a new prompt or turn: drop half-made choices
  const waitKey = wait ? `${wait.kind}:${wait.stamp}:${wait.seat}` : "none"
  useEffect(() => {
    setPicks([])
    setMode(null)
    setSel(null)
  }, [waitKey, d?.turn, d?.phase])

  // ---------- sending moves ----------

  const send = useCallback(
    async (move) => {
      if (busy.current) return
      if (tutorial?.allow && !tutorial.allow(move, d)) {
        setToast(tutorial.nope || "Follow the tutorial's hint for now.")
        sounds?.bad()
        return
      }
      busy.current = true
      setSel(null)
      setMode(null)
      setPicks([])
      sounds?.unlock?.()
      const r = await act(move)
      busy.current = false
      if (r && !r.ok && r.error) {
        setToast(r.error)
        sounds?.bad()
      }
    },
    [act, sounds, tutorial, d]
  )

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(t)
  }, [toast])

  const movesFor = (uid) => legal.filter((m) => m.uid === uid && m.type !== "choose")

  // start a move: tributes, targets and costs are picked on the board first
  const begin = (move) => {
    setSel(null)
    if ((move.type === "summon" || move.type === "set") && move.tributes) {
      setMode({ kind: "tribute", move, need: move.tributes, options: move.options })
      setPicks([])
      return
    }
    if (move.type === "attack") {
      if (move.targets.length === 1 && move.targets[0] === null) return send({ type: "attack", uid: move.uid, target: null })
      setMode({ kind: "attack", uid: move.uid, options: move.targets })
      return
    }
    if (move.type === "activate") {
      if (move.targets && move.max > 0) {
        if (move.targets.length === 1 && move.min === 1) return withTargets(move, [move.targets[0]])
        setMode({ kind: "target", move, options: move.targets, min: move.min, max: move.max })
        setPicks([])
        return
      }
      return withTargets(move, [])
    }
    const { options, tributes, ...rest } = move
    send(move.type === "summon" || move.type === "set" ? { ...rest, tributes: [] } : rest)
  }
  const withTargets = (move, targets) => {
    if (move.cost) {
      if (move.cost.options.length === move.cost.n) return send({ type: "activate", uid: move.uid, ei: move.ei, targets, cost: move.cost.options })
      setMode({ kind: "cost", move, targets, options: move.cost.options, need: move.cost.n })
      setPicks([])
      return
    }
    send({ type: "activate", uid: move.uid, ei: move.ei, targets, cost: [] })
  }

  // a card clicked while picking tributes, targets or a cost
  const pickFor = (uid) => {
    if (!mode) return false
    if (mode.kind === "attack") {
      if (!mode.options.includes(uid)) return false
      send({ type: "attack", uid: mode.uid, target: uid })
      return true
    }
    if (!mode.options.includes(uid)) return false
    const next = picks.includes(uid) ? picks.filter((x) => x !== uid) : [...picks, uid]
    const need = mode.kind === "target" ? mode.max : mode.need
    sounds?.click()
    if (next.length >= need) {
      const chosen = next.slice(0, need)
      if (mode.kind === "tribute") send({ type: mode.move.type, uid: mode.move.uid, tributes: chosen })
      else if (mode.kind === "target") withTargets(mode.move, chosen)
      else if (mode.kind === "cost") send({ type: "activate", uid: mode.move.uid, ei: mode.move.ei, targets: mode.targets, cost: chosen })
      return true
    }
    setPicks(next)
    return true
  }
  const confirmPicks = () => {
    if (mode?.kind === "target" && picks.length >= mode.min) withTargets(mode.move, picks)
  }

  // ---------- clicks, long presses, drags ----------

  const press = useRef(null)
  const onCardDown = (e, uid, id, stats) => {
    if (e.button && e.button !== 0) return
    const start = { x: e.clientX, y: e.clientY, uid, id, t: Date.now(), long: false, pointer: e.pointerType }
    press.current = start
    if (e.pointerType !== "mouse") {
      start.timer = setTimeout(() => {
        start.long = true
        if (id) {
          setZoom({ id, stats })
          navigator.vibrate?.(15)
        }
      }, 450)
    }
  }
  const onCardMove = (e) => {
    const p = press.current
    if (!p) return
    const far = Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10
    if (far) clearTimeout(p.timer)
    if (far && !drag && !p.long && !mode && movesFor(p.uid).some((m) => ["summon", "set", "activate", "attack"].includes(m.type))) {
      setDrag({ uid: p.uid, id: p.id })
    }
  }
  useEffect(() => {
    if (!drag) return
    const move = (e) => setDrag((x) => x && { ...x, x: e.clientX, y: e.clientY })
    const up = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-drop]")
      const target = el?.getAttribute("data-drop")
      const tuid = el?.getAttribute("data-uid")
      const ms = movesFor(drag.uid)
      setDrag(null)
      press.current = null
      if (!target) return
      if (target === "my-m") {
        const m = ms.find((x) => x.type === "summon") || ms.find((x) => x.type === "set" && CARD[drag.id]?.kind === "monster")
        if (m) begin(m)
      } else if (target === "my-s") {
        const m = ms.find((x) => x.type === "activate") || ms.find((x) => x.type === "set")
        if (m) begin(m)
      } else if (target === "their" || target === "their-m") {
        const m = ms.find((x) => x.type === "attack")
        if (m && (tuid ? m.targets.includes(tuid) : m.targets.includes(null))) send({ type: "attack", uid: drag.uid, target: tuid || null })
        else if (m) begin(m)
      }
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up, { once: true })
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
  }, [drag?.uid])

  const onCardClick = (e, uid, id, stats) => {
    const p = press.current
    press.current = null
    if (p?.timer) clearTimeout(p.timer)
    if (p?.long || drag) return
    e.stopPropagation()
    if (mode) {
      if (!pickFor(uid)) {
        setMode(null)
        setPicks([])
      }
      return
    }
    if (id) setInspect({ id, stats })
    const ms = movesFor(uid)
    if (!ms.length || watching) {
      setSel(null)
      return
    }
    sounds?.click()
    setSel(sel?.uid === uid ? null : { uid, rect: rectIn(e.currentTarget) })
  }
  const hover = (id, stats) => (e) => {
    if (e.pointerType === "mouse" && id) setInspect({ id, stats })
  }

  // ---------- the pieces of the table ----------

  const targetable = new Set(mode ? mode.options.filter(Boolean) : [])
  const actable = new Set(watching || mode ? [] : legal.filter((m) => m.uid).map((m) => m.uid))
  const glow = tutorial?.glow || []

  const slotCard = (slot, owner, zone) => {
    if (!slot) return null
    const stats = slot.atk != null ? { atk: slot.atk, def: slot.def } : null
    const known = !!slot.id
    const cls = [
      "mdSlot",
      zone === "m" && slot.pos === "def" ? "is-def" : "",
      !slot.up ? "is-down" : "",
      flash[slot.uid] ? `fx-${flash[slot.uid]}` : "",
      sel?.uid === slot.uid ? "is-sel" : "",
      targetable.has(slot.uid) ? "is-target" : "",
      picks.includes(slot.uid) ? "is-picked" : "",
      actable.has(slot.uid) ? "is-actable" : "",
      lunge?.uid === slot.uid ? "is-lunge" : "",
      d.battle?.att === slot.uid ? "is-attacking" : "",
      d.chain.some((l) => l.uid === slot.uid) ? "is-chained" : "",
      glow.includes(slot.uid) ? "is-glow" : "",
    ]
      .filter(Boolean)
      .join(" ")
    const link = d.chain.findIndex((l) => l.uid === slot.uid)
    return (
      <div
        key={slot.uid}
        className={cls}
        data-uid={slot.uid}
        data-drop={owner === them && zone === "m" ? "their-m" : undefined}
        style={lunge?.uid === slot.uid ? { "--lx": `${lunge.dx}px`, "--ly": `${lunge.dy}px` } : undefined}
        onPointerDown={(e) => onCardDown(e, slot.uid, slot.id, stats)}
        onPointerMove={onCardMove}
        onPointerEnter={hover(slot.id, stats)}
        onClick={(e) => onCardClick(e, slot.uid, slot.id, stats)}
      >
        <div className="mdSlotCard">{slot.up ? <MiniCard id={slot.id} stats={stats} pos={slot.pos} /> : <CardBack />}</div>
        {!slot.up && known && <div className="mdPeek">{CARD[slot.id]?.name}</div>}
        {zone === "m" && slot.up && stats && (
          <div className={`mdSlotStat${slot.pos === "def" ? " is-def" : ""}`}>
            <b className={stats.atk > CARD[slot.id].atk ? "is-up" : stats.atk < CARD[slot.id].atk ? "is-down" : ""}>{stats.atk}</b>
            <span>/</span>
            <i className={stats.def > CARD[slot.id].def ? "is-up" : stats.def < CARD[slot.id].def ? "is-down" : ""}>{stats.def}</i>
          </div>
        )}
        {slot.borrowed && <div className="mdBadge is-borrow">borrowed</div>}
        {link >= 0 && <div className="mdChainNo">{link + 1}</div>}
      </div>
    )
  }

  const zoneCell = (owner, zone, i) => {
    const p = d.players[owner]
    const slot = zone === "m" ? p.m[i] : p.s[i]
    const drop = owner === me ? (zone === "m" ? "my-m" : "my-s") : zone === "m" ? "their-m" : undefined
    return (
      <div key={`${zone}${i}`} className={`mdZone is-${zone}`} data-drop={drop} data-zone={`${owner}-${zone}-${i}`}>
        {slotCard(slot, owner, zone)}
      </div>
    )
  }

  const pileCell = (owner, kind) => {
    const p = d.players[owner]
    const mine = owner === me
    if (kind === "deck")
      return (
        <div key="deck" className="mdZone is-pile is-deck" title={`Deck: ${p.deck} cards`}>
          {p.deck > 0 && <CardBack className={p.deck > 1 ? "is-stack" : ""} />}
          <span className="mdPileCount">{p.deck}</span>
          <span className="mdZoneLabel">Deck</span>
        </div>
      )
    if (kind === "gy") {
      const top = p.gy[p.gy.length - 1]
      return (
        <button key="gy" type="button" className="mdZone is-pile is-gy" onClick={() => setPile({ title: `${mine && !watching ? "Your" : `${shown.names[owner]}'s`} Graveyard`, cards: [...p.gy].reverse() })} onPointerEnter={hover(top?.id)} data-gy={owner}>
          {top && <MiniCard id={top.id} />}
          <span className="mdPileCount">{p.gy.length}</span>
          <span className="mdZoneLabel">GY</span>
        </button>
      )
    }
    if (kind === "extra") {
      const n = Array.isArray(p.extra) ? p.extra.length : p.extra
      return (
        <button key="extra" type="button" className="mdZone is-pile is-extra" onClick={() => Array.isArray(p.extra) && setPile({ title: "Your Extra Deck", cards: p.extra })} title="Extra Deck (Fusion Monsters)">
          {n > 0 && <CardBack />}
          <span className="mdPileCount">{n}</span>
          <span className="mdZoneLabel">Extra</span>
        </button>
      )
    }
    // the Field Spell zone
    return (
      <div key="field" className="mdZone is-pile is-field" data-drop={owner === me ? "my-s" : undefined}>
        {p.f ? slotCard(p.f, owner, "f") : <span className="mdZoneLabel">Field</span>}
      </div>
    )
  }

  const rows = (owner) => {
    const flipped = owner !== me
    const idx = flipped ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4]
    const mRow = [pileCell(owner, "field"), ...idx.map((i) => zoneCell(owner, "m", i)), pileCell(owner, "gy")]
    const sRow = [pileCell(owner, "extra"), ...idx.map((i) => zoneCell(owner, "s", i)), pileCell(owner, "deck")]
    const order = flipped ? [sRow.reverse(), mRow.reverse()] : [mRow, sRow]
    return (
      <div className={`mdSide is-${flipped ? "them" : "me"}`}>
        {order.map((r, i) => (
          <div key={i} className="mdRow">
            {r}
          </div>
        ))}
      </div>
    )
  }

  const playerInfo = (owner) => {
    const p = d.players[owner]
    const lpPct = Math.max(0, Math.min(1, p.lp / (d.startLp || 8000)))
    const active = d.active === owner
    return (
      <div className={`mdPlayer is-${owner === me ? "me" : "them"}${active ? " is-active" : ""}`} data-player={owner} data-drop={owner === them ? "their" : undefined}>
        <div className="mdPlayerName">
          <span className="mdDot" />
          {shown.names[owner]}
          {owner === me && !watching && shown.names[owner] !== "You" ? " (you)" : ""}
        </div>
        <div className="mdLp">
          <span className="mdLpLabel">LP</span>
          <AnimatedNumber value={p.lp} className="mdLpNum" />
        </div>
        <div className="mdLpBar">
          <i style={{ width: `${lpPct * 100}%` }} className={lpPct < 0.25 ? "is-low" : ""} />
        </div>
        <div className="mdPlayerMeta">
          <span>
            Hand {Array.isArray(p.hand) ? p.hand.length : p.hand} · Deck {p.deck}
          </span>
          {!d.over && owner !== me && (wait ? wait.seat === owner : d.active === owner) && (
            <span className="mdThinking" title={wait ? (wait.kind === "respond" ? "Deciding whether to respond" : "Choosing") : "Playing"}>
              {wait ? (wait.kind === "respond" ? "deciding" : "choosing") : "playing"}
              <i />
              <i />
              <i />
            </span>
          )}
        </div>
        {floats
          .filter((f) => f.seat === owner)
          .map((f) => (
            <span key={f.key} className={`mdFloat ${f.delta < 0 ? "is-hurt" : "is-heal"}`}>
              {f.delta > 0 ? "+" : ""}
              {f.delta}
            </span>
          ))}
        {mode?.kind === "attack" && owner === them && mode.options.includes(null) && (
          <button type="button" className="mdDirect" onClick={() => send({ type: "attack", uid: mode.uid, target: null })}>
            Attack directly!
          </button>
        )}
      </div>
    )
  }

  const hand = () => {
    const cards = Array.isArray(d.players[me].hand) ? d.players[me].hand : []
    const n = cards.length
    return (
      <div className={`mdHand${n > 6 ? " is-crowded" : ""}`} style={{ "--n": n }}>
        {cards.map((c, i) => {
          const ms = movesFor(c.uid)
          const cls = ["mdHandCard", ms.length && !watching ? "is-actable" : "", sel?.uid === c.uid ? "is-sel" : "", targetable.has(c.uid) ? "is-target" : "", picks.includes(c.uid) ? "is-picked" : "", flash[c.uid] === "draw" ? "fx-draw" : "", drag?.uid === c.uid ? "is-dragging" : "", glow.includes(c.uid) ? "is-glow" : ""].filter(Boolean).join(" ")
          return (
            <div
              key={c.uid}
              className={cls}
              data-uid={c.uid}
              data-hand={i}
              style={{ "--i": i }}
              onPointerDown={(e) => onCardDown(e, c.uid, c.id)}
              onPointerMove={onCardMove}
              onPointerEnter={hover(c.id)}
              onClick={(e) => onCardClick(e, c.uid, c.id)}
            >
              <MiniCard id={c.id} />
            </div>
          )
        })}
        {!n && <div className="mdHandEmpty">{watching ? "" : "No cards in hand"}</div>}
      </div>
    )
  }

  const oppHand = () => {
    const n = typeof d.players[them].hand === "number" ? d.players[them].hand : d.players[them].hand.length
    return (
      <div className="mdOppHand">
        {Array.from({ length: n }, (_, i) => (
          <CardBack key={i} />
        ))}
      </div>
    )
  }

  // ---------- the phase bar ----------

  const phaseMove = (to) => legal.find((m) => m.type === "phase" && m.to === to)
  const phaseBar = () => (
    <div className="mdPhaseBar">
      <div className="mdTurn">
        Turn {d.turn}
        <span className={`mdWhose ${myTurn && !watching ? "is-me" : "is-them"}`}>{watching ? shown.names[d.active] : myTurn ? "Your turn" : `${shown.names[d.active]}'s turn`}</span>
        {shown.turnEnds && <Countdown until={shown.turnEnds} serverNow={serverNow} />}
      </div>
      <div className="mdPhases" role="list">
        {PHASES.map((ph) => {
          const m = phaseMove(ph)
          return (
            <button key={ph} type="button" role="listitem" className={`mdPhase${d.phase === ph ? " is-on" : ""}${m ? " is-go" : ""}`} disabled={!m} title={LONG[ph]} onClick={() => m && send(m)} data-phase={ph}>
              {SHORT[ph]}
            </button>
          )
        })}
      </div>
      <div className="mdPhaseGo">
        {phaseMove("battle") && (
          <button type="button" className="mdGo is-battle" onClick={() => send(phaseMove("battle"))} data-go="battle">
            Battle!
          </button>
        )}
        {phaseMove("main2") && (
          <button type="button" className="mdGo" onClick={() => send(phaseMove("main2"))} data-go="main2">
            Main 2
          </button>
        )}
        {phaseMove("end") && (
          <button type="button" className="mdGo is-end" onClick={() => send(phaseMove("end"))} data-go="end">
            End Turn
          </button>
        )}
      </div>
    </div>
  )

  // ---------- prompts and banners ----------

  const promptBox = () => {
    if (!myWait || wait.kind === "respond") return null
    const options = wait.options || []
    const need = wait.max
    const ok = picks.length >= wait.min && picks.length <= wait.max
    const zoneName = { deck: "Deck", gy: "Graveyard", hand: "Hand", extra: "Extra Deck", m: "Field", s: "Field", f: "Field" }
    return (
      <div className="mdPicker" role="dialog" aria-label={wait.title || "Choose"}>
        <div className="mdPickerBox mdWin">
          <div className="title-bar">
            <div className="title-bar-text">{wait.title || "Choose"}</div>
          </div>
          <div className="mdPickerBody">
            <p className="mdPickerHint">{need === 1 ? "Pick one." : wait.min === wait.max ? `Pick ${need}.` : `Pick ${wait.min} to ${wait.max}.`}</p>
            <div className="mdPickerCards">
              {options.map((o) => {
                const on = picks.includes(o.uid)
                return (
                  <button
                    key={o.uid}
                    type="button"
                    className={`mdPickCard${on ? " is-on" : ""}`}
                    data-pick={o.uid}
                    onPointerEnter={hover(o.id)}
                    onClick={() => {
                      sounds?.click()
                      if (o.id) setInspect({ id: o.id })
                      if (need === 1 && wait.min === 1) return send({ type: "choose", picks: [o.uid] })
                      setPicks((x) => (x.includes(o.uid) ? x.filter((u) => u !== o.uid) : x.length < need ? [...x, o.uid] : x))
                    }}
                  >
                    {o.id ? <MiniCard id={o.id} /> : <CardBack />}
                    <span>{o.id ? CARD[o.id]?.name : "Set card"}</span>
                    <small>{zoneName[o.zone] || ""}</small>
                  </button>
                )
              })}
            </div>
            {!(need === 1 && wait.min === 1) && (
              <div className="mdPickerBtns">
                <button type="button" disabled={!ok} onClick={() => send({ type: "choose", picks })} data-confirm>
                  OK ({picks.length}/{need})
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // targets that aren't on the field (a graveyard): pick them from a list
  const offBoardTargets = mode && (mode.kind === "target" || mode.kind === "cost") ? mode.options.filter((u) => !slotOf(d, u) && !(mode.kind === "cost")) : []

  const respondBanner = () => {
    if (!myWait || wait.kind !== "respond") return null
    const top = d.chain[d.chain.length - 1]
    const who = shown.names[them]
    let text = `${who} ${REASONS[wait.reason] || "did something"}.`
    if (wait.reason === "chain" && top) text = top.seat === me ? `Chain link ${d.chain.length}: your ${CARD[top.id]?.name}.` : `${who} activated ${CARD[top.id]?.name}!`
    if (wait.reason === "attack" && d.battle) {
      const att = idOf(d, d.battle.att)
      const tgt = d.battle.tgt ? idOf(d, d.battle.tgt) : null
      text = `${CARD[att]?.name || "A monster"} attacks ${d.battle.tgt ? (tgt ? CARD[tgt]?.name : "your face-down monster") : "you directly"}!`
    }
    if (wait.reason === "summon") text = `${who} summoned a monster.`
    const can = legal.some((m) => m.type === "activate")
    return (
      <div className="mdBanner" role="alert">
        <div className="mdBannerText">
          <b>{text}</b>
          <span>{can ? "Respond with a glowing card, or pass." : "You have nothing to respond with."}</span>
        </div>
        {shown.waitEnds && <Countdown until={shown.waitEnds} serverNow={serverNow} />}
        <button type="button" className="mdPass" onClick={() => send({ type: "pass" })} data-pass>
          {can ? "Pass" : "OK"}
        </button>
      </div>
    )
  }

  const status = () => {
    if (watching || !d || d.over) return null
    if (mode) {
      const text =
        mode.kind === "tribute"
          ? `Choose ${mode.need - picks.length} monster${mode.need - picks.length > 1 ? "s" : ""} to tribute.`
          : mode.kind === "attack"
            ? mode.options.includes(null)
              ? "Choose a monster to attack, or attack directly."
              : "Choose a monster to attack."
            : mode.kind === "cost"
              ? `Choose ${mode.need} card${mode.need > 1 ? "s" : ""} to discard.`
              : `Choose ${mode.max === 1 ? "a target" : `up to ${mode.max} targets`}.`
      return (
        <div className="mdStatus is-pick">
          {text}
          {mode.kind === "target" && mode.max > 1 && picks.length >= mode.min && (
            <button type="button" onClick={confirmPicks}>
              Done
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setMode(null)
              setPicks([])
            }}
          >
            Cancel
          </button>
        </div>
      )
    }
    return null
  }

  // the action menu next to the selected card
  const actionMenu = () => {
    if (!sel || mode) return null
    const ms = movesFor(sel.uid)
    if (!ms.length) return null
    const r = sel.rect || { x: 100, y: 100, w: 60, h: 80 }
    const root = rootRef.current
    const W = root?.clientWidth || 800
    const H = root?.clientHeight || 600
    const left = Math.min(W - 150, Math.max(4, r.x + r.w / 2 - 70))
    const above = r.y > H * 0.45
    const style = above ? { left, bottom: H - r.y + 6 } : { left, top: r.y + r.h + 6 }
    return (
      <div className="mdMenu mdWin" style={style} role="menu" onClick={(e) => e.stopPropagation()}>
        {ms.map((m, i) => (
          <button key={i} type="button" role="menuitem" onClick={() => begin(m)} data-move={m.type}>
            {moveLabel(m, d)}
          </button>
        ))}
        {mobile && idOf(d, sel.uid) && (
          <button type="button" role="menuitem" onClick={() => setZoom({ id: idOf(d, sel.uid) })}>
            View card
          </button>
        )}
      </div>
    )
  }

  // the line from an attacker (or the card choosing targets) to the pointer
  const arrow = () => {
    let fromUid = null
    let toPt = null
    if (mode?.kind === "attack") fromUid = mode.uid
    else if (mode?.kind === "target") fromUid = mode.move.uid
    else if (d?.battle) {
      fromUid = d.battle.att
      const t = d.battle.tgt ? elFor(d.battle.tgt) : rootRef.current?.querySelector(`[data-player="${1 - d.battle.seat}"]`)
      const tr = rectIn(t)
      if (tr) toPt = { x: tr.x + tr.w / 2, y: tr.y + tr.h / 2 }
    }
    if (!fromUid) return null
    const fr = rectIn(elFor(fromUid))
    if (!fr) return null
    if (!toPt && pointer) toPt = pointer
    if (!toPt) return null
    const a = { x: fr.x + fr.w / 2, y: fr.y + fr.h / 2 }
    const mx = (a.x + toPt.x) / 2
    const my = Math.min(a.y, toPt.y) - 30
    return (
      <svg className={`mdArrow${d?.battle && !mode ? " is-battle" : ""}`} aria-hidden="true">
        <defs>
          <marker id="mdArrowHead" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 Z" fill="currentColor" />
          </marker>
        </defs>
        <path d={`M${a.x},${a.y} Q${mx},${my} ${toPt.x},${toPt.y}`} markerEnd="url(#mdArrowHead)" />
      </svg>
    )
  }

  const chainStack = () =>
    d.chain.length > 0 && (
      <div className="mdChain" aria-label="Chain">
        {d.chain.map((l, i) => (
          <div key={i} className={`mdChainLink${l.negated ? " is-negated" : ""}${l.seat === me ? " is-me" : " is-them"}`}>
            <span>{i + 1}</span>
            {CARD[l.id]?.name}
          </div>
        ))}
      </div>
    )

  const inspector = (big = false) => {
    const id = inspect?.id
    return (
      <div className="mdInspector">
        {id ? (
          <Card id={id} stats={inspect.stats} />
        ) : (
          <div className="mdInspectorEmpty">
            <CardBack />
            <p>{big ? "Point at a card to read it." : ""}</p>
          </div>
        )}
      </div>
    )
  }

  const logBox = () => (
    <div className="mdLog" aria-label="Duel log">
      <LogList log={d.log} />
    </div>
  )

  if (!d) return <div className="mdDuel" ref={rootRef} />

  const tableClass = `mdDuel is-${layout}${mobile ? " is-mobile" : ""}${mode ? ` is-mode-${mode.kind}` : ""}${drag ? " is-dragging" : ""}`
  const handCount = Array.isArray(d.players[me].hand) ? d.players[me].hand.length : 0
  // hand cards: big on a phone held upright, a column on its side
  const handW = layout === "tall" ? Math.min(s * 1.35, (w - 20) / Math.max(5.5, handCount)) : layout === "flat" ? s * 0.92 : s * 0.9
  return (
    <div
      className={tableClass}
      ref={rootRef}
      style={{ "--s": `${s}px`, "--zh": `${zh}px`, "--card": `${Math.floor(cardW)}px`, "--def": defScale, "--hand": `${Math.floor(handW)}px` }}
      onPointerMove={(e) => {
        if (!mode) return
        const root = rootRef.current.getBoundingClientRect()
        setPointer({ x: e.clientX - root.left, y: e.clientY - root.top })
      }}
      onClick={() => {
        setSel(null)
      }}
      onContextMenu={(e) => e.preventDefault()}
      data-phase={d.phase}
      data-turn={d.turn}
      data-active={d.active === me ? "me" : "them"}
    >
      {layout === "wide" && (
        <aside className="mdPanel">
          {inspector(true)}
          {logBox()}
          {!watching && onRespond && (
            <label className="mdRespondPref">
              Ask me to respond:
              <select value={respond} onChange={(e) => onRespond(e.target.value)} data-pref>
                <option value="always">Always</option>
                <option value="auto">Only when I can</option>
                <option value="never">Never</option>
              </select>
            </label>
          )}
        </aside>
      )}
      <div className="mdTable">
        <div className="mdTop">
          {playerInfo(them)}
          {oppHand()}
        </div>
        <div className="mdField">
          {rows(them)}
          {phaseBar()}
          {rows(me)}
          {chainStack()}
          {status()}
        </div>
        <div className="mdBottom">
          {playerInfo(me)}
          {hand()}
          {layout !== "wide" && (
            <button type="button" className="mdLogBtn" onClick={() => setShowLog((x) => !x)} title="Duel log" data-log>
              Log
            </button>
          )}
        </div>
        {respondBanner()}
      </div>

      {actionMenu()}
      {arrow()}
      {offBoardTargets.length > 0 && (
        <div className="mdPicker">
          <div className="mdPickerBox mdWin">
            <div className="title-bar">
              <div className="title-bar-text">Choose a target</div>
            </div>
            <div className="mdPickerBody">
              <div className="mdPickerCards">
                {offBoardTargets.map((u) => (
                  <button key={u} type="button" className={`mdPickCard${picks.includes(u) ? " is-on" : ""}`} onClick={() => pickFor(u)} data-pick={u}>
                    <MiniCard id={idOf(d, u)} />
                    <span>{CARD[idOf(d, u)]?.name}</span>
                  </button>
                ))}
              </div>
              <div className="mdPickerBtns">
                <button type="button" onClick={() => setMode(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {mode?.kind === "cost" && (
        <div className="mdCostHint">Discard: tap {mode.need} card{mode.need > 1 ? "s" : ""} in your hand.</div>
      )}
      {promptBox()}

      {pile && (
        <div className="mdPicker" onClick={() => setPile(null)}>
          <div className="mdPickerBox mdWin" onClick={(e) => e.stopPropagation()}>
            <div className="title-bar">
              <div className="title-bar-text">{pile.title}</div>
              <div className="title-bar-controls">
                <button type="button" aria-label="Close" onClick={() => setPile(null)} />
              </div>
            </div>
            <div className="mdPickerBody">
              <div className="mdPickerCards">
                {pile.cards.length ? (
                  pile.cards.map((c) => (
                    <button key={c.uid} type="button" className="mdPickCard" onPointerEnter={hover(c.id)} onClick={() => (mobile ? setZoom({ id: c.id }) : setInspect({ id: c.id }))}>
                      <MiniCard id={c.id} />
                      <span>{CARD[c.id]?.name}</span>
                    </button>
                  ))
                ) : (
                  <p className="mdMuted">Empty.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {(showLog || (layout !== "wide" && false)) && (
        <div className="mdLogPop mdWin">
          <div className="title-bar">
            <div className="title-bar-text">Duel Log</div>
            <div className="title-bar-controls">
              <button type="button" aria-label="Close" onClick={() => setShowLog(false)} />
            </div>
          </div>
          {logBox()}
        </div>
      )}
      {layout !== "wide" && !mobile && inspect && !zoom && <div className="mdHoverCard">{inspector()}</div>}
      {zoom && (
        <div className="mdZoom" onClick={() => setZoom(null)} role="dialog" aria-label="Card">
          <Card id={zoom.id} stats={zoom.stats} />
          <p>Tap anywhere to close</p>
        </div>
      )}

      <div className="mdFx" aria-hidden="true">
        {ghosts.map((g) => (
          <div key={g.key} className={`mdGhost is-${g.kind}`} style={{ left: g.rect.x, top: g.rect.y, width: g.rect.w, height: g.rect.h }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className={`mdShard s${i}`}>
                <MiniCard id={g.id} />
              </div>
            ))}
          </div>
        ))}
        {impact && <div key={impact.key} className="mdImpact" style={{ left: impact.x, top: impact.y }} />}
        {popups.map((p) =>
          p.coin ? (
            <div key={p.key} className="mdPopup is-coin">
              <div className="mdCoin">{p.coin === "Heads" ? "★" : "☾"}</div>
              <b>{p.coin}!</b>
            </div>
          ) : (
            <div key={p.key} className={`mdPopup${p.negated ? " is-negated" : ""}${p.seat === me ? " is-me" : " is-them"}`}>
              <Card id={p.id} foil={false} />
              {p.negated && <b className="mdStamp">NEGATED</b>}
              {p.link > 1 && !p.negated && <b className="mdLinkNo">Chain {p.link}</b>}
            </div>
          )
        )}
        {banner && (
          <div key={banner.key} className={`mdTurnBanner${banner.mine ? " is-me" : ""}`}>
            {banner.text}
          </div>
        )}
      </div>
      {drag && drag.x != null && (
        <div className="mdDragGhost" style={{ left: drag.x - (rootRef.current?.getBoundingClientRect().left || 0), top: drag.y - (rootRef.current?.getBoundingClientRect().top || 0) }}>
          <MiniCard id={drag.id} />
        </div>
      )}
      {toast && <div className="mdToast">{toast}</div>}
      {tutorial?.text && (
        <div className={`mdCoach${tutorial.where ? ` is-${tutorial.where}` : ""}`} role="status">
          <div className="mdCoachFace">?</div>
          <div className="mdCoachText">
            {tutorial.title && <b>{tutorial.title}</b>}
            <p>{tutorial.text}</p>
            {tutorial.next && (
              <button type="button" onClick={tutorial.next} data-coach-next>
                {tutorial.nextLabel || "Next"}
              </button>
            )}
          </div>
        </div>
      )}
      {overlay}
    </div>
  )
}

// local duels call you "You": "You takes 500 damage" -> "You take 500 damage"
const IRREGULAR = { goes: "go", has: "have", is: "are" }
export const youify = (t) =>
  /^You /.test(t)
    ? t
        .replace(/^You (Normal |Tribute |Special |Flip |Fusion )?(\w+)/, (_, kind = "", verb) => `You ${kind}${IRREGULAR[verb] || (/(ss|sh|ch|x)es$/.test(verb) ? verb.slice(0, -2) : verb.replace(/s$/, ""))}`)
        .replace(/ their (hand|Deck)/g, " your $1")
    : t

const LogList = ({ log }) => {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log.length, log[log.length - 1]?.n])
  return (
    <div className="mdLogList" ref={ref}>
      {log.map((l) => (
        <div key={l.n} className={/^Turn \d+/.test(l.t) ? "is-turn" : /wins|draw!/.test(l.t) ? "is-win" : ""}>
          {youify(l.t)}
        </div>
      ))}
    </div>
  )
}

export default Board
