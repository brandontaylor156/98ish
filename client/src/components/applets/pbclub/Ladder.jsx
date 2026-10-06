import React, { useMemo, useState } from "react"
import MoreOptions from "../../shared/MoreOptions"
import * as core from "./clubCore"
import * as club from "../../../utils/pbclub"

// The friends' ladder (everyone you've played or planned with) and your own numbers: record,
// streaks, form, best partners, head-to-head.

const SEASONS = [
  ["0", "All time"],
  ["year", "This year"],
  ["90", "Last 90 days"],
  ["30", "Last 30 days"],
]
const seasonStart = (v) => {
  if (v === "year") return new Date(new Date().getFullYear(), 0, 1).getTime()
  if (v === "90" || v === "30") return Date.now() - Number(v) * core.DAY
  return 0
}

const Ladder = ({ state }) => {
  const [kind, setKind] = useState("doubles")
  const [season, setSeason] = useState("0")
  const table = core.ladder(state.ladder?.[kind] || {})
  const stats = useMemo(() => core.statsFor(state.me, state.matches, state.names), [state.matches, state.me, state.names])
  const name = (id) => (id.startsWith("k:") ? state.names[id.slice(2)] || id.slice(2) : id.slice(2))
  const partners = Object.entries(stats.partners).sort((a, b) => b[1].w - b[1].l - (a[1].w - a[1].l) || b[1].diff - a[1].diff)
  const rivals = Object.entries(stats.opponents).sort((a, b) => b[1].w + b[1].l - (a[1].w + a[1].l))
  const changeSeason = (v) => {
    setSeason(v)
    club.setSeason(seasonStart(v))
  }
  return (
    <div className="pbLadder">
      <div className="pbSeg" role="group" aria-label="Ratings for">
        {["doubles", "singles"].map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k === "doubles" ? "Doubles" : "Singles"}
          </button>
        ))}
        <select value={season} onChange={(e) => changeSeason(e.target.value)} aria-label="Season">
          {SEASONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {table.length ? (
        <table className="pbTable" data-ladder>
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th title="98 rating (starts at 1500)">Rating</th>
              <th title="About this level">Level</th>
              <th title="Games won-lost">Games</th>
            </tr>
          </thead>
          <tbody>
            {table.map((row, i) => (
              <tr key={row.id} className={row.id === `k:${state.me}` ? "is-me" : ""}>
                <td>{i + 1}</td>
                <td>
                  {name(row.id)}
                  {row.games < core.RATING.newGames ? <span className="pbMuted"> (new)</span> : null}
                </td>
                <td>{row.r}</td>
                <td>≈{row.level.toFixed(1)}</td>
                <td>
                  {row.w}-{row.l}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="pbMuted">No rated {kind} games yet. Matches count once the other team confirms them (games with guests aren't rated).</p>
      )}
      <section className="pbMe">
        <h4 className="pbH">You</h4>
        <div className="pbStatGrid">
          <div>
            <b>
              {stats.w}-{stats.l}
            </b>
            <span>matches</span>
          </div>
          <div>
            <b>
              {stats.gw}-{stats.gl}
            </b>
            <span>games</span>
          </div>
          <div>
            <b>{core.streakText(stats.streak) || "-"}</b>
            <span>streak</span>
          </div>
          <div>
            <b>{stats.best ? `W${stats.best}` : "-"}</b>
            <span>best run</span>
          </div>
        </div>
        {stats.form && (
          <div className="pbForm" aria-label="Last 10 matches">
            {stats.form.split("").map((c, i) => (
              <span key={i} className={c === "W" ? "is-w" : "is-l"}>
                {c}
              </span>
            ))}
          </div>
        )}
        <MoreOptions id="pbclub.stats" summary={`${partners.length} partners · ${rivals.length} opponents · ${stats.pf}-${stats.pa} points`}>
          {partners.length > 0 && (
            <>
              <b>Best partners</b>
              <ul className="pbMiniList">
                {partners.slice(0, 8).map(([id, p]) => (
                  <li key={id}>
                    {p.name}: {p.w}-{p.l} ({p.diff >= 0 ? "+" : ""}
                    {p.diff} points)
                  </li>
                ))}
              </ul>
            </>
          )}
          {rivals.length > 0 && (
            <>
              <b>Head-to-head</b>
              <ul className="pbMiniList">
                {rivals.slice(0, 12).map(([id, p]) => (
                  <li key={id}>
                    vs {p.name}: {p.w}-{p.l}
                  </li>
                ))}
              </ul>
            </>
          )}
          {Object.keys(stats.venues).length > 0 && (
            <>
              <b>Where you play</b>
              <ul className="pbMiniList">
                {Object.entries(stats.venues)
                  .sort((a, b) => b[1] - a[1])
                  .map(([v, n]) => (
                    <li key={v}>
                      {v}: {n}
                    </li>
                  ))}
              </ul>
            </>
          )}
          <p className="pbMuted">Ratings: a friends-only Elo from every confirmed game (a blowout counts a bit more than 11-10; in doubles the stronger partner is expected to win more). The level is a rough guide, not an official rating.</p>
        </MoreOptions>
      </section>
    </div>
  )
}

export default Ladder
