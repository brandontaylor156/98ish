import React, { useState } from "react"
import { Select } from "../../shared/select/Combo"
import Dialog from "../../shared/Dialog"
import MoreOptions from "../../shared/MoreOptions"
import * as core from "./clubCore"
import PlayerPicker, { toPlayer } from "./PlayerPicker"
import * as club from "../../../utils/pbclub"

// Matches: the ones waiting for you (confirm the score, or say it's wrong), matches waiting
// on this phone to be sent, logging a match you scored somewhere else, and your history.

const STATUS = {
  pending: "Waiting for the other team",
  confirmed: "Confirmed",
  disputed: "Score disputed",
  expired: "Nobody confirmed",
  removing: "Removal asked",
  unrated: "Not rated (guest)",
}

export const teamsText = (m, names = {}) => m.teams.map((t) => t.map((p) => core.playerName(p, { ...names, ...m.names })).join(" & ")).join("  vs  ")
export const scoreText = (m) => m.games.map(([a, b]) => `${a}-${b}`).join(", ")
const dateText = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" })

const MatchRow = ({ m, me, names, focus }) => {
  const [msg, setMsg] = useState(null)
  const won = core.matchWinner(m) === core.teamOf(m, me)
  const playing = core.teamOf(m, me) >= 0
  const run = async (what, ask) => {
    if (ask && !window.confirm(ask)) return
    const r = await club.act(m.id, what)
    if (!r.ok) setMsg(r.error)
  }
  const buttons = []
  if (core.canConfirm(m, me)) {
    buttons.push(
      <button key="c" type="button" className="pbPrimary" onClick={() => run("confirm")} data-confirm={m.id}>
        Confirm
      </button>,
      <button key="d" type="button" onClick={() => run("dispute")} data-dispute={m.id}>
        That's Wrong
      </button>
    )
  }
  if (core.canAgreeRemove(m, me))
    buttons.push(
      <button key="a" type="button" onClick={() => run("agree")}>
        Agree to Remove
      </button>,
      <button key="k" type="button" onClick={() => run("keep")}>
        Keep It
      </button>
    )
  if (m.by === me && ["pending", "disputed", "expired", "unrated"].includes(m.status))
    buttons.push(
      <button key="x" type="button" onClick={() => run(m.status === "unrated" ? "remove" : "delete", "Delete this match?")}>
        Delete
      </button>
    )
  if (m.status === "confirmed" && playing)
    buttons.push(
      <button key="r" type="button" onClick={() => run("remove", "Ask the other team to take this match off both records?")}>
        Remove...
      </button>
    )
  if (m.status === "removing" && m.removeBy === me)
    buttons.push(
      <button key="w" type="button" onClick={() => run("keep")}>
        Never Mind
      </button>
    )
  return (
    <li className={`pbMatch${focus ? " is-focus" : ""}`} data-match={m.id} data-status={m.status}>
      <div className="pbMatchTop">
        {playing && <span className={`pbWL ${won ? "is-w" : "is-l"}`}>{won ? "W" : "L"}</span>}
        <span className="pbMatchScore">{scoreText(m)}</span>
        <span className="pbMatchDate">
          {dateText(m.at)}
          {m.venue ? ` · ${core.venueName(m.venue, { short: true })}` : ""}
        </span>
      </div>
      <div className="pbMatchTeams">{teamsText(m, names)}</div>
      <div className="pbMatchStatus">{STATUS[m.status] || m.status}</div>
      {buttons.length > 0 && <div className="pbButtons">{buttons}</div>}
      {msg && <p className="pbError">{msg}</p>}
    </li>
  )
}

const LogDialog = ({ me, people, onClose }) => {
  const [kind, setKind] = useState("doubles")
  const [teams, setTeams] = useState([[me ? { k: me.k, name: me.name } : null, null], [null, null]])
  const [games, setGames] = useState([["", ""]])
  const [venue, setVenue] = useState(club.getPrefs().venue || "")
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [error, setError] = useState(null)
  const size = kind === "singles" ? 1 : 2
  const slots = teams.map((t) => t.slice(0, size))
  const taken = slots.flat().filter((p) => p?.k).map((p) => p.k)
  const save = async () => {
    const [y, mo, d] = date.split("-").map(Number)
    const at = Math.min(Date.now(), new Date(y, mo - 1, d, 12).getTime())
    const input = { kind, teams: slots.map((t) => t.map(toPlayer)), games: games.filter((g) => g[0] !== "" || g[1] !== "").map((g) => g.map(Number)), at, venue: venue ? { id: venue } : null }
    const checked = core.cleanMatch(input)
    if (!checked.ok) return setError(checked.error)
    const r = await club.logMatch(input)
    if (!r.ok) return setError(r.error)
    onClose()
  }
  return (
    <Dialog title="Log a Match" okLabel="Save" onOk={save} onCancel={onClose}>
      <div className="pbEditor">
        <label>
          Game
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="doubles">Doubles</option>
            <option value="singles">Singles</option>
          </Select>
        </label>
        {[0, 1].map((t) => (
          <fieldset key={t} className="pbTeam">
            <legend>{t === 0 ? "Your side" : "Them"}</legend>
            {slots[t].map((p, i) => (
              <PlayerPicker key={i} id={`pb-log-${t}${i}`} label={i === 0 ? "Player 1" : "Player 2"} value={p} people={people} taken={taken} onChange={(v) => setTeams(teams.map((tm, ti) => (ti === t ? Object.assign([...tm], { [i]: v }) : tm)))} />
            ))}
          </fieldset>
        ))}
        <fieldset>
          <legend>Score (your side first)</legend>
          {games.map((g, i) => (
            <div key={i} className="pbGameRow">
              Game {i + 1}
              <input type="number" inputMode="numeric" min="0" max="99" value={g[0]} aria-label={`Game ${i + 1}, your side`} onChange={(e) => setGames(games.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} data-g={`${i}-0`} />
              <span>-</span>
              <input type="number" inputMode="numeric" min="0" max="99" value={g[1]} aria-label={`Game ${i + 1}, them`} onChange={(e) => setGames(games.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} data-g={`${i}-1`} />
            </div>
          ))}
          {games.length < core.LIMITS.games && (
            <button type="button" onClick={() => setGames([...games, ["", ""]])}>
              Add a Game
            </button>
          )}
        </fieldset>
        <div className="pbRow2">
          <label>
            Where
            <Select value={venue} onChange={(e) => setVenue(e.target.value)}>
              <option value="">(somewhere else)</option>
              {core.VENUES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.short}
                </option>
              ))}
            </Select>
          </label>
          <label>
            Day
            <input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        {error && <p className="pbError">{error}</p>}
      </div>
    </Dialog>
  )
}

const Matches = ({ state, people, focus }) => {
  const [logging, setLogging] = useState(false)
  const me = state.me
  const meP = people.find((p) => p.k === me) || null
  const waiting = state.matches.filter((m) => core.canConfirm(m, me) || core.canAgreeRemove(m, me))
  const rest = state.matches.filter((m) => !waiting.includes(m))
  return (
    <div className="pbMatches">
      {waiting.length > 0 && (
        <section>
          <h4 className="pbH">Waiting for you</h4>
          <ul className="pbList">
            {waiting.map((m) => (
              <MatchRow key={m.id} m={m} me={me} names={state.names} focus={m.id === focus} />
            ))}
          </ul>
        </section>
      )}
      {state.outbox.length > 0 && (
        <section>
          <h4 className="pbH">On this phone</h4>
          <ul className="pbList">
            {state.outbox.map((i) => (
              <li key={i.match.id} className="pbMatch" data-queued>
                <div className="pbMatchTop">
                  <span className="pbMatchScore">{scoreText(i.match)}</span>
                  <span className="pbMatchDate">{dateText(i.match.at)}</span>
                </div>
                <div className="pbMatchStatus">{i.error ? `Couldn't send: ${i.error}` : "Goes up when you're online and signed on"}</div>
                <div className="pbButtons">
                  <button type="button" onClick={() => club.dropQueued(i.match.id)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="pbButtons">
        <button type="button" onClick={() => setLogging(true)} data-log>
          Log a Match...
        </button>
      </div>
      {rest.length ? (
        <ul className="pbList">
          {rest.slice(0, 60).map((m) => (
            <MatchRow key={m.id} m={m} me={me} names={state.names} focus={m.id === focus} />
          ))}
        </ul>
      ) : (
        <p className="pbMuted">No matches yet. Score a game on the Score tab (or log one here) and it shows up for everyone who played.</p>
      )}
      {rest.length > 60 && (
        <MoreOptions id="pbclub.older" label="Older matches" summary={`${rest.length - 60} more`}>
          <ul className="pbList">
            {rest.slice(60).map((m) => (
              <MatchRow key={m.id} m={m} me={me} names={state.names} />
            ))}
          </ul>
        </MoreOptions>
      )}
      {logging && <LogDialog me={meP} people={people} onClose={() => setLogging(false)} />}
    </div>
  )
}

export default Matches
