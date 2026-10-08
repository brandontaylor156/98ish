import React, { useEffect, useState } from "react"
import { currentCues } from "../pickleball/twin/coach/progress.js"
import { useLocate } from "../../../utils/locate"
import { friendsAt } from "../pickleball/park/presence.js"
import { Select } from "../../shared/select/Combo"
import Dialog from "../../shared/Dialog"
import MoreOptions from "../../shared/MoreOptions"
import PrimaryBar from "../../shared/PrimaryBar"
import * as core from "./clubCore"
import { nextRound } from "./rotation"
import { fromPid } from "./PlayerPicker"
import * as club from "../../../utils/pbclub"
import { openMaps } from "../../../utils/maps"
import { forecastUrl, shapeForecast, conditionOf, temp } from "../weather/weatherCore"

// Play sessions: "Who's in?" for a time at a court. The list, one session (RSVP, running
// late, who's coming, invite more, add to Calendar, weather, the courts' rotation and a
// little chat), and the editor.

const nameFor = (session, key, names = {}) => session.names?.[key] || names[key] || key

// ---- weather for outdoor courts (Open-Meteo, free, no key; forecasts reach 7 days) ----

const forecasts = new Map() // venue id -> Promise of a shaped forecast
const forecastFor = (venue) => {
  if (!forecasts.has(venue.id))
    forecasts.set(
      venue.id,
      fetch(forecastUrl(venue))
        .then((r) => r.json())
        .then(shapeForecast)
        .catch(() => null)
    )
  return forecasts.get(venue.id)
}
const useSessionWeather = (session) => {
  const [line, setLine] = useState(null)
  const venue = session?.venue?.id ? core.venueById(session.venue.id) : null
  useEffect(() => {
    setLine(null)
    if (!venue || venue.indoor || !session || session.start - Date.now() > 6.5 * core.DAY || session.start < Date.now() - 6 * 3_600_000) return
    let live = true
    forecastFor(venue).then((f) => {
      if (!live || !f) return
      const date = new Date(session.start).toLocaleDateString("en-CA", { timeZone: f.timezone || "America/Los_Angeles" })
      const day = f.daily.find((d) => d.date === date)
      if (!day) return
      const c = conditionOf(day.code)
      setLine(`${c.label || ""} · ${temp(day.maxC)} / ${temp(day.minC)}${Number.isFinite(day.pop) ? ` · ${day.pop}% rain` : ""}${Number.isFinite(day.windKmh) && day.windKmh > 25 ? " · windy" : ""}`)
    })
    return () => {
      live = false
    }
  }, [session?.id, session?.start, venue?.id])
  return line
}

// ---- the list ----

export const SessionList = ({ state, onOpen, onNew }) => {
  const now = Date.now()
  const upcoming = state.sessions.filter((s) => s.start + s.minutes * 60_000 > now)
  const past = state.sessions.filter((s) => s.start + s.minutes * 60_000 <= now).reverse()
  const row = (s) => {
    const lists = core.rsvpLists(s)
    const mine = core.rsvpOf(s, state.me)
    return (
      <li key={s.id}>
        <button type="button" className={`pbSessionRow${s.cancelled ? " is-cancelled" : ""}`} onClick={() => onOpen(s.id)} data-session={s.id}>
          <span className="pbSessionTitle">{s.title}</span>
          <span className="pbSessionWhen">{core.sessionWhen(s.start, s.minutes)}</span>
          <span className="pbSessionMeta">
            {s.cancelled ? "Cancelled" : `${lists.in.length}/${s.max} in${lists.waitlist.length ? ` · ${lists.waitlist.length} waiting` : ""}`}
            {mine && !s.cancelled ? ` · You: ${mine === "waitlist" ? "waitlist" : mine}` : !s.cancelled ? " · Are you in?" : ""}
          </span>
        </button>
      </li>
    )
  }
  return (
    <div className="pbSessions">
      <PrimaryBar align="stretch">
        <button type="button" className="pbBig pbPrimary" onClick={onNew} data-new-session>
          New Session...
        </button>
      </PrimaryBar>
      {upcoming.length ? <ul className="pbList">{upcoming.map(row)}</ul> : <p className="pbMuted">No sessions coming up. Start one and invite your group: they say in or out, and Pickleball Club keeps the list (and a waitlist).</p>}
      {past.length > 0 && (
        <MoreOptions id="pbclub.past" label="Past sessions" lessLabel="Hide past sessions" summary={`${past.length} in the last 30 days`}>
          <ul className="pbList">{past.map(row)}</ul>
        </MoreOptions>
      )}
    </div>
  )
}

// ---- the editor ----

const pad = (n) => String(n).padStart(2, "0")
const localDate = (t) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const localTime = (t) => {
  const d = new Date(t)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const nextHour = () => {
  const d = new Date(Date.now() + 24 * 3_600_000)
  d.setHours(18, 0, 0, 0)
  return d.getTime()
}

export const SessionEditor = ({ session, buddies, venueId, onClose, onSaved }) => {
  const s0 = session || { venue: { id: venueId || "loscab" }, start: nextHour(), minutes: 120, max: 8, courts: 2, skill: null, note: "", title: "", open: true }
  const [venue, setVenue] = useState(s0.venue?.id || "other")
  const [other, setOther] = useState({ name: s0.venue?.name || "", address: s0.venue?.address || "" })
  const [date, setDate] = useState(localDate(s0.start))
  const [time, setTime] = useState(localTime(s0.start))
  const [minutes, setMinutes] = useState(s0.minutes)
  const [max, setMax] = useState(s0.max)
  const [courts, setCourts] = useState(s0.courts)
  const [skill, setSkill] = useState(s0.skill)
  const [note, setNote] = useState(s0.note || "")
  const [title, setTitle] = useState(session ? s0.title : "")
  const [open, setOpen] = useState(s0.open !== false)
  const [invite, setInvite] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const already = new Set([...(session?.invited || []), session?.host].filter(Boolean))
  const save = async () => {
    const [y, mo, d] = date.split("-").map(Number)
    const [h, mi] = time.split(":").map(Number)
    const start = new Date(y, mo - 1, d, h, mi).getTime()
    const input = { venue: venue === "other" ? other : { id: venue }, start, minutes, max, courts, skill, note, title, open }
    const checked = core.cleanSession(input)
    if (!checked.ok) return setError(checked.error)
    setBusy(true)
    const result = await club.saveSession(input, { id: session?.id || null, invite })
    setBusy(false)
    if (!result.ok) return setError(result.error)
    onSaved?.(result.session)
    onClose()
  }
  return (
    <Dialog title={session ? "Change Session" : "New Session"} onOk={save} onCancel={onClose} okLabel={session ? "Save" : "Create"} okDisabled={busy}>
      <div className="pbEditor">
        <label>
          Where
          <Select value={venue} onChange={(e) => setVenue(e.target.value)} data-venue>
            {core.VENUES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.short}
                {v.indoor ? " (indoor)" : ""}
              </option>
            ))}
            <option value="other">Somewhere else...</option>
          </Select>
        </label>
        {venue === "other" && (
          <>
            <input type="text" maxLength={60} placeholder="Court name" value={other.name} onChange={(e) => setOther({ ...other, name: e.target.value })} aria-label="Court name" />
            <input type="text" maxLength={120} placeholder="Address (optional)" value={other.address} onChange={(e) => setOther({ ...other, address: e.target.value })} aria-label="Address" />
          </>
        )}
        <div className="pbRow2">
          <label>
            Day
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-date />
          </label>
          <label>
            Time
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} data-time />
          </label>
        </div>
        <div className="pbRow2">
          <label>
            Players
            <Select value={max} onChange={(e) => setMax(Number(e.target.value))}>
              {[2, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 20, 24, 32].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
          <label>
            How long
            <Select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {[60, 90, 120, 150, 180, 240].map((n) => (
                <option key={n} value={n}>
                  {n % 60 ? `${Math.floor(n / 60)}h ${n % 60}m` : `${n / 60} hour${n > 60 ? "s" : ""}`}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {buddies.length > 0 && (
          <fieldset className="pbInvite">
            <legend>Invite</legend>
            <div className="pbInviteList">
              {buddies
                .filter((b) => !already.has(b.k))
                .map((b) => (
                  <label key={b.k} className="pbCheck">
                    <input type="checkbox" checked={invite.includes(b.name)} onChange={(e) => setInvite(e.target.checked ? [...invite, b.name] : invite.filter((n) => n !== b.name))} data-invite={b.k} />
                    {b.name}
                  </label>
                ))}
            </div>
          </fieldset>
        )}
        <MoreOptions id="pbclub.session" summary={[title || null, `${courts} court${courts > 1 ? "s" : ""}`, skill ? `${skill.min}-${skill.max}` : "any level", open ? "invitees can invite" : "only you invite"].filter(Boolean).join(" · ")}>
          <label>
            Name
            <input type="text" maxLength={60} placeholder={`Open play at ${core.venueName({ id: venue }, { short: true })}`} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Courts
            <Select value={courts} onChange={(e) => setCourts(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
          <div className="pbRow2">
            <label>
              Level from
              <Select value={skill?.min ?? ""} onChange={(e) => setSkill(e.target.value ? { min: Number(e.target.value), max: Math.max(Number(e.target.value), skill?.max ?? 6) } : null)}>
                <option value="">Any</option>
                {core.SKILLS.map((v) => (
                  <option key={v} value={v}>
                    {v.toFixed(1)}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              to
              <Select value={skill?.max ?? ""} disabled={!skill} onChange={(e) => setSkill({ ...skill, max: Number(e.target.value) })}>
                {core.SKILLS.filter((v) => !skill || v >= skill.min).map((v) => (
                  <option key={v} value={v}>
                    {v.toFixed(1)}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <label>
            Note
            <textarea maxLength={core.LIMITS.note} rows={2} placeholder="Bring balls? Court 4-6 reserved?" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="pbCheck">
            <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
            People you invite can invite others
          </label>
        </MoreOptions>
        {error && <p className="pbError">{error}</p>}
      </div>
    </Dialog>
  )
}

// ---- one session ----

const addToCalendar = async (session) => {
  try {
    const [cal, util] = await Promise.all([import("../calendar/store"), import("../calendar/util")])
    const id = cal.pickDefault()
    const venue = core.venueName(session.venue)
    const event = {
      ...util.blankEvent({ date: localDate(session.start), zone: cal.zone(), calendarId: id }),
      allDay: false,
      title: `🏓 ${session.title}`,
      start: session.start,
      end: session.start + session.minutes * 60_000,
      location: [venue, core.venueAddress(session.venue)].filter(Boolean).join(", "),
      notes: session.note || "Pickleball 98 · Real Games",
      reminders: [60],
    }
    return await cal.saveEvent(id, event)
  } catch {
    return { ok: false, error: "Calendar didn't answer. Try again." }
  }
}

const Courts = ({ session, me, names, onScore }) => {
  const lists = core.rsvpLists(session)
  const players = lists.in.map((k) => `k:${k}`)
  const rot = session.rotation
  const canRun = session.host === me || lists.in.includes(me)
  const [mode, setMode] = useState(rot?.mode || "mix")
  const [busy, setBusy] = useState(false)
  const label = (id) => (id.startsWith("k:") ? nameFor(session, id.slice(2), names) : id.slice(2))
  const round = rot?.rounds?.[rot.rounds.length - 1] || null
  const results = rot?.results?.[rot.rounds.length - 1] || []
  const groups = rot?.groups || {}
  const push = async (next) => {
    setBusy(true)
    await club.setRotation(session.id, next)
    setBusy(false)
  }
  const next = () => {
    const history = rot?.mode === mode ? rot.rounds || [] : []
    const seed = rot?.seed || Math.floor(Math.random() * 1e9)
    const r = nextRound(history, players, { mode, courts: session.courts || 1, seed, results, groups })
    push({ mode, seed, rounds: [...history, r].slice(-30), results: [...(rot?.mode === mode ? rot.results || [] : []).slice(0, history.length), []].slice(-30), groups })
  }
  const setResult = (court, w) => {
    const all = [...(rot.results || [])]
    const i = rot.rounds.length - 1
    all[i] = Object.assign([...(all[i] || [])], { [court]: w })
    push({ ...rot, results: all })
  }
  const toggleGroup = (id) => push({ ...(rot || { mode, seed: Math.floor(Math.random() * 1e9), rounds: [], results: [] }), groups: { ...groups, [id]: groups[id] === "A" ? "B" : "A" } })
  if (players.length < 4) return <p className="pbMuted">Rotations start once 4 people are in.</p>
  return (
    <div className="pbCourts" data-courts>
      {round ? (
        <>
          <div className="pbRoundHead">
            Round {rot.rounds.length}
            {round.sitting.length ? ` · sitting: ${round.sitting.map(label).join(", ")}` : ""}
          </div>
          {round.courts.map((c, i) => (
            <div key={i} className="pbCourtCard" data-court={c.court}>
              <b>Court {c.court}</b>
              <div className="pbVs">
                {[0, 1].map((t) => (
                  <button key={t} type="button" className={`pbSide${results[i] === t ? " is-winner" : ""}`} disabled={!canRun || busy || rot.mode !== "king"} onClick={() => setResult(i, t)} title={rot.mode === "king" ? "Tap the winners" : undefined}>
                    {c.teams[t].map(label).join(" & ")}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => onScore({ teams: c.teams.map((tm) => tm.map((id) => fromPid(id, session.names))), venue: session.venue, session: session.id })} data-score-court={c.court}>
                Score this game
              </button>
            </div>
          ))}
        </>
      ) : (
        <p className="pbMuted">Make the first round: everyone in gets a court, and whoever sits rotates fairly.</p>
      )}
      {canRun && (
        <div className="pbRoundTools">
          <Select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="How to rotate">
            <option value="mix">Mix it up (new partners)</option>
            <option value="king">King of the court</option>
            <option value="mixed">Two groups (mixed doubles)</option>
          </Select>
          <button type="button" className="pbPrimary" disabled={busy} onClick={next} data-next-round>
            {round ? "Next Round" : "Make Courts"}
          </button>
        </div>
      )}
      {canRun && mode === "mixed" && (
        <div className="pbGroups">
          <span>Tap to switch groups:</span>
          {players.map((id) => (
            <button key={id} type="button" className={`pbGroup is-${groups[id] === "A" ? "a" : "b"}`} onClick={() => toggleGroup(id)}>
              {label(id)} ({groups[id] === "A" ? "A" : "B"})
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export const SessionView = ({ session, state, buddies, onBack, onScore, onEdit }) => {
  const me = state.me
  const lists = core.rsvpLists(session)
  const mine = core.rsvpOf(session, me)
  const weather = useSessionWeather(session)
  const [text, setText] = useState("")
  const [msg, setMsg] = useState(null)
  const [inviting, setInviting] = useState(false)
  const [pick, setPick] = useState([])
  const links = core.mapsLinks(session.venue)
  const venue = session.venue?.id ? core.venueById(session.venue.id) : null
  const host = session.host === me
  const canInvite = host || session.open
  const started = Date.now() >= session.start - 30 * 60_000
  const name = (k) => nameFor(session, k, state.names)
  // Live Venue Presence: who's physically at this session's court right now: friends who share
  // their location with you (Buddy Locator), and you. Nothing new is shared: it's what your
  // Buddy Locator already shows you, matched to this venue.
  const loc = useLocate()
  const venueId = session.venue?.id || null
  const meHere = !!venueId && loc.me?.venue?.id === venueId && !loc.me.venue.nearby
  const liveHere = new Set(venueId ? friendsAt(loc.friends, venueId).here.map((f) => f.key) : [])
  if (meHere && me) liveHere.add(me)
  const sessionNow = Date.now() > session.start - 2 * 3_600_000 && Date.now() < session.start + (session.minutes || 120) * 60_000
  const person = (k) => (
    <li key={k}>
      {name(k)}
      {k === session.host ? " (host)" : ""}
      {session.rsvps?.[k]?.late ? <span className="pbLate"> · {core.lateText(session.rsvps[k].late)}</span> : null}
      {liveHere.has(k) && session.rsvps?.[k]?.late !== "here" ? (
        <span className="pbHereLive" data-here-live={k}>
          {" "}
          · here now
        </span>
      ) : null}
    </li>
  )
  const answer = async (s) => {
    const r = await club.rsvp(session.id, s)
    if (!r.ok) setMsg(r.error)
  }
  const late = async (v) => {
    const r = await club.rsvp(session.id, null, v)
    if (!r.ok) setMsg(r.error)
  }
  const unanswered = (session.invited || []).filter((k) => !session.rsvps?.[k])
  // (Coach, in Pickleball 98's Twin Replay: the top three things to remember on court)
  const cues = currentCues()
  return (
    <div className="pbSessionView" data-session-view={session.id}>
      <button type="button" className="pbBack" onClick={onBack}>
        ‹ Sessions
      </button>
      <h3 className="pbH">{session.title}</h3>
      <div className="pbFacts">
        <div>{core.sessionWhen(session.start, session.minutes)}</div>
        <div>
          {core.venueName(session.venue)}
          {venue ? ` · ${venue.indoor ? "Indoor" : "Outdoor"}` : ""} ·{" "}
          {venue ? (
            // one of the courts we know: Maps 98 (utils/maps.js), directions from where you are
            <button type="button" className="pbLinkBtn" onClick={() => openMaps({ name: venue.name, lat: venue.lat, lon: venue.lon, address: venue.address, directions: true })} data-directions={venue.id}>
              Directions
            </button>
          ) : (
            // (your own place, no coordinates: look it up)
            <>
              <a href={links.apple} target="_blank" rel="noreferrer">
                Apple Maps
              </a>{" "}
              ·{" "}
              <a href={links.google} target="_blank" rel="noreferrer">
                Google Maps
              </a>
            </>
          )}
        </div>
        {weather && <div data-weather>Weather: {weather}</div>}
        {session.skill && (
          <div>
            Level {session.skill.min.toFixed(1)} to {session.skill.max.toFixed(1)}
          </div>
        )}
        {session.note && <div className="pbNote">{session.note}</div>}
        {session.cancelled && <div className="pbError">This session was cancelled.</div>}
      </div>
      {cues.length > 0 && !session.cancelled && (
        <div className="pbCues" data-coach-cues>
          <b>Your Coach's cues for today</b>
          <ol>
            {cues.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
        </div>
      )}
      {!session.cancelled && (
        <div className="pbRsvp" role="group" aria-label="Are you in?">
          {["in", "maybe", "out"].map((s) => (
            <button key={s} type="button" className={`pbBig${(mine === s || (s === "in" && mine === "waitlist")) ? " is-on" : ""}`} aria-pressed={mine === s || (s === "in" && mine === "waitlist")} onClick={() => answer(s)} data-rsvp={s}>
              {s === "in" ? "I'm in" : s === "maybe" ? "Maybe" : "Can't"}
            </button>
          ))}
        </div>
      )}
      {mine === "waitlist" && <p className="pbNote">You're on the waitlist (#{lists.waitlist.indexOf(me) + 1}). You'll be told if a spot opens.</p>}
      {(mine === "in" || mine === "waitlist") && !session.cancelled && Date.now() > session.start - 3 * 3_600_000 && (
        <div className="pbLateRow" role="group" aria-label="Running late">
          <span>Running late?</span>
          {core.LATE.map((m) => (
            <button key={m} type="button" aria-pressed={session.rsvps?.[me]?.late === m} onClick={() => late(m)}>
              {m} min
            </button>
          ))}
          <button type="button" aria-pressed={session.rsvps?.[me]?.late === "here"} onClick={() => late("here")}>
            I'm here
          </button>
        </div>
      )}
      {meHere && sessionNow && (mine === "in" || mine === "waitlist") && session.rsvps?.[me]?.late !== "here" && !session.cancelled && (
        <p className="pbCheckIn" data-check-in>
          You're at {core.venueName(session.venue, { short: true })}.{" "}
          <button type="button" onClick={() => late("here")} data-check-in-btn>
            Check in
          </button>
        </p>
      )}
      {msg && <p className="pbError">{msg}</p>}
      <div className="pbWho">
        <div>
          <b>
            In ({lists.in.length}/{session.max})
          </b>
          <ul>{lists.in.map(person)}</ul>
        </div>
        {lists.waitlist.length > 0 && (
          <div>
            <b>Waitlist</b>
            <ol>{lists.waitlist.map(person)}</ol>
          </div>
        )}
        {(lists.maybe.length > 0 || unanswered.length > 0 || lists.out.length > 0) && (
          <div className="pbMuted">
            {lists.maybe.length > 0 && <div>Maybe: {lists.maybe.map(name).join(", ")}</div>}
            {unanswered.length > 0 && <div>Haven't answered: {unanswered.map(name).join(", ")}</div>}
            {lists.out.length > 0 && <div>Can't: {lists.out.map(name).join(", ")}</div>}
          </div>
        )}
      </div>
      {!session.cancelled && (started || session.rotation) && <Courts session={session} me={me} names={state.names} onScore={onScore} />}
      <div className="pbChat">
        <b>Chat</b>
        <ul className="pbChatList" data-selectable>
          {(session.chat || []).slice(-30).map((c, i) => (
            <li key={i}>
              <b>{name(c.k)}:</b> {c.t}
            </li>
          ))}
        </ul>
        {!session.cancelled && (
          <form
            className="pbChatForm"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!text.trim()) return
              const r = await club.say(session.id, text)
              if (r.ok) setText("")
              else setMsg(r.error)
            }}
          >
            <input type="text" maxLength={core.LIMITS.chatText} value={text} placeholder="Bringing balls, court 3..." onChange={(e) => setText(e.target.value)} aria-label="Message" data-chat />
            <button type="submit">Send</button>
          </form>
        )}
      </div>
      <MoreOptions id="pbclub.sessionMore" summary={[canInvite ? "Invite more" : null, "Add to Calendar", host ? "Change, Cancel" : null, !started && !session.rotation ? "Courts" : null].filter(Boolean).join(" · ")}>
        <div className="pbButtons">
          {canInvite && !session.cancelled && (
            <button type="button" onClick={() => setInviting(true)} data-invite-more>
              Invite More...
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              const r = await addToCalendar(session)
              setMsg(r.ok ? "Added to your calendar (reminder an hour before)." : r.error)
            }}
          >
            Add to Calendar
          </button>
          {host && !session.cancelled && (
            <>
              <button type="button" onClick={onEdit}>
                Change...
              </button>
              <button type="button" onClick={() => window.confirm("Cancel this session for everyone?") && club.cancel(session.id)}>
                Cancel Session
              </button>
            </>
          )}
        </div>
        {!session.cancelled && !started && !session.rotation && <Courts session={session} me={me} names={state.names} onScore={onScore} />}
      </MoreOptions>
      {inviting && (
        <Dialog
          title="Invite More"
          okLabel="Invite"
          okDisabled={!pick.length}
          onCancel={() => setInviting(false)}
          onOk={async () => {
            const r = await club.invite(session.id, pick)
            setInviting(false)
            setPick([])
            setMsg(r.ok ? (r.added?.length ? `Invited ${r.added.join(", ")}.` : "They were already invited.") : r.error)
          }}
        >
          <div className="pbInviteList">
            {buddies
              .filter((b) => b.k !== session.host && !(session.invited || []).includes(b.k))
              .map((b) => (
                <label key={b.k} className="pbCheck">
                  <input type="checkbox" checked={pick.includes(b.name)} onChange={(e) => setPick(e.target.checked ? [...pick, b.name] : pick.filter((n) => n !== b.name))} />
                  {b.name}
                </label>
              ))}
            {!buddies.length && <p className="pbMuted">Add people to your Buddy List first.</p>}
          </div>
        </Dialog>
      )}
    </div>
  )
}
