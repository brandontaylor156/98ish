import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import Card, { Pinwheel } from "./Card"
import Avatar from "./Avatar"
import { COLORS, COLOR_NAMES, EMOTES, PERSONAS, VALUE_NAMES, cardName, describeRules, handPoints, isWild } from "./cards"
import { isKeyForWindow } from "../../../utils/windowKeys"

// The card table, for games against the computer (local.js) and online games alike: the
// other players around the top (or in a strip on small screens) with their card counts,
// avatars, turn clock and speech bubbles; the draw pile, the discards and the direction
// ring in the middle; your hand fanned along the bottom. Every change arrives as a new view
// from the rules; its events (plays, draws, skips...) become the animations and sounds.

const COLOR_ORDER = { r: 0, y: 1, g: 2, b: 3, w: 4 }
const VALUE_ORDER = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "skipall", "rev", "d2", "discall", "wild", "wd4", "wd6"]
const FLIGHT_MS = 330
const HEX = { r: "#e2412f", y: "#f4c21b", g: "#2f9e4a", b: "#2667d1", w: "#333" }

export const sortHand = (hand, by = "color") =>
  [...hand].sort((a, b) =>
    by === "value"
      ? VALUE_ORDER.indexOf(a.v) - VALUE_ORDER.indexOf(b.v) || COLOR_ORDER[a.c] - COLOR_ORDER[b.c] || a.id - b.id
      : COLOR_ORDER[a.c] - COLOR_ORDER[b.c] || VALUE_ORDER.indexOf(a.v) - VALUE_ORDER.indexOf(b.v) || a.id - b.id
  )

const useNow = (ms = 250) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

const useSize = (ref) => {
  const [size, setSize] = useState({ w: 800, h: 560 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return size
}

const spin = (id) => ((id * 47) % 21) - 10 // a fixed small tilt for each card on the pile

// The turn clock around an avatar
const Ring = ({ ends, total, serverNow, turnId, size }) => {
  // where the clock stood when this turn was first drawn (the CSS animation runs it down)
  const start = useMemo(() => (ends ? Math.max(0, ends - serverNow()) : 0), [turnId, ends])
  if (!ends || !total) return <span className="lcRing is-idle" aria-hidden="true" />
  const left = Math.max(0, ends - serverNow())
  const r = 46
  const c = 2 * Math.PI * r
  return (
    <svg key={turnId} className={`lcRing${left < 5000 ? " is-low" : ""}`} viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <circle cx="50" cy="50" r={r} className="lcRingBack" />
      <circle cx="50" cy="50" r={r} className="lcRingFront" style={{ strokeDasharray: c, strokeDashoffset: 0, animationDuration: `${total}ms`, animationDelay: `${start - total}ms`, "--c": c }} />
    </svg>
  )
}

// One of the other players
const Seat = ({ seat, view, meta, style, serverNow, bubble, stamp, now, onCatch, compact, crowd, targetable, onTarget }) => {
  const count = view.counts[seat]
  const turn = view.turn === seat && view.phase === "play"
  const persona = view.bots[seat] || meta?.bot ? PERSONAS[view.personas[seat]] : null
  const vuln = view.vuln && view.vuln.seat === seat && view.vuln.until > serverNow()
  const name = meta?.name || view.names[seat]
  const backs = Math.min(count, compact ? 4 : 7)
  const Tag = targetable ? "button" : "div"
  return (
    <Tag
      type={targetable ? "button" : undefined}
      className={`lcSeat${turn ? " is-turn" : ""}${count === 1 ? " is-one" : ""}${meta?.away ? " is-away" : ""}${targetable ? " is-target" : ""}`}
      data-seat={seat}
      style={style}
      onClick={targetable ? () => onTarget(seat) : undefined}
    >
      <span className="lcSeatAvatar">
        <Avatar name={name} bot={!!(view.bots[seat] || meta?.bot)} size={compact ? 30 : crowd ? 32 : 40} />
        {turn && <Ring ends={view.turnEnds} total={view.turnMs} serverNow={serverNow} turnId={view.turnId} size={compact ? 42 : crowd ? 46 : 54} />}
        {view.dealer === seat && <span className="lcDealer" title="Dealer">D</span>}
      </span>
      <span className="lcSeatInfo">
        <b className="lcSeatName">{name}</b>
        <small>{meta?.away ? "connection lost..." : persona ? persona.label : view.target ? `${view.scores[seat]} pts` : " "}</small>
      </span>
      <span className="lcSeatCards" data-count={count}>
        <span className="lcMiniFan" aria-hidden="true">
          {Array.from({ length: backs }, (_, i) => (
            <span key={i} className="lcMiniBack" style={{ "--i": i - (backs - 1) / 2 }} />
          ))}
        </span>
        <span className="lcCount" aria-label={`${count} cards`}>
          {count}
        </span>
      </span>
      {view.target > 0 && persona && !compact && <span className="lcSeatScore">{view.scores[seat]} pts</span>}
      {count === 1 && view.called[seat] && <span className="lcFlag">LAST CARD!</span>}
      {vuln && (
        <span
          role="button"
          tabIndex={0}
          className="lcCatchMini"
          onClick={(e) => {
            e.stopPropagation()
            onCatch()
          }}
        >
          Catch!
        </span>
      )}
      {bubble && bubble.until > now && (
        <span key={bubble.key} className={`lcBubble${bubble.kind ? ` is-${bubble.kind}` : ""}`}>
          {bubble.text}
        </span>
      )}
      {stamp && stamp.until > now && (
        <span key={stamp.key} className={`lcStamp is-${stamp.kind}`}>
          {stamp.text}
        </span>
      )}
    </Tag>
  )
}

// Where the other players sit: around the top of an oval, starting at your left
const arcPositions = (n) => {
  const out = []
  // a big table wraps a little way down both sides
  const extra = n > 6 ? 0.28 : 0
  for (let k = 1; k < n; k++) {
    const t = Math.PI - extra + (k / n) * (Math.PI + 2 * extra)
    out.push({ left: `clamp(62px, ${50 + 44 * Math.cos(t)}%, calc(100% - 62px))`, top: `max(64px, ${58 + 50 * Math.sin(t)}%)` })
  }
  return out
}

const ColorPicker = ({ onPick, onCancel, card }) => {
  const ref = useRef(null)
  useEffect(() => {
    const key = (e) => {
      if (!isKeyForWindow(ref.current, e)) return
      const k = e.key.toLowerCase()
      const map = { 1: "r", r: "r", 2: "y", y: "y", 3: "g", g: "g", 4: "b", b: "b" }
      if (map[k]) onPick(map[k])
      if (k === "escape") onCancel()
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [onPick, onCancel])
  return (
    <div className="lcOverlay" ref={ref} onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="lcPicker window" role="dialog" aria-label="Pick a color">
        <div className="title-bar">
          <div className="title-bar-text">{VALUE_NAMES[card.v]}: pick a color</div>
        </div>
        <div className="lcPickerGrid">
          {COLORS.map((c, i) => (
            <button key={c} type="button" className={`lcPickColor is-${c}`} data-color={c} onClick={() => onPick(c)}>
              <span>{COLOR_NAMES[c]}</span>
              <small>{i + 1}</small>
            </button>
          ))}
          <span className="lcPickerHub" aria-hidden="true">
            <Pinwheel />
          </span>
        </div>
        <div className="lcRowBtns">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

const TargetPicker = ({ view, names, onPick, onCancel }) => (
  <div className="lcOverlay" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
    <div className="lcPicker window" role="dialog" aria-label="Swap hands with">
      <div className="title-bar">
        <div className="title-bar-text">Seven: swap hands with...</div>
      </div>
      <div className="lcTargets">
        {view.counts.map((n, i) =>
          i === view.you ? null : (
            <button key={i} type="button" className="lcTarget" data-target={i} onClick={() => onPick(i)}>
              <Avatar name={names[i]} bot={view.bots[i]} size={28} />
              <b>{names[i]}</b>
              <span className="lcCount">{n}</span>
            </button>
          )
        )}
      </div>
      <div className="lcRowBtns">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  </div>
)

const EmotePicker = ({ onPick, onClose }) => (
  <div className="lcEmotes window" role="menu">
    {Object.entries(EMOTES).map(([id, text]) => (
      <button key={id} type="button" role="menuitem" data-emote={id} onClick={() => onPick(id)}>
        {text}
      </button>
    ))}
    <button type="button" className="lcEmotesClose" onClick={onClose} aria-label="Close">
      ×
    </button>
  </div>
)

// Between rounds: who went out, what everyone was left holding, the scores
const RoundPanel = ({ view, names, serverNow, onReady, now }) => {
  const r = view.roundResult
  if (!r) return null
  const over = view.phase === "over"
  const left = view.nextAt ? Math.max(0, Math.ceil((view.nextAt - serverNow()) / 1000)) : null
  const youWon = r.winner === view.you
  const order = view.counts.map((_, i) => i).sort((a, b) => view.scores[b] - view.scores[a])
  void now
  return (
    <div className="lcRoundPanel window" role="status" data-round-over={r.round}>
      <div className="title-bar">
        <div className="title-bar-text">{over ? "Game over" : `Round ${r.round} results`}</div>
      </div>
      <div className="lcRoundBody">
        <h3 className={youWon ? "is-you" : ""}>
          {over ? (view.over.winners.includes(view.you) ? "You win the game!" : `${names[view.over.winners[0]]} wins the game!`) : youWon ? "You went out!" : `${names[r.winner]} went out!`}
        </h3>
        <p className="lcMuted">
          {youWon ? "You" : names[r.winner]} scored <b>{r.points}</b> points from everyone's leftover cards.
        </p>
        <ul className="lcScores">
          {order.map((i) => (
            <li key={i} className={i === r.winner ? "is-winner" : ""}>
              <span className="lcScoreName">
                <Avatar name={names[i]} bot={view.bots[i]} size={20} />
                {names[i]}
                {i === view.you && names[i] !== "You" && " (you)"}
              </span>
              <span className="lcLeftovers">
                {r.hands[i].slice(0, 12).map((c) => (
                  <Card key={c.id} card={c} className="is-tiny" />
                ))}
                {r.hands[i].length > 12 && <small>+{r.hands[i].length - 12}</small>}
                {i !== r.winner && <small className="lcMuted">{handPoints(r.hands[i])}</small>}
              </span>
              <b className="lcTotal">{view.scores[i]}</b>
              {view.target > 0 && (
                <span className="lcBar" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, (view.scores[i] / view.target) * 100)}%` }} />
                </span>
              )}
            </li>
          ))}
        </ul>
        {!over && (
          <div className="lcRowBtns">
            {view.you !== null && (
              <button type="button" className="lcPrimary" disabled={view.ready.includes(view.you)} onClick={onReady} data-ready>
                {view.ready.includes(view.you) ? "Waiting for the others..." : "Next Round"}
              </button>
            )}
            {left !== null && <span className="lcMuted">Next round in {left}s · first to {view.target}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

const Table = ({ view, seats = [], act, serverNow = () => Date.now(), sounds, mobile = false, footer = null, sort = "color", onEvent }) => {
  const rootRef = useRef(null)
  const handRef = useRef(null)
  const stripRef = useRef(null)
  const size = useSize(rootRef)
  const now = useNow(250)
  const [picker, setPicker] = useState(null) // { card, step: "color" | "target", color }
  const [armed, setArmed] = useState(false)
  const [flights, setFlights] = useState([])
  const [bubbles, setBubbles] = useState({}) // seat -> { text, until, key, kind }
  const [stamps, setStamps] = useState({})
  const [banner, setBanner] = useState(null)
  const [newIds, setNewIds] = useState(() => new Set())
  const [deal, setDeal] = useState(null)
  const [toast, setToast] = useState(null)
  const [emotes, setEmotes] = useState(false)
  const [ringSpin, setRingSpin] = useState(0)
  const [burst, setBurst] = useState(null)
  const [shake, setShake] = useState(null)
  const [busy, setBusy] = useState(false)
  const lastSeq = useRef(null)
  const timers = useRef([])
  const playFrom = useRef(null)
  const dragging = useRef(null)

  const n = view.n
  const you = view.you
  const names = useMemo(() => view.names.map((name, i) => seats[i]?.name || name), [view.names, seats])
  const compact = mobile || size.w < 600 || size.h < 440
  const short = size.h < 440
  const hand = useMemo(() => (view.hand ? sortHand(view.hand, sort) : []), [view.hand, sort])
  const playable = useMemo(() => new Set(view.playable), [view.playable])
  const myTurn = view.phase === "play" && view.turn === you
  const vulnMe = view.vuln && view.vuln.seat === you && view.vuln.until > serverNow()
  const vulnOther = view.vuln && view.vuln.seat !== you && you !== null && view.vuln.until > serverNow() ? view.vuln.seat : null

  // sizes from the space we have
  const handCw = Math.round(Math.max(50, Math.min(short ? 62 : 92, size.w / (compact ? (short ? 5 : 4.2) : 9), size.h / (short ? 4.4 : 6.2))))
  const pileCw = Math.round(Math.max(46, Math.min(short ? 58 : 96, size.w / (compact && !short ? 4.4 : 7.5), size.h / (short ? 5.4 : 6))))

  const later = (ms, fn) => timers.current.push(setTimeout(fn, ms))
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  // ---------- animations ----------

  const rectOf = (el) => {
    const root = rootRef.current?.getBoundingClientRect()
    const r = el?.getBoundingClientRect()
    if (!root || !r) return null
    return { x: r.left - root.left + r.width / 2, y: r.top - root.top + r.height / 2, w: r.width }
  }
  const q = (sel) => rootRef.current?.querySelector(sel)
  const seatEl = (seat) => (seat === you ? q("[data-me-hand]") : q(`[data-seat="${seat}"] .lcSeatCards`) || q(`[data-seat="${seat}"]`))

  const fly = (from, to, card, { delay = 0, dur = FLIGHT_MS, fade = false, endScale = 1, rot = 0 } = {}) => {
    if (!from || !to) return
    const id = Math.random().toString(36).slice(2)
    const w = pileCw
    setFlights((f) => [...f, { id, card, x: to.x, y: to.y, w, dx: from.x - to.x, dy: from.y - to.y, s0: Math.max(0.3, from.w / w), s1: endScale, delay, dur, fade, rot }])
    later(delay + dur + 120, () => setFlights((f) => f.filter((x) => x.id !== id)))
  }

  const say = (seat, text, kind, ms = 2400) => {
    const key = Math.random()
    setBubbles((b) => ({ ...b, [seat]: { text, kind, until: Date.now() + ms, key } }))
  }
  const stampOn = (seat, text, kind, ms = 1400) => setStamps((s) => ({ ...s, [seat]: { text, kind, until: Date.now() + ms, key: Math.random() } }))
  const flash = (text, kind = "info", ms = 1300) => {
    const key = Math.random()
    setBanner({ text, kind, key })
    later(ms, () => setBanner((b) => (b?.key === key ? null : b)))
  }

  const animate = useCallback(
    (events) => {
      let t = 0
      for (const e of events) {
        const at = t
        const run = (fn) => (at ? later(at, fn) : fn())
        switch (e.t) {
          case "deal": {
            const per = Math.min(70, 900 / (e.n * n))
            setDeal({ key: e.seq, per, n })
            later(5000, () => setDeal((d) => (d?.key === e.seq ? null : d)))
            sounds?.shuffle()
            const deck = rectOf(q('[data-pile="deck"]'))
            for (let k = 0; k < Math.min(e.n, 4); k++)
              for (let i = 1; i <= n; i++) {
                const seat = (e.dealer + i) % n
                const d = 380 + (k * n + i) * per
                later(d, () => fly(deck, rectOf(seatEl(seat)), null, { dur: 260, fade: true, endScale: seat === you ? 1 : 0.4 }))
              }
            later(400, () => sounds?.deal(Math.min(10, e.n)))
            t += 380 + Math.min(4, e.n) * n * per
            break
          }
          case "play": {
            run(() => {
              const to = rectOf(q('[data-pile="discard"]'))
              const from = e.seat === you && playFrom.current ? playFrom.current : rectOf(seatEl(e.seat))
              playFrom.current = null
              fly(from, to, e.card, { rot: spin(e.card.id) })
              later(FLIGHT_MS - 40, () => sounds?.card())
              if (isWild(e.card)) {
                later(FLIGHT_MS, () => {
                  setBurst({ color: e.color, key: e.seq })
                  sounds?.wild()
                })
              }
            })
            t += 260
            break
          }
          case "discall":
            run(() => flash(`Discard All: ${e.cards.length} more ${COLOR_NAMES[e.cards[0].c]} card${e.cards.length === 1 ? "" : "s"}!`, "info"))
            t += 200
            break
          case "draw": {
            const count = Math.min(e.n, 10)
            run(() => {
              const deck = rectOf(q('[data-pile="deck"]'))
              const to = rectOf(seatEl(e.seat))
              for (let i = 0; i < count; i++)
                later(i * 110, () => {
                  fly(deck, to, null, { dur: 300, fade: true, endScale: e.seat === you ? 1 : 0.4 })
                  sounds?.draw()
                })
              if (e.seat === you && e.ids) {
                const ids = e.ids
                later(250, () => setNewIds((s) => new Set([...s, ...ids])))
                later(1600, () => setNewIds((s) => new Set([...s].filter((id) => !ids.includes(id)))))
              }
              if (e.take || e.penalty) stampOn(e.seat, `+${e.n}`, "draw")
            })
            t += Math.min(600, count * 110)
            break
          }
          case "skip":
            run(() => {
              stampOn(e.seat, "SKIP", "skip")
              sounds?.skip()
            })
            t += 150
            break
          case "skipall":
            run(() => {
              flash("Skip All! Go again", "skip")
              sounds?.skip()
            })
            break
          case "rev":
            run(() => {
              setRingSpin((k) => k + 1)
              flash("Reverse!", "rev")
              sounds?.reverse()
            })
            t += 150
            break
          case "stack":
            run(() => {
              stampOn(e.seat, `+${e.total}`, "draw", 1800)
              sounds?.stack(e.total)
            })
            break
          case "call":
            run(() => {
              say(e.seat, "Last Card!", "call")
              sounds?.call()
            })
            break
          case "catch":
            run(() => {
              stampOn(e.seat, "CAUGHT!", "caught", 1800)
              say(e.by, "Gotcha!", "call", 1800)
              sounds?.caught()
              onEvent?.(e)
            })
            t += 200
            break
          case "swap":
            run(() => {
              flash(`${e.seat === you ? "You" : names[e.seat]} swapped hands with ${e.target === you ? "you" : names[e.target]}!`, "swap", 1700)
              sounds?.swap()
            })
            break
          case "rotate":
            run(() => {
              flash("Zero! Every hand moves along", "swap", 1700)
              sounds?.swap()
            })
            break
          case "challenge":
            run(() => {
              flash(e.won ? `Challenge won! ${names[e.by]} was bluffing` : `Challenge failed! ${e.seat === you ? "You draw" : `${names[e.seat]} draws`} 6`, e.won ? "skip" : "draw", 2000)
              e.won ? sounds?.caught() : sounds?.stack(6)
            })
            t += 200
            break
          case "jump":
            run(() => {
              flash(`${e.seat === you ? "You" : names[e.seat]} jumped in!`, "rev")
            })
            break
          case "emote":
            run(() => {
              say(e.seat, EMOTES[e.id] || "...", "emote")
              sounds?.pop()
            })
            break
          case "shuffle":
            run(() => {
              flash("Shuffling the discards into the deck", "info")
              sounds?.shuffle()
            })
            break
          case "timeout":
            run(() => say(e.seat, "Out of time!", "info", 1600))
            break
          case "pass":
            run(() => say(e.seat, "Keeps it", "info", 1200))
            break
          case "out":
            run(() => {
              stampOn(e.seat, "OUT!", "out", 2600)
              if (e.seat === you) sounds?.win(0.2)
              else sounds?.lose(0.2)
              onEvent?.(e)
            })
            break
          default:
        }
      }
    },
    [n, you, names, sounds, pileCw]
  )

  // new events -> animations
  useEffect(() => {
    const events = view.events || []
    if (lastSeq.current === null) {
      // first look at this game: animate a deal that just happened, nothing older
      const i = events.map((e) => e.t).lastIndexOf("deal")
      const fresh = i >= 0 && events.length - i <= 3 && serverNow() - events[i].at < 3000
      lastSeq.current = fresh ? events[i].seq - 1 : view.seq
    }
    const fresh = events.filter((e) => e.seq > lastSeq.current)
    lastSeq.current = Math.max(lastSeq.current, view.seq)
    if (fresh.length) animate(fresh)
  }, [view.seq])

  // a strip that scrolls sideways (phones held sideways, big tables): keep whoever's turn
  // it is in view (scrollLeft, not scrollIntoView, which can move the whole window)
  useEffect(() => {
    const strip = stripRef.current
    if (!strip || strip.scrollWidth <= strip.clientWidth) return
    const el = strip.querySelector(`[data-seat="${view.turn}"]`)
    if (el) strip.scrollTo({ left: el.offsetLeft - strip.clientWidth / 2 + el.offsetWidth / 2, behavior: "smooth" })
  }, [view.turn, compact, short])

  // your turn: a ping; the clock ticks in the last five seconds
  useEffect(() => {
    if (myTurn) sounds?.turn()
    setArmed(false)
  }, [view.turnId, myTurn])
  const secondsLeft = myTurn && view.turnEnds ? Math.ceil((view.turnEnds - serverNow()) / 1000) : null
  useEffect(() => {
    if (secondsLeft !== null && secondsLeft <= 5 && secondsLeft > 0) sounds?.tick()
  }, [secondsLeft])
  useEffect(() => {
    if (picker && !playable.has(picker.card.id)) setPicker(null)
  }, [view.playable])

  // ---------- your moves ----------

  const send = async (move) => {
    setBusy(true)
    const result = await act(move)
    setBusy(false)
    if (!result?.ok && result?.error) {
      setToast({ text: result.error, key: Math.random() })
      sounds?.bad()
    }
    return result
  }

  const playCard = (card, extra = {}) => {
    const call = armed || extra.call
    setArmed(false)
    setPicker(null)
    return send({ type: "play", card: card.id, ...extra, ...(call ? { call: true } : {}) })
  }

  const tryPlay = (card, el) => {
    if (!playable.has(card.id)) {
      setShake(card.id)
      later(400, () => setShake(null))
      sounds?.bad()
      if (view.phase === "play") setToast({ text: myTurn ? (view.drawn != null ? "Play the card you drew, or keep it." : view.stack ? "Stack a draw card, or take the cards." : `That doesn't match. Play ${COLOR_NAMES[view.color]} or a ${VALUE_NAMES[view.top.v] || view.top.v}.`) : view.settings.jumpIn ? "Not your turn. Only the very same card can jump in." : "Wait for your turn.", key: Math.random() })
      return
    }
    playFrom.current = rectOf(el)
    if (isWild(card)) return setPicker({ card, step: "color" })
    if (view.settings.sevenO && card.v === "7" && hand.length > 1) return setPicker({ card, step: "target" })
    playCard(card)
  }

  // drag a card up onto the table to play it
  const onPointerDown = (card) => (e) => {
    if (e.button && e.button !== 0) return
    dragging.current = { id: card.id, x: e.clientX, y: e.clientY, el: e.currentTarget, moved: false, pointer: e.pointerId }
  }
  const onPointerMove = (e) => {
    const d = dragging.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved) {
      if (Math.abs(dy) < 10 || Math.abs(dy) < Math.abs(dx)) {
        if (Math.abs(dx) > 10) dragging.current = null
        return
      }
      d.moved = true
      d.el.setPointerCapture?.(d.pointer)
      d.el.classList.add("is-dragging")
    }
    d.el.style.setProperty("--drag", `translate(${dx}px, ${Math.min(30, dy)}px)`)
  }
  const onPointerUp = (card) => (e) => {
    const d = dragging.current
    dragging.current = null
    if (!d || d.id !== card.id) return
    if (!d.moved) return
    e.preventDefault()
    d.el.classList.remove("is-dragging")
    d.el.style.removeProperty("--drag")
    d.el.dataset.dragged = "1"
    later(50, () => delete d.el.dataset.dragged)
    if (e.clientY - d.y < -60) tryPlay(card, d.el)
  }

  const draw = () => myTurn && (view.canDraw || view.stack) && !busy && send({ type: "draw" })
  const catchThem = () => send({ type: "catch" })
  const callIt = () => send({ type: "call" })

  useEffect(() => {
    const key = (e) => {
      if (e.target.closest?.("input, textarea, select")) return
      if (!isKeyForWindow(rootRef.current, e)) return
      if (e.key === "d" || e.key === "D") draw()
      if ((e.key === "k" || e.key === "K") && view.canPass) send({ type: "pass" })
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  })

  // ---------- layout ----------

  const others = []
  for (let k = 1; k < n; k++) others.push((you + k) % n)
  const arc = arcPositions(you === null ? n + 1 : n)
  const seatList = you === null ? Array.from({ length: n }, (_, i) => i) : others

  // the hand: overlap the cards so they fit; scroll sideways when they can't
  const handW = Math.max(200, (handRef.current?.clientWidth || size.w) - 24)
  const count = hand.length
  const fullStep = handCw * 0.86
  const fitStep = count > 1 ? (handW - handCw) / (count - 1) : fullStep
  const minStep = handCw * (compact ? 0.5 : 0.36)
  const step = Math.max(minStep, Math.min(fullStep, fitStep))
  const overflow = count > 1 && fitStep < minStep
  const fan = !overflow && !compact && count > 1

  const top = view.top
  const statusText = (() => {
    if (view.phase === "roundover") return "Round over"
    if (view.phase === "over") return "Game over"
    if (you === null) return `${names[view.turn]}'s turn`
    if (!myTurn) return `${names[view.turn]}'s turn${view.stack ? ` (+${view.stack} pending)` : ""}`
    if (view.canChallenge) return `${names[view.wd4By]} played a Wild Draw Four on you!`
    if (view.stack) return view.settings.stacking && view.playable.length ? `Stack a draw card, or take ${view.stack}` : `Take ${view.stack} cards`
    if (view.drawn != null) return view.mustPlay ? "You drew a card that fits: play it" : "Play the card you drew, or keep it"
    return view.playable.length ? `Your turn: play ${COLOR_NAMES[view.color]}${isWild(top) ? "" : ` or ${VALUE_NAMES[top.v] || top.v}`}` : "Nothing fits: draw a card"
  })()

  const myMeta = you !== null ? seats[you] : null
  const lastCardReady = you !== null && hand.length === 2 && view.playable.length > 0
  const roundPanel = (view.phase === "roundover" || view.phase === "over") && view.roundResult

  return (
    <div
      ref={rootRef}
      className={`lcTable${compact ? " is-compact" : ""}${n > 6 ? " is-crowd" : ""}${short ? " is-short" : ""}${myTurn ? " is-myturn" : ""}`}
      style={{ "--hand-cw": `${handCw}px`, "--pile-cw": `${pileCw}px`, "--color": HEX[view.color] || "#888" }}
      data-phase={view.phase}
      data-turn={view.turn}
      data-you={you ?? ""}
    >
      <div className={`lcArena${compact ? " is-strip" : ""}`}>
        <div className="lcOpponents" ref={stripRef}>
          {seatList.map((seat, k) => (
            <Seat
              key={seat}
              seat={seat}
              view={view}
              meta={seats[seat]}
              style={compact ? undefined : arc[k]}
              serverNow={serverNow}
              bubble={bubbles[seat]}
              stamp={stamps[seat]}
              now={now}
              compact={compact}
              crowd={n > 6}
              onCatch={catchThem}
              targetable={picker?.step === "target" && seat !== you}
              onTarget={(t) => playCard(picker.card, { target: t })}
            />
          ))}
        </div>

        <div className="lcCenter">
          <div className="lcPiles">
            <div className={`lcDirRing${view.dir < 0 ? " is-ccw" : ""}`} key={`ring${ringSpin}`} aria-label={view.dir > 0 ? "Play goes clockwise" : "Play goes counterclockwise"}>
              <svg viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="44" className="lcDirTrack" />
                {[0, 90, 180, 270].map((a) => (
                  <g key={a} transform={`rotate(${a} 50 50)`}>
                    <path d={view.dir > 0 ? "M47 2.5l6 3.5-6 3.5" : "M53 2.5l-6 3.5 6 3.5"} className="lcDirArrow" />
                  </g>
                ))}
              </svg>
            </div>
            <button type="button" className={`lcDeck${myTurn && (view.canDraw || view.stack) ? " is-ready" : ""}`} data-pile="deck" onClick={draw} disabled={!myTurn || busy || !(view.canDraw || view.stack)} aria-label={view.stack ? `Take ${view.stack} cards` : "Draw a card"}>
              <Card back className="is-pile" />
              {view.deckCount > 1 && <Card back className="is-pile is-under1" />}
              {view.deckCount > 12 && <Card back className="is-pile is-under2" />}
              <span className="lcDeckCount">{view.deckCount}</span>
              {myTurn && (view.canDraw || view.stack > 0) && <span className="lcDeckHint">{view.stack ? `Take ${view.stack}` : "Draw"}</span>}
            </button>
            <div className="lcDiscard" data-pile="discard" aria-label={`Top card: ${cardName(top)}${isWild(top) ? `, color ${COLOR_NAMES[view.color]}` : ""}`}>
              <span className="lcGlow" aria-hidden="true" />
              {view.pile.map((c, i) => (
                <Card key={c.id} card={c} className={`is-pile${i === view.pile.length - 1 ? " is-top" : ""}`} style={{ "--rot": `${spin(c.id)}deg`, zIndex: i }} />
              ))}
              {isWild(top) && <span className={`lcChosen is-${view.color}`}>{COLOR_NAMES[view.color]}</span>}
              {burst && <span key={`burst${burst.key}`} className={`lcBurst is-${burst.color}`} aria-hidden="true" />}
              {view.stack > 0 && view.phase === "play" && (
                <span className="lcStackBadge" key={`stack${view.stack}`} data-stack={view.stack}>
                  +{view.stack}
                </span>
              )}
            </div>
          </div>
          <div className="lcStatus" role="status" data-status>
            {statusText}
          </div>
          {vulnOther !== null && (
            <button type="button" className="lcCatch" onClick={catchThem} data-catch>
              Catch {names[vulnOther]}! <small>forgot to call Last Card</small>
            </button>
          )}
          {view.canChallenge && (
            <div className="lcRowBtns lcChallenge">
              <button type="button" className="lcPrimary" onClick={() => send({ type: "challenge" })} data-challenge>
                Challenge!
              </button>
              <button type="button" onClick={() => send({ type: "draw" })}>
                Take {view.stack}
              </button>
            </div>
          )}
          {banner && (
            <div key={banner.key} className={`lcBanner is-${banner.kind}`}>
              {banner.text}
            </div>
          )}
        </div>
      </div>

      {you !== null ? (
        <div className={`lcMe${myTurn ? " is-turn" : ""}`} data-seat={you}>
          <div className="lcMeBar">
            <span className="lcSeatAvatar">
              <Avatar name={names[you]} size={compact ? 26 : 32} />
              {myTurn && <Ring ends={view.turnEnds} total={view.turnMs} serverNow={serverNow} turnId={view.turnId} size={compact ? 38 : 46} />}
            </span>
            <span className="lcMeName">
              <b>{myMeta?.name || "You"}</b>
              <small>
                {view.target ? `${view.scores[you]}/${view.target} pts` : "One round"}
                {secondsLeft !== null && secondsLeft <= 10 ? ` · ${secondsLeft}s` : ""}
              </small>
            </span>
            {bubbles[you] && bubbles[you].until > now && (
              <span key={bubbles[you].key} className={`lcBubble is-me${bubbles[you].kind ? ` is-${bubbles[you].kind}` : ""}`}>
                {bubbles[you].text}
              </span>
            )}
            {stamps[you] && stamps[you].until > now && (
              <span key={stamps[you].key} className={`lcStamp is-me is-${stamps[you].kind}`}>
                {stamps[you].text}
              </span>
            )}
            <span className="lcMeButtons">
              {vulnMe ? (
                <button type="button" className="lcLastBtn is-urgent" onClick={callIt} data-lastcard>
                  LAST CARD!
                </button>
              ) : (
                lastCardReady && (
                  <button type="button" className={`lcLastBtn${armed ? " is-armed" : ""}`} aria-pressed={armed} onClick={() => setArmed(!armed)} data-lastcard title="Press before you play your next-to-last card">
                    {armed ? "LAST CARD! ✓" : "LAST CARD!"}
                  </button>
                )
              )}
              {view.canPass && (
                <button type="button" onClick={() => send({ type: "pass" })} data-pass>
                  Keep It
                </button>
              )}
              {myTurn && view.canDraw && !view.stack && (
                <button type="button" onClick={draw} data-draw disabled={busy}>
                  Draw
                </button>
              )}
              <span className="lcEmoteWrap">
                <button type="button" onClick={() => setEmotes(!emotes)} aria-expanded={emotes} data-emotes>
                  Say...
                </button>
                {emotes && (
                  <EmotePicker
                    onClose={() => setEmotes(false)}
                    onPick={(id) => {
                      setEmotes(false)
                      send({ type: "emote", id })
                    }}
                  />
                )}
              </span>
            </span>
          </div>
          <div
            ref={handRef}
            className={`lcHand${overflow ? " is-scroll" : ""}${fan ? " is-fan" : ""}`}
            data-me-hand
            onPointerMove={onPointerMove}
            style={{ "--step": `${step}px` }}
          >
            <div className="lcHandRow" style={{ width: overflow ? handCw + step * (count - 1) + 16 : undefined }}>
              {hand.map((card, i) => {
                const mid = (count - 1) / 2
                const rot = fan ? (i - mid) * Math.min(3.2, 34 / count) : 0
                // the middle of the fan sits a little higher than its ends
                const lift = fan && mid ? -(1 - Math.pow((i - mid) / mid, 2)) * Math.min(14, count * 2) : 0
                const can = playable.has(card.id)
                const dealDelay = deal ? 380 + (i * deal.n + 1) * deal.per : 0
                return (
                  <button
                    key={card.id}
                    type="button"
                    className={`lcHandCard${can ? " is-playable" : myTurn ? " is-dim" : ""}${newIds.has(card.id) ? " is-new" : ""}${shake === card.id ? " is-shake" : ""}${deal && i < 10 ? " is-dealt" : ""}${view.drawn === card.id ? " is-drawn" : ""}`}
                    style={{ marginLeft: i ? step - handCw : 0, "--rot": `${rot}deg`, "--lift": `${lift}px`, "--deal": `${dealDelay}ms`, zIndex: i }}
                    data-card-id={card.id}
                    data-card={`${card.c}${card.v}`}
                    aria-label={`${cardName(card)}${can ? "" : " (can't play now)"}`}
                    onPointerDown={onPointerDown(card)}
                    onPointerUp={onPointerUp(card)}
                    onPointerCancel={() => (dragging.current = null)}
                    onClick={(e) => {
                      if (e.currentTarget.dataset.dragged) return
                      tryPlay(card, e.currentTarget)
                    }}
                    onAnimationEnd={(e) => e.animationName === "lcDealIn" && i === count - 1 && setDeal(null)}
                  >
                    <Card card={card} />
                  </button>
                )
              })}
              {!count && view.phase === "play" && <span className="lcMuted">No cards!</span>}
            </div>
          </div>
        </div>
      ) : (
        <div className="lcMe is-watching">
          <span className="lcMuted">You're watching. {describeRules(view.settings)}.</span>
        </div>
      )}

      {footer && <div className="lcFooter">{footer}</div>}

      {roundPanel && <RoundPanel view={view} names={names} serverNow={serverNow} now={now} onReady={() => send({ type: "ready" })} />}

      <div className="lcFlights" aria-hidden="true">
        {flights.map((f) => (
          <Card
            key={f.id}
            card={f.card}
            back={!f.card}
            className={`lcFlight${f.fade ? " is-fade" : ""}`}
            style={{ left: f.x, top: f.y, "--cw": `${f.w}px`, "--dx": `${f.dx}px`, "--dy": `${f.dy}px`, "--s0": f.s0, "--s1": f.s1, "--rot": `${f.rot}deg`, animationDuration: `${f.dur}ms`, animationDelay: `${f.delay}ms` }}
          />
        ))}
      </div>

      {picker?.step === "color" && <ColorPicker card={picker.card} onCancel={() => setPicker(null)} onPick={(color) => playCard(picker.card, { color })} />}
      {picker?.step === "target" && <TargetPicker view={view} names={names} onCancel={() => setPicker(null)} onPick={(t) => playCard(picker.card, { target: t })} />}
      {toast && (
        <div key={toast.key} className="lcToast" role="alert" onAnimationEnd={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  )
}

export default Table
