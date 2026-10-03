import React, { useState } from "react"
import { DEV, RES, RES_INFO, PIPS, total } from "./logic.js"
import { DevArt, ResSvg } from "./art.jsx"
import { Avatar, colorOf } from "./Panels.jsx"
import { CardPicker } from "./Trade.jsx"

// The table's pop-ups: discarding half on a 7, picking who the Bandit robs, playing a
// development card, and the end of the game (points, resources gained, the dice).

export const Modal = ({ title, children, onClose, wide = false, className = "" }) => (
  <div className="hxModalBack" onPointerDown={(e) => e.target === e.currentTarget && onClose?.()}>
    <div className={`hxModal${wide ? " is-wide" : ""} ${className}`} role="dialog" aria-label={title}>
      <div className="hxModalHead">
        <b>{title}</b>
        {onClose && (
          <button type="button" className="hxClose" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>
      <div className="hxModalBody">{children}</div>
    </div>
  </div>
)

export const DiscardDialog = ({ view, act }) => {
  const me = view.you
  const need = view.discards?.[me]
  const [cards, setCards] = useState({})
  const [err, setErr] = useState(null)
  if (!need) return null
  const n = Object.values(cards).reduce((a, b) => a + b, 0)
  return (
    <Modal title="A seven! Discard half your cards" className="hxDiscard">
      <p>
        You have {total(view.players[me].hand)} cards: pick <b>{need}</b> to give back to the bank.
      </p>
      <CardPicker value={cards} onChange={setCards} max={view.players[me].hand} dataKey="discard" />
      {err && <p className="hxWarn">{err}</p>}
      <div className="hxRow">
        <button
          type="button"
          className="hxGo"
          disabled={n !== need}
          data-discard
          onClick={async () => {
            const r = await act({ type: "discard", cards: Object.fromEntries(Object.entries(cards).filter(([, k]) => k > 0)) })
            if (!r?.ok) setErr(r?.error)
          }}
        >
          {n === need ? `Discard ${need}` : `${n} of ${need} picked`}
        </button>
      </div>
    </Modal>
  )
}

export const VictimDialog = ({ view, names, tile, victims, onPick, onCancel }) => (
  <Modal title="Take a card from..." onClose={onCancel}>
    <div className="hxVictims">
      {victims.map((p) => (
        <button key={p} type="button" className="hxVictim" onClick={() => onPick(p)} data-victim={p}>
          <Avatar color={view.players[p].color} size={34} />
          <b>{names[p] || view.players[p].name}</b>
          <small>
            {view.players[p].cards} cards, {view.players[p].points} points
          </small>
        </button>
      ))}
    </div>
    <p className="hxMuted">You'll take one of their cards at random.</p>
  </Modal>
)

// why a development card can't be played right now (or null)
export const devBlocker = (view, t) => {
  const me = view.players[view.you]
  if (t === "monument") return "Monuments score by themselves. Keep it secret!"
  if (view.turn !== view.you) return "Play cards on your own turn."
  if (!(view.phase === "roll" || view.phase === "main")) return "Finish what you're doing first."
  if (view.devPlayed) return "You've already played a card this turn."
  if (!me.dev.some((d) => d.t === t && !d.fresh)) return "You bought this card this turn: play it on a later turn."
  return null
}

export const DevDialog = ({ view, card, act, onClose }) => {
  const blocker = devBlocker(view, card)
  const [res, setRes] = useState([])
  const [err, setErr] = useState(null)
  const needs = card === "plenty" ? 2 : card === "monopoly" ? 1 : 0
  const play = async () => {
    const a = { type: "play", card }
    if (card === "plenty") a.res = res
    if (card === "monopoly") a.res = res[0]
    const r = await act(a)
    if (r?.ok) onClose()
    else setErr(r?.error)
  }
  return (
    <Modal title={DEV[card].label} onClose={onClose} className="hxDevModal">
      <div className="hxDevBig">
        <DevArt t={card} size={72} />
        <p>{DEV[card].text}</p>
      </div>
      {needs > 0 && !blocker && (
        <div className="hxResChoice">
          <div className="hxPickerLabel">{card === "plenty" ? `Pick two (${res.length}/2)` : "Which resource?"}</div>
          <div className="hxRow">
            {RES.map((r) => {
              const picked = res.filter((x) => x === r).length
              return (
                <button
                  key={r}
                  type="button"
                  className={`hxBankRes hx-${r}${picked ? " is-on" : ""}`}
                  data-choose={r}
                  disabled={card === "plenty" && view.bank[r] < picked + 1 && !picked}
                  onClick={() => {
                    if (card === "monopoly") setRes([r])
                    else if (res.length < 2) setRes([...res, r])
                    else setRes([r])
                  }}
                >
                  <ResSvg r={r} size={22} />
                  <b>{RES_INFO[r].label}</b>
                  {picked > 0 && <small>×{picked}</small>}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {blocker && <p className="hxMuted">{blocker}</p>}
      {err && <p className="hxWarn">{err}</p>}
      {card !== "monument" && (
        <div className="hxRow">
          <button type="button" className="hxGo" disabled={!!blocker || res.length < needs} onClick={play} data-play-dev>
            Play {DEV[card].label}
          </button>
          <button type="button" onClick={onClose}>
            Keep it
          </button>
        </div>
      )}
    </Modal>
  )
}

// ---------- the end of the game ----------

const sumOf = (h) => RES.reduce((n, r) => n + (h?.[r] || 0), 0)

// rolls of each number against what two dice should give (one series: no legend needed)
const DiceChart = ({ rolls }) => {
  const sums = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  const n = sums.reduce((a, s) => a + (rolls[s] || 0), 0)
  const expected = (s) => (n * (s === 7 ? 6 : PIPS[s])) / 36
  const top = Math.max(1, ...sums.map((s) => Math.max(rolls[s] || 0, expected(s))))
  const H = 120
  const W = 22
  const GAP = 6
  return (
    <figure className="hxChart" aria-label="Dice rolled">
      <figcaption>
        Dice rolled <small>({n} rolls; the dashes show what two dice average)</small>
      </figcaption>
      <svg viewBox={`0 0 ${sums.length * (W + GAP)} ${H + 34}`} className="hxChartSvg" role="img">
        <line x1="0" x2={sums.length * (W + GAP)} y1={H} y2={H} className="hxAxis" />
        {sums.map((s, i) => {
          const v = rolls[s] || 0
          const h = (v / top) * (H - 8)
          const e = H - (expected(s) / top) * (H - 8)
          const x = i * (W + GAP) + GAP / 2
          return (
            <g key={s} className="hxBarG">
              <title>{`${s}: rolled ${v} time${v === 1 ? "" : "s"} (about ${expected(s).toFixed(1)} expected)`}</title>
              <rect x={x - GAP / 2} y="0" width={W + GAP} height={H + 30} fill="transparent" />
              {h > 0 && <path d={`M${x} ${H} V${H - h + 4} q0 -4 4 -4 H${x + W - 4} q4 0 4 4 V${H} Z`} className={`hxBar${s === 7 ? " is-seven" : ""}`} />}
              <line x1={x - 2} x2={x + W + 2} y1={e} y2={e} className="hxExpect" />
              {v > 0 && (
                <text x={x + W / 2} y={H - h - 4} textAnchor="middle" className="hxBarVal">
                  {v}
                </text>
              )}
              <text x={x + W / 2} y={H + 16} textAnchor="middle" className="hxBarLabel">
                {s}
              </text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

export const EndScreen = ({ view, names, footer, onClose }) => {
  const order = view.players.map((_, i) => i).sort((a, b) => view.players[b].points - view.players[a].points)
  const winner = view.winner
  const maxGain = Math.max(1, ...view.players.map((p) => sumOf(p.stats?.gained)))
  const youWon = winner === view.you
  return (
    <Modal title={youWon ? "You win!" : `${names[winner] || view.players[winner]?.name} wins!`} wide onClose={onClose} className="hxEnd">
      <div className="hxEndTop">
        <div className="hxTrophy" aria-hidden="true">
          {youWon ? "🏆" : "🏁"}
        </div>
        <p>
          {youWon ? "Your island, your rules. " : ""}
          {names[winner] || view.players[winner]?.name} reached {view.players[winner]?.points} points on turn {view.turnNo}.
        </p>
      </div>
      <table className="hxScores">
        <thead>
          <tr>
            <th>Player</th>
            <th title="Settlements and cities">Buildings</th>
            <th title="Longest Road and Largest Patrol">Special</th>
            <th title="Monuments">Monuments</th>
            <th>Points</th>
            <th>Resources gained</th>
          </tr>
        </thead>
        <tbody>
          {order.map((i) => {
            const p = view.players[i]
            const settlements = view.verts.filter((b) => b && b.p === i && b.k === "s").length
            const cities = view.verts.filter((b) => b && b.p === i && b.k === "c").length
            const monuments = (p.dev || []).filter((d) => d.t === "monument").length
            const g = p.stats?.gained || {}
            const gained = sumOf(g)
            return (
              <tr key={i} className={i === winner ? "is-winner" : ""} data-score={i}>
                <td>
                  <span className="hxScoreName">
                    <Avatar color={p.color} size={22} />
                    {names[i] || p.name}
                  </span>
                </td>
                <td>
                  {settlements} + {cities} cit{cities === 1 ? "y" : "ies"}
                </td>
                <td>
                  {[view.longest === i ? "Road" : null, view.army === i ? "Patrol" : null].filter(Boolean).join(", ") || "—"}
                </td>
                <td>{monuments || "—"}</td>
                <td className="hxScorePts">{p.points}</td>
                <td>
                  <div className="hxGainBar" title={RES.map((r) => `${RES_INFO[r].label} ${g[r] || 0}`).join(", ")}>
                    <span style={{ width: `${(gained / maxGain) * 100}%`, background: colorOf(p.color).fill }} />
                    <b>{gained}</b>
                  </div>
                  <div className="hxGainRes">
                    {RES.map((r) => (
                      <span key={r}>
                        <ResSvg r={r} size={13} />
                        {g[r] || 0}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="hxEndCharts">
        <DiceChart rolls={view.rolls} />
        <div className="hxEndFacts">
          {order.map((i) => {
            const s = view.players[i].stats
            if (!s) return null
            return (
              <p key={i}>
                <b>{names[i] || view.players[i].name}</b>: {s.trades} trade{s.trades === 1 ? "" : "s"}, {s.devBought} card{s.devBought === 1 ? "" : "s"} bought, {s.stolen} stolen, {s.discarded} discarded
              </p>
            )
          })}
        </div>
      </div>
      {footer}
    </Modal>
  )
}
