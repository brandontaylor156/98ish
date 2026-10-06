import React, { useEffect, useRef, useState } from "react"
import MoreOptions from "../../shared/MoreOptions"
import PrimaryBar from "../../shared/PrimaryBar"
import CourtDiagram from "./CourtDiagram"
import PlayerPicker, { nameOf, toPlayer } from "./PlayerPicker"
import { call, matchState, newGame, rally, sayCall } from "./scoring"
import { VENUES } from "./clubCore"
import { getPrefs, logMatch, setPrefs } from "../../../utils/pbclub"

// The courtside scorekeeper: pick the players, then tap who won each rally. It keeps the
// score call, who serves from where, ends switches and games, says the score out loud if you
// like (the phone's own voice, nothing sent anywhere), keeps the screen awake, and survives a
// reload or a locked phone (the game in progress is saved on this device). Saving logs the
// match for the friends' ratings (queued while offline).

const LIVE = "98ish.pbclub.live"
const COLORS = ["#1f5fbf", "#b0301f"]

const loadLive = () => {
  try {
    const v = JSON.parse(localStorage.getItem(LIVE))
    return v?.stack?.length ? v : null
  } catch {
    return null
  }
}
const saveLive = (v) => {
  try {
    if (v) localStorage.setItem(LIVE, JSON.stringify(v))
    else localStorage.removeItem(LIVE)
  } catch {
    // storage blocked: the game lasts while the window is open
  }
}

const speak = (text, on) => {
  if (!on || typeof window === "undefined" || !window.speechSynthesis || !text) return
  try {
    window.speechSynthesis.cancel()
    const u = new window.SpeechSynthesisUtterance(text)
    u.rate = 1.05
    window.speechSynthesis.speak(u)
  } catch {
    // no voice on this device
  }
}

// a screen wake lock while a game is going (taken again when 98ish comes back to the front)
const useWakeLock = (on) => {
  useEffect(() => {
    if (!on || typeof navigator === "undefined" || !("wakeLock" in navigator)) return
    let lock = null
    let alive = true
    const take = async () => {
      if (document.visibilityState !== "visible" || lock) return
      try {
        lock = await navigator.wakeLock.request("screen")
        lock.addEventListener("release", () => (lock = null))
        if (!alive) lock.release().catch(() => {})
      } catch {
        // not allowed right now
      }
    }
    take()
    document.addEventListener("visibilitychange", take)
    return () => {
      alive = false
      document.removeEventListener("visibilitychange", take)
      lock?.release().catch(() => {})
    }
  }, [on])
}

const teamName = (players) => players.map(nameOf).join(" & ")

const Scorekeeper = ({ me, people, prefill, onSaved }) => {
  const prefs = getPrefs()
  const [cfg, setCfg] = useState({ format: prefs.format, scoring: prefs.scoring, to: prefs.to, bestOf: prefs.bestOf, winBy: prefs.winBy, freeze: prefs.freeze, first: 0, venue: prefs.venue || "" })
  const [voice, setVoice] = useState(prefs.voice)
  const [players, setPlayers] = useState(() => [[me ? { k: me.k, name: me.name } : null, null], [null, null]])
  const [session, setSession] = useState(null)
  const [live, setLive] = useState(loadLive)
  const [banner, setBanner] = useState(null)
  const [saved, setSaved] = useState(null) // { text, error }
  const [busy, setBusy] = useState(false)
  const bannerTimer = useRef(null)

  // a game handed over from a session's courts
  useEffect(() => {
    if (!prefill?.id) return
    setPlayers(prefill.teams)
    setCfg((c) => ({ ...c, format: prefill.teams[0].length === 1 ? "singles" : "doubles", venue: prefill.venue?.id || c.venue }))
    setSession(prefill.session || null)
    setSaved(null)
  }, [prefill?.id])

  useEffect(() => saveLive(live), [live])
  useWakeLock(!!live && !live.done)

  const size = cfg.format === "singles" ? 1 : 2
  const slots = players.map((t) => t.slice(0, size))
  const taken = slots.flat().filter((p) => p?.k).map((p) => p.k)
  const ready = slots.every((t) => t.length === size && t.every((p) => p && (p.k || (p.g !== undefined && p.g.trim()))))

  const flash = (text) => {
    setBanner(text)
    clearTimeout(bannerTimer.current)
    bannerTimer.current = setTimeout(() => setBanner(null), 2600)
  }
  useEffect(() => () => clearTimeout(bannerTimer.current), [])

  const start = () => {
    if (!ready) return
    setPrefs({ format: cfg.format, scoring: cfg.scoring, to: cfg.to, bestOf: cfg.bestOf, winBy: cfg.winBy, freeze: cfg.freeze, venue: cfg.venue, voice })
    const g = newGame(cfg)
    const names = slots.map((t) => t.map(nameOf))
    setLive({ cfg, players: slots, names, games: [], stack: [g], bottom: 0, startedAt: Date.now(), session, venue: cfg.venue || null })
    setSaved(null)
    speak(`${teamName(slots[cfg.first])} to serve. ${call(g).split("-").join(", ")}.`, voice)
  }

  const current = live?.stack[live.stack.length - 1]
  const match = live ? matchState(live.games, live.cfg.bestOf) : null

  const tap = (team) => {
    if (!current || current.over) return
    const { state, events } = rally(current, team)
    const next = { ...live, stack: [...live.stack, state].slice(-400) }
    if (events.includes("switch")) next.bottom = 1 - live.bottom
    if (state.over) next.games = [...live.games, state.score]
    setLive(next)
    if (navigator.vibrate) navigator.vibrate(state.over ? [60, 40, 60] : 25)
    if (events.includes("switch")) flash("Switch ends!")
    else if (events.includes("sideout")) flash("Side out")
    else if (events.includes("second")) flash("Second server")
    speak(sayCall(state, events, live.names.map((t) => t.join(" and "))), voice)
  }

  const undo = () => {
    if (!live || live.stack.length < 2) return
    const prev = live.stack[live.stack.length - 2]
    const wasOver = current.over
    const switchedBack = current.switched && !prev.switched
    setLive({ ...live, stack: live.stack.slice(0, -1), games: wasOver ? live.games.slice(0, -1) : live.games, bottom: switchedBack ? 1 - live.bottom : live.bottom })
    speak(`Undo. ${call(prev).split("-").join(", ")}.`, voice)
  }

  const nextGame = () => {
    // the other team serves first in the next game
    const first = 1 - live.stack[0].cfg.first
    const g = newGame({ ...live.cfg, first })
    setLive({ ...live, stack: [g], cfg: { ...live.cfg, first }, bottom: 1 - live.bottom })
    speak(`Game ${live.games.length + 1}. ${teamName(live.players[first])} to serve. ${call(g).split("-").join(", ")}.`, voice)
  }

  const save = async () => {
    setBusy(true)
    const result = await logMatch({
      kind: live.cfg.format,
      teams: live.players.map((t) => t.map(toPlayer)),
      games: live.games,
      at: live.startedAt,
      venue: live.venue ? { id: live.venue } : null,
      to: live.cfg.to,
      session: live.session || null,
    })
    setBusy(false)
    if (!result.ok) return setSaved({ error: result.error })
    const status = result.match?.status
    setSaved({ text: result.queued ? "Saved on this phone. It goes up to your group when you're back online." : status === "pending" ? "Saved! It counts once someone on the other team confirms it." : status === "unrated" ? "Saved to your record (a guest played, so it's not in the ratings)." : "Saved!" })
    setLive(null)
    onSaved?.()
  }
  const discard = () => {
    if (live.games.length || live.stack.length > 1) {
      if (!window.confirm("Throw away this game's score?")) return
    }
    setLive(null)
  }

  if (live && current) {
    const top = 1 - live.bottom
    const teamButton = (team) => (
      <button type="button" className="pbRally" style={{ "--team": COLORS[team] }} disabled={current.over} onClick={() => tap(team)} data-rally={team}>
        <span className="pbRallyNames">{live.names[team].join(" & ")}</span>
        <span className="pbRallySub">won the rally{current.serving === team ? " (serving)" : ""}</span>
      </button>
    )
    return (
      <div className="pbScore" data-live>
        <div className="pbScoreHead">
          <div className="pbCall" data-call={call(current)} aria-live="polite">
            {current.over ? `${Math.max(...current.score)}-${Math.min(...current.score)}` : call(current)}
          </div>
          <div className="pbScoreMeta">
            <span>
              Game {live.games.length + (current.over ? 0 : 1)}
              {live.cfg.bestOf > 1 ? ` · ${match.won[0]}-${match.won[1]} in games` : ""}
            </span>
            <span>
              {live.cfg.scoring === "rally" ? "Rally scoring" : "Side-out"} to {live.cfg.to}
            </span>
          </div>
        </div>
        {banner && (
          <div className="pbBanner" role="status">
            {banner}
          </div>
        )}
        <div className="pbCourtWrap">
          <CourtDiagram state={current} names={live.names} bottom={live.bottom} colors={COLORS} />
        </div>
        {current.over ? (
          <div className="pbOver" data-over>
            <b>
              Game! {live.names[current.winner].join(" & ")} win {Math.max(...current.score)}-{Math.min(...current.score)}.
            </b>
            {match.over ? <span>{live.cfg.bestOf > 1 ? `Match to ${live.names[match.winner].join(" & ")}, ${match.won[match.winner]}-${match.won[1 - match.winner]}.` : ""}</span> : <span>Best of {live.cfg.bestOf}: next game.</span>}
            <PrimaryBar align="stretch">
              {match.over ? (
                <button type="button" className="pbBig pbPrimary" disabled={busy} onClick={save} data-save>
                  Save Match
                </button>
              ) : (
                <button type="button" className="pbBig pbPrimary" onClick={nextGame} data-next>
                  Next Game
                </button>
              )}
            </PrimaryBar>
            {saved?.error && <p className="pbError">{saved.error}</p>}
          </div>
        ) : (
          <div className="pbRallies">
            {teamButton(top)}
            {teamButton(live.bottom)}
          </div>
        )}
        <div className="pbScoreTools">
          <button type="button" onClick={undo} disabled={live.stack.length < 2} data-undo>
            ↶ Undo
          </button>
          <button
            type="button"
            aria-pressed={voice}
            onClick={() => {
              setVoice(!voice)
              setPrefs({ voice: !voice })
            }}
          >
            {voice ? "🔊 Voice on" : "🔈 Voice off"}
          </button>
          <button type="button" onClick={() => setLive({ ...live, bottom: 1 - live.bottom })} title="Show the other end of the court at the bottom">
            ⇅ Flip
          </button>
          <button type="button" onClick={discard}>
            End
          </button>
        </div>
      </div>
    )
  }

  const summary = [cfg.format === "singles" ? "Singles" : "Doubles", cfg.scoring === "rally" ? "rally scoring" : "side-out", `to ${cfg.to}`, cfg.bestOf > 1 ? `best of ${cfg.bestOf}` : null, voice ? "voice on" : null].filter(Boolean).join(" · ")
  return (
    <form className="pbSetup" onSubmit={(e) => (e.preventDefault(), start())}>
      {saved?.text && (
        <p className="pbSaved" role="status" data-saved>
          {saved.text}
        </p>
      )}
      {[0, 1].map((t) => (
        <fieldset key={t} className="pbTeam" style={{ "--team": COLORS[t] }}>
          <legend>{size === 1 ? (t === 0 ? "Player A" : "Player B") : t === 0 ? "Team A" : "Team B"}</legend>
          {slots[t].map((p, i) => (
            <PlayerPicker
              key={i}
              id={`pb-p${t}${i}`}
              label={size === 1 ? "Player" : i === 0 ? "Player 1" : "Player 2"}
              value={p}
              people={people}
              taken={taken}
              onChange={(v) => setPlayers(players.map((tm, ti) => (ti === t ? Object.assign([...tm], { [i]: v }) : tm)))}
            />
          ))}
        </fieldset>
      ))}
      <div className="field-row-stacked">
        <label htmlFor="pb-venue">Where</label>
        <select id="pb-venue" value={cfg.venue} onChange={(e) => setCfg({ ...cfg, venue: e.target.value })}>
          <option value="">(somewhere else)</option>
          {VENUES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.short}
            </option>
          ))}
        </select>
      </div>
      <MoreOptions id="pbclub.score" summary={summary}>
        <div className="pbOpts">
          <label>
            Game
            <select value={cfg.format} onChange={(e) => setCfg({ ...cfg, format: e.target.value })}>
              <option value="doubles">Doubles</option>
              <option value="singles">Singles</option>
            </select>
          </label>
          <label>
            Scoring
            <select value={cfg.scoring} onChange={(e) => setCfg({ ...cfg, scoring: e.target.value })}>
              <option value="sideout">Side-out (traditional)</option>
              <option value="rally">Rally (every rally scores)</option>
            </select>
          </label>
          <label>
            Play to
            <select value={cfg.to} onChange={(e) => setCfg({ ...cfg, to: Number(e.target.value) })}>
              <option value={11}>11</option>
              <option value={15}>15</option>
              <option value={21}>21</option>
            </select>
          </label>
          <label>
            Win by
            <select value={cfg.winBy} onChange={(e) => setCfg({ ...cfg, winBy: Number(e.target.value) })}>
              <option value={2}>2</option>
              <option value={1}>1</option>
            </select>
          </label>
          <label>
            Match
            <select value={cfg.bestOf} onChange={(e) => setCfg({ ...cfg, bestOf: Number(e.target.value) })}>
              <option value={1}>One game</option>
              <option value={3}>Best of 3</option>
              <option value={5}>Best of 5</option>
            </select>
          </label>
          <label>
            Serves first
            <select value={cfg.first} onChange={(e) => setCfg({ ...cfg, first: Number(e.target.value) })}>
              <option value={0}>{size === 1 ? "Player A" : "Team A"}</option>
              <option value={1}>{size === 1 ? "Player B" : "Team B"}</option>
            </select>
          </label>
          {cfg.scoring === "rally" && (
            <label className="pbCheck">
              <input type="checkbox" checked={cfg.freeze} onChange={(e) => setCfg({ ...cfg, freeze: e.target.checked })} />
              Win only on your serve
            </label>
          )}
          <label className="pbCheck">
            <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} />
            Say the score out loud
          </label>
        </div>
      </MoreOptions>
      <PrimaryBar align="stretch">
        <button type="submit" className="pbBig pbPrimary" disabled={!ready} data-start>
          Start Game
        </button>
      </PrimaryBar>
      {!ready && <p className="pbMuted">Pick {size === 1 ? "both players" : "all four players"} (a guest is fine).</p>}
    </form>
  )
}

export default Scorekeeper
