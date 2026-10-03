import React, { useEffect, useRef, useState } from "react"
import { COLORS, COSTS, DEV, RES, RES_INFO, hasAll, legalCities, legalRoads, legalSettlements } from "./logic.js"
import { ResSvg, DevArt, SettlementPiece, CityPiece, RoadPiece } from "./art.jsx"

// The table's side pieces: the players (points, cards, special cards, the turn clock), your
// hand, the build menu (costs, and where you could build), and the game log.

export const colorOf = (id) => COLORS.find((c) => c.id === id) || COLORS[0]

// a player's little house in their color (an avatar)
// the turn clock, re-rendering only the pieces that show it: clock = { deadline, start,
// now() } or null -> { ring: 1..0, secs }
export const useClock = (clock) => {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!clock) return
    const h = setInterval(() => tick((x) => x + 1), 250)
    return () => clearInterval(h)
  }, [clock])
  if (!clock) return { ring: null, secs: null }
  const left = Math.max(0, clock.deadline - clock.now())
  return { ring: left / Math.max(1, clock.deadline - clock.start), secs: Math.ceil(left / 1000) }
}

// seconds left (and a tick in the last five, when it's on you)
export const Secs = ({ clock, onTick }) => {
  const { secs } = useClock(clock)
  const last = useRef(null)
  useEffect(() => {
    if (secs != null && secs <= 5 && secs > 0 && last.current !== secs) {
      last.current = secs
      onTick?.()
    }
  }, [secs])
  return secs == null ? null : <small>{secs}s</small>
}

export const Avatar = ({ color, size = 30, clock = null }) => {
  const c = colorOf(color)
  const { ring } = useClock(clock)
  const R = 21
  const C = 2 * Math.PI * R
  return (
    <span className="hxAvatar" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="-24 -24 48 48" aria-hidden="true">
        <circle r="18" fill={c.fill} stroke={c.dark} strokeWidth="2" />
        <g transform="translate(0 2) scale(.62)">
          <SettlementPiece x={0} y={0} fill="#fff8e6" dark={c.dark} />
        </g>
        {ring != null && (
          <>
            <circle r={R} fill="none" stroke="rgba(0,0,0,.18)" strokeWidth="4" />
            <circle r={R} fill="none" stroke={ring < 0.25 ? "#d63a2a" : "#2f8f3e"} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${Math.max(0, Math.min(1, ring)) * C} ${C}`} transform="rotate(-90)" className="hxRing" />
          </>
        )}
      </svg>
    </span>
  )
}

// a resource card: icon, name, how many
export const ResCard = ({ r, n, small = false, dim = false, onClick, active, label, ...rest }) => (
  <button type="button" className={`hxResCard hx-${r}${small ? " is-small" : ""}${dim ? " is-dim" : ""}${active ? " is-active" : ""}`} onClick={onClick} disabled={!onClick} {...rest}>
    <ResSvg r={r} size={small ? 18 : 26} />
    {!small && <span className="hxResName">{label ?? RES_INFO[r].label}</span>}
    {n != null && <b className="hxResCount">{n}</b>}
  </button>
)

// cost chips: green when you have the card, red when you're short
export const Cost = ({ cost, hand }) => (
  <span className="hxCost">
    {Object.entries(cost).flatMap(([r, n]) =>
      Array.from({ length: n }, (_, i) => (
        <span key={`${r}${i}`} className={`hxCostChip${hand && (hand[r] || 0) > i ? " is-have" : hand ? " is-short" : ""}`} title={RES_INFO[r].label}>
          <ResSvg r={r} size={16} />
        </span>
      ))
    )}
  </span>
)

const Ribbon = ({ kind }) => (
  <span className={`hxRibbon is-${kind}`} title={kind === "road" ? "Longest Road: 2 points" : "Largest Patrol: 2 points"}>
    {kind === "road" ? "Longest Road" : "Largest Patrol"}
  </span>
)

// ---------- players ----------

export const PlayersPanel = ({ view, names, seats, clock, compact = false, replies = null, onPick }) => (
  <div className={`hxPlayers${compact ? " is-compact" : ""}`}>
    {view.players.map((p, i) => {
      const turn = view.phase !== "over" && (view.phase === "special" ? view.special.queue[view.special.at] === i : view.turn === i)
      const seat = seats?.[i]
      const reply = replies?.[i]
      return (
        <div key={i} className={`hxPlayer${turn ? " is-turn" : ""}${i === view.you ? " is-you" : ""}${view.winner === i ? " is-winner" : ""}`} data-player-row={i} onClick={onPick ? () => onPick(i) : undefined}>
          <Avatar color={p.color} size={compact ? 26 : 34} clock={turn ? clock : null} />
          <div className="hxPlayerMain">
            <div className="hxPlayerName">
              <span>{names[i] || p.name}</span>
              {i === view.you && <small>you</small>}
              {seat?.bot && i !== view.you && <small title="Computer player">CPU</small>}
              {seat?.away && <small className="is-away">away</small>}
            </div>
            {!compact && (
              <div className="hxPlayerStats">
                <span title="Resource cards" data-stat="cards">
                  <i className="hxIconCards" /> {p.cards}
                </span>
                <span title="Development cards" data-stat="dev">
                  <i className="hxIconDev" /> {p.devCount}
                </span>
                <span title="Rangers played" data-stat="rangers">
                  <i className="hxIconShield" /> {p.rangers}
                </span>
                <span title="Longest road" data-stat="road">
                  <i className="hxIconRoad" /> {p.road}
                </span>
              </div>
            )}
            {!compact && (view.longest === i || view.army === i) && (
              <div className="hxRibbons">
                {view.longest === i && <Ribbon kind="road" />}
                {view.army === i && <Ribbon kind="army" />}
              </div>
            )}
            {compact && (
              <div className="hxChipStats">
                <b data-points={p.points}>{p.points}</b>
                <span>pts</span>
                <i className="hxIconCards" />
                <span data-stat="cards">{p.cards}</span>
              </div>
            )}
            {view.discards?.[i] ? <div className="hxPlayerNote">Discarding {view.discards[i]}...</div> : null}
            {reply && <div className={`hxPlayerNote is-${reply.a}`}>{reply.a === "accept" ? "Accepts your offer" : reply.a === "decline" ? "No thanks" : "Counter-offer"}</div>}
          </div>
          {!compact && (
            <div className="hxPoints" title={i === view.you || view.phase === "over" ? "Victory points (with your secret Monuments)" : "Victory points (that everyone can see)"} data-points={p.points}>
              {p.points}
            </div>
          )}
          {compact && (view.longest === i || view.army === i) && <span className="hxBadges">{view.longest === i && <i className="hxBadge is-road" title="Longest Road" />}{view.army === i && <i className="hxBadge is-army" title="Largest Patrol" />}</span>}
        </div>
      )
    })}
  </div>
)

// ---------- your hand ----------

export const HandPanel = ({ view, onDev, compact = false }) => {
  const me = view.players[view.you]
  if (!me?.hand) return null
  const dev = {}
  for (const d of me.dev || []) {
    dev[d.t] ||= { n: 0, fresh: 0 }
    dev[d.t].n++
    if (d.fresh) dev[d.t].fresh++
  }
  return (
    <div className={`hxHand${compact ? " is-compact" : ""}`}>
      <div className="hxHandRes">
        {RES.map((r) => (
          <ResCard key={r} r={r} n={me.hand[r]} dim={!me.hand[r]} small={compact} data-hand={r} />
        ))}
      </div>
      {Object.keys(dev).length > 0 && (
        <div className="hxHandDev">
          {Object.entries(dev).map(([t, d]) => (
            <button key={t} type="button" className={`hxDevCard is-${t}`} onClick={() => onDev?.(t)} title={`${DEV[t].label}: ${DEV[t].text}`} data-dev={t}>
              <DevArt t={t} size={compact ? 26 : 34} />
              {!compact && <span>{DEV[t].label}</span>}
              {d.n > 1 && <b>{d.n}</b>}
              {d.fresh > 0 && t !== "monument" && <em title="Bought this turn: play it next turn">new</em>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- the build menu ----------

export const BUILDS = [
  { what: "road", label: "Road", text: "Connects your buildings. 5+ in a row can win Longest Road." },
  { what: "settlement", label: "Settlement", text: "1 point. Collects from the tiles around it." },
  { what: "city", label: "City", text: "2 points. Replaces a settlement and collects double." },
  { what: "dev", label: "Development card", text: "A Ranger, a Monument or a special trick." },
]

export const buildSpots = (view, what) => {
  const me = view.you
  if (what === "road") return legalRoads(view, me)
  if (what === "settlement") return legalSettlements(view, me)
  if (what === "city") return legalCities(view, me)
  return []
}

// why you can't build this now (or null if you can)
export const buildBlocker = (view, what, canAct) => {
  const me = view.players[view.you]
  if (!canAct) return view.phase === "roll" ? "Roll first" : "Not now"
  const piece = what === "dev" ? null : what
  if (piece && me.pieces[piece] < 1) return `No ${what === "city" ? "cities" : `${what}s`} left`
  if (what === "dev" && !view.deck) return "Deck is empty"
  if (!hasAll(me.hand, COSTS[what])) return "Not enough cards"
  if (what !== "dev" && !buildSpots(view, what).length) return "Nowhere to build"
  return null
}

const BuildIcon = ({ what, color }) => {
  const c = colorOf(color)
  return (
    <svg width="34" height="30" viewBox="-30 -26 60 52" aria-hidden="true">
      {what === "road" && <RoadPiece x={0} y={0} angle={-30} fill={c.fill} dark={c.dark} />}
      {what === "settlement" && <SettlementPiece x={0} y={2} fill={c.fill} dark={c.dark} scale={1.3} />}
      {what === "city" && <CityPiece x={2} y={4} fill={c.fill} dark={c.dark} scale={1.05} />}
      {what === "dev" && (
        <g transform="translate(-22 -22)">
          <DevArt t="back" size={44} />
        </g>
      )}
    </svg>
  )
}

export const BuildMenu = ({ view, canAct, onChoose, onHover, mode }) => {
  const me = view.players[view.you]
  return (
    <div className="hxBuild" onMouseLeave={() => onHover?.(null)}>
      {BUILDS.map((b) => {
        const blocker = buildBlocker(view, b.what, canAct)
        const spots = b.what === "dev" ? null : buildSpots(view, b.what).length
        return (
          <button
            key={b.what}
            type="button"
            className={`hxBuildRow${mode === b.what ? " is-on" : ""}`}
            disabled={!!blocker}
            onClick={() => onChoose(b.what)}
            onMouseEnter={() => onHover?.(b.what)}
            onFocus={() => onHover?.(b.what)}
            data-build={b.what}
            title={b.text}
          >
            <BuildIcon what={b.what} color={me.color} />
            <span className="hxBuildText">
              <b>{b.label}</b>
              <Cost cost={COSTS[b.what]} hand={me.hand} />
            </span>
            <span className="hxBuildNote">
              {blocker || (b.what === "dev" ? `${view.deck} left` : `${spots} spot${spots === 1 ? "" : "s"}`)}
              {b.what !== "dev" && <small>{me.pieces[b.what]} left</small>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ---------- the log ----------

export const LogPanel = ({ view, names }) => {
  const ref = useRef(null)
  const last = view.log.at(-1)?.id
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [last])
  return (
    <div className="hxLog" ref={ref} aria-live="polite">
      {view.log.map((e) => {
        const p = e.p != null ? view.players[e.p] : null
        return (
          <div key={e.id} className={`hxLogLine is-${e.k}`}>
            {p ? <i className="hxDot" style={{ background: colorOf(p.color).fill }} /> : <i className="hxDot is-none" />}
            <span>{rename(e.text, view, names)}</span>
          </div>
        )
      })}
    </div>
  )
}

// log lines carry the names from the start of the game; show current ones (someone who
// left shows as "Name (computer)"), and talk to you about yourself ("You roll 8.")
const VERBS = "rolls|places|gets|builds|buys|plays|moves|offers|trades|takes|discards|collects|counters|wins|must"
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
export const rename = (text, view, names) => {
  let out = text
  view.players.forEach((p, i) => {
    if (i === view.you) return
    if (names?.[i] && names[i] !== p.name) out = out.split(p.name).join(names[i])
  })
  const me = view.you != null ? view.players[view.you]?.name : null
  if (me) {
    const n = escape(me)
    out = out
      .replace(new RegExp(`(^|[.!:] )${n} (${VERBS})\\b`, "g"), (_, pre, verb) => `${pre}You ${verb === "must" ? verb : verb.slice(0, -1)}`)
      .replace(new RegExp(`(^|[.!:] )${n}'s turn`, "g"), "$1Your turn")
      .replace(new RegExp(`\\b${n} \\(`, "g"), "You (")
      .replace(new RegExp(`(from|to|with|for) ${n}\\b`, "g"), "$1 you")
      .replace(new RegExp(`(^|[.!:;] )${n} (gets|collects)\\b`, "g"), (_, pre, v) => `${pre}You ${v.slice(0, -1)}`)
      .replace(new RegExp(`; ${n} gets`, "g"), "; you get")
      .replace(/(You [^.]*?) and (takes|collects)\b/g, (_, a, v) => `${a} and ${v.slice(0, -1)}`)
  }
  return out
}

