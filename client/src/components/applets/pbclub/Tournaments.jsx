import React, { useEffect, useMemo, useState } from "react"
import { Select } from "../../shared/select/Combo"
import MoreOptions from "../../shared/MoreOptions"
import * as T from "./tourneyCore"
import * as net from "../../../utils/tourney"
import "./Tournaments.css"
import { ScoreBug } from "./ScoreBug"

// Real Games > Tournaments (and My Park's tournament chip): the week's events at the real
// venues (original names; tourneyCore.js), signing up with a partner, the bracket drawn like a
// broadcast score bug, your next match with Play, and your trophies. Phone first: one column,
// 44 px buttons; the bracket scrolls sideways in its own box.

const roundName = (size, r) => {
  const left = size / 2 ** r
  return left === 2 ? "Final" : left === 4 ? "Semifinals" : left === 8 ? "Quarterfinals" : "Round of 16"
}
const short = (team) => {
  if (!team) return "TBD"
  if (team.cpu && team.name) return team.name
  return team.players.map((p) => p.name.split(/\s+/).at(-1)).join("/")
}
const inText = (ms) => {
  if (ms <= 0) return "now"
  const h = Math.floor(ms / T.HOUR)
  const m = Math.round((ms % T.HOUR) / T.MINUTE)
  return h >= 48 ? `in ${Math.round(h / 24)} days` : h ? `in ${h} h ${m} min` : `in ${m} min`
}
const statusText = (e, now) => (e.status === "live" ? "LIVE" : e.status === "done" ? "Finished" : `Sign-ups open · starts ${inText(e.start - now)}`)

export const Bracket = ({ doc, div, me }) => {
  const b = doc.brackets?.[div]
  if (!b) return <p className="pbMuted">Nobody played this division.</p>
  const how = { walkover: "time ran out", lots: "drawn by lots", sim: "" }
  return (
    <div className="tnBracket" data-bracket={div}>
      {b.rounds.map((row, r) => (
        <div key={r} className="tnRound">
          <b className="tnRoundName">{roundName(b.size, r)}</b>
          {row.map((m) => {
            const A = b.teams[m.a]
            const B = b.teams[m.b]
            const mine = A?.players.some((p) => p.k === me) ? "a" : B?.players.some((p) => p.k === me) ? "b" : null
            return (
              <div key={m.id} className="tnMatch" data-match={m.id}>
                <ScoreBug compact a={short(A)} b={short(B)} sa={m.score ? m.score[0] : m.w === "a" ? "W" : ""} sb={m.score ? m.score[1] : m.w === "b" ? "W" : ""} win={m.w} mine={mine} />
                {m.how && how[m.how] && <small className="pbMuted">{how[m.how]}</small>}
              </div>
            )
          })}
        </div>
      ))}
      {b.champion && (
        <div className="tnRound tnChamp">
          <b className="tnRoundName">Champions</b>
          <div className="tnTrophy" aria-hidden="true">🏆</div>
          <b>{T.teamName(b.teams[b.champion])}</b>
        </div>
      )}
    </div>
  )
}

export const TrophyShelf = ({ trophies }) =>
  trophies.length ? (
    <ul className="tnShelf" data-trophies>
      {trophies.map((t) => (
        <li key={t.id} className={`tnShelfItem place-${t.place}`}>
          <span className="tnCup" aria-hidden="true">
            {t.place === 1 ? "🏆" : "🥈"}
          </span>
          <span>
            <b>{t.place === 1 ? "Champion" : "Runner-up"}</b> · {t.name}
            <small className="pbMuted">
              {t.div}
              {t.partner ? ` with ${t.partner}` : ""} · {new Date(t.at).toLocaleDateString()}
            </small>
          </span>
        </li>
      ))}
    </ul>
  ) : (
    <p className="pbMuted">No trophies yet. Win a tournament and it goes on this shelf (and in your Locker Room).</p>
  )

const SignUp = ({ ev, buddies, onDone }) => {
  const [div, setDiv] = useState(ev.divisions[0]?.id)
  const [partner, setPartner] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const kind = ev.divisions.find((d) => d.id === div)?.kind
  return (
    <div className="tnSignup" data-signup>
      <b>Pick a division</b>
      <div className="tnDivs" role="radiogroup">
        {ev.divisions.map((d) => (
          <button key={d.id} type="button" role="radio" aria-checked={div === d.id} className={div === d.id ? "is-on" : ""} onClick={() => setDiv(d.id)} data-div={d.id}>
            <b>{d.name}</b>
            <small>{d.count}/16 teams</small>
          </button>
        ))}
      </div>
      {kind === "doubles" && (
        <label className="tnPartner">
          Partner
          <Select value={partner} onChange={(e) => setPartner(e.target.value)} data-partner>
            <option value="">A computer partner</option>
            {buddies.map((b) => (
              <option key={b.k} value={b.name}>
                {b.name} (they accept)
              </option>
            ))}
          </Select>
        </label>
      )}
      <button
        type="button"
        className="pbPrimary tnBig"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          const r = await net.enter(ev.id, div, kind === "doubles" ? partner : "")
          setBusy(false)
          if (!r.ok) setMsg(r.error)
          else onDone?.()
        }}
        data-action="tourney-enter"
      >
        {busy ? "Signing up..." : "Sign up"}
      </button>
      {msg && <p className="pbError">{msg}</p>}
      <p className="pbMuted">Free. At the start the bracket is drawn and computer teams fill it. Each round has 30 minutes to play your match in Pickleball 98.</p>
    </div>
  )
}

const NextMatch = ({ doc, me, onPlay }) => {
  const next = T.nextMatchFor(doc, me)
  const [msg, setMsg] = useState(null)
  const [score, setScore] = useState(["", ""])
  if (!next) return null
  const { match, side, them, mine, vsCpu, deadline, div, bracket } = next
  const spec = { id: doc.id, name: doc.name, venue: doc.venue, div, match: match.id, side, mine, them, vsCpu, round: `${T.DIVISIONS[div].name} ${roundName(bracket.size, match.r)}` }
  const theirRoom = match.room
  return (
    <div className="tnNext" data-next-match={match.id}>
      <ScoreBug title={doc.name} a={short(bracket.teams[match.a])} b={short(bracket.teams[match.b])} round={`${T.DIVISIONS[div].name} ${roundName(bracket.size, match.r)}`} mine={side} />
      <p>
        <b>Your match:</b> vs {T.teamName(them)}
        {vsCpu ? " (computer players)" : ""}. Play it by {new Date(deadline).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
      </p>
      {onPlay && vsCpu && (
        <button type="button" className="pbPrimary tnBig" onClick={() => onPlay(spec)} data-action="tourney-play">
          Play now at {T.VENUE_NAMES[doc.venue]}
        </button>
      )}
      {onPlay && !vsCpu && (
        <div className="tnButtons">
          {theirRoom ? (
            <button type="button" className="pbPrimary tnBig" onClick={() => onPlay({ ...spec, online: "join", code: theirRoom })} data-action="tourney-join">
              Join the room ({theirRoom})
            </button>
          ) : (
            <button type="button" className="pbPrimary tnBig" onClick={() => onPlay({ ...spec, online: "make" })} data-action="tourney-room">
              Make a room for this match
            </button>
          )}
          {!match.here[side] && (
            <button type="button" className="tnBig" onClick={async () => setMsg((await net.here(doc.id, match.id)).error || "Checked in. If time runs out and they didn't, you go through.")} data-action="tourney-here">
              We're here
            </button>
          )}
        </div>
      )}
      <MoreOptions id="tourney-report" label="Report a score" lessLabel="Hide the score form">
        <div className="tnReport">
          <label>
            {short(bracket.teams[match.a])} <input type="number" inputMode="numeric" min="0" max="30" value={score[0]} onChange={(e) => setScore([e.target.value, score[1]])} data-score="a" />
          </label>
          <label>
            {short(bracket.teams[match.b])} <input type="number" inputMode="numeric" min="0" max="30" value={score[1]} onChange={(e) => setScore([score[0], e.target.value])} data-score="b" />
          </label>
          <button type="button" onClick={async () => setMsg((await net.report(doc.id, match.id, score.map(Number))).error || "Result in.")} data-action="tourney-report">
            Report
          </button>
        </div>
      </MoreOptions>
      {msg && <p className="pbNote">{msg}</p>}
    </div>
  )
}

const Detail = ({ id, state, buddies, onBack, onPlay }) => {
  const doc = state.docs[id]
  const ev = state.events.find((e) => e.id === id)
  const [tab, setTab] = useState(null)
  const [msg, setMsg] = useState(null)
  useEffect(() => {
    net.open(id)
  }, [id])
  if (!doc) return <p className="pbMuted">Loading...</p>
  const me = state.me
  const entry = T.entryOf(doc, me)
  const invited = entry && entry.partner?.k === me && !entry.partner.ok
  const divs = doc.divisions
  const show = tab || (entry ? entry.div : divs[0])
  const now = Date.now()
  return (
    <div className="tnDetail" data-tourney-detail={id}>
      <button type="button" className="tnBack" onClick={onBack} data-action="tourney-back">
        « All tournaments
      </button>
      <div className="tnHead">
        <div className="tnHeadName">{doc.name}</div>
        <div className="tnHeadSub">
          {T.VENUE_NAMES[doc.venue]} · {T.whenText(doc.start)}
        </div>
        <div className={`tnChip is-${doc.status}`}>{statusText(doc, now)}</div>
      </div>
      {doc.status === "open" && !entry && ev && <SignUp ev={ev} buddies={buddies} onDone={() => net.open(id)} />}
      {doc.status === "open" && !entry && !ev && <p className="pbMuted">Sign-ups are on the list for this week.</p>}
      {invited && (
        <div className="tnInvite" data-invite>
          <p>
            <b>{entry.names[entry.keys[0]]}</b> wants you as a partner in {T.DIVISIONS[entry.div].name}.
          </p>
          <div className="tnButtons">
            <button type="button" className="pbPrimary tnBig" onClick={() => net.answer(id, true)} data-action="tourney-accept">
              Accept
            </button>
            <button type="button" className="tnBig" onClick={() => net.answer(id, false)} data-action="tourney-decline">
              Decline
            </button>
          </div>
        </div>
      )}
      {entry && !invited && doc.status === "open" && (
        <div className="tnIn" data-entered>
          <p>
            You're in <b>{T.DIVISIONS[entry.div].name}</b>
            {T.DIVISIONS[entry.div].kind === "doubles" ? (entry.partner ? ` with ${entry.partner.k === me ? entry.names[entry.keys[0]] : entry.partner.name}${entry.partner.ok ? "" : " (waiting for them to accept)"}` : " with a computer partner") : ""}. The draw is {inText(doc.start - now)}.
          </p>
          <button type="button" className="tnBig" onClick={async () => setMsg((await net.withdraw(id)).error || null)} data-action="tourney-withdraw">
            Withdraw
          </button>
        </div>
      )}
      {doc.status === "live" && <NextMatch doc={doc} me={me} onPlay={onPlay} />}
      {msg && <p className="pbError">{msg}</p>}
      {doc.status !== "open" && (
        <>
          <menu role="tablist" className="tnDivTabs">
            {divs.map((d) => (
              <li key={d} role="tab" aria-selected={show === d}>
                <button type="button" onClick={() => setTab(d)} data-div-tab={d}>
                  {T.DIVISIONS[d].short}
                </button>
              </li>
            ))}
          </menu>
          <Bracket doc={doc} div={show} me={me} />
        </>
      )}
      {doc.status === "open" && (
        <div className="tnEntries">
          <b>Signed up</b>
          {divs.map((d) => {
            const list = doc.entries.filter((e) => e.div === d)
            return (
              <p key={d}>
                <b>{T.DIVISIONS[d].name}:</b> {list.length ? list.map((e) => e.keys.map((k) => e.names[k] || k).join(" & ") + (e.partner && !e.partner.ok ? ` (+${e.partner.name}?)` : "")).join(", ") : "nobody yet"}
              </p>
            )
          })}
        </div>
      )}
      <p className="pbMuted tnFine">98ish's own events, made up for the game: not affiliated with the venue or any real tournament.</p>
    </div>
  )
}

// venue: only that venue's events (My Park); focus: open one (a notification)
const Tournaments = ({ buddies = [], onPlay = null, focus = null, venue = null }) => {
  const state = net.useTourneys()
  const [open, setOpen] = useState(focus)
  useEffect(() => {
    if (focus) setOpen(focus)
  }, [focus])
  useEffect(() => {
    net.refresh()
  }, [])
  const now = state.now || Date.now()
  const events = useMemo(() => state.events.filter((e) => !venue || e.venue === venue), [state.events, venue])
  if (state.status === "off") return <p className="pbBannerInfo">Sign on to 98 Messenger to sign up for tournaments. Your trophies stay on this phone.</p>
  if (open) return <Detail id={open} state={state} buddies={buddies} onBack={() => setOpen(null)} onPlay={onPlay} />
  const mine = events.filter((e) => e.entry || e.next)
  return (
    <div className="tnRoot" data-tournaments>
      {state.error && <p className="pbError">{state.error}</p>}
      {mine.length > 0 && <h4 className="pbH">Yours</h4>}
      <ul className="tnList">
        {[...mine, ...events.filter((e) => !mine.includes(e) && e.status !== "done")].map((e) => (
          <li key={e.id}>
            <button type="button" className={`tnCard is-${e.status}`} onClick={() => setOpen(e.id)} data-tourney={e.id}>
              <b className="tnCardName">{e.name}</b>
              <span className="tnCardWhere">
                {T.VENUE_NAMES[e.venue]} · {T.whenText(e.start)}
              </span>
              <span className={`tnChip is-${e.status}`}>{statusText(e, now)}</span>
              {e.entry?.invited && <span className="tnCardMine">Partner invitation: tap to answer</span>}
              {e.entry && !e.entry.invited && !e.next && <span className="tnCardMine">You're in: {e.divisions.find((d) => d.id === e.entry.div)?.name}</span>}
              {e.next && <span className="tnCardMine is-go">Your match vs {e.next.vs}: play it now</span>}
              {e.place === 1 && <span className="tnCardMine">🏆 You won it</span>}
            </button>
          </li>
        ))}
      </ul>
      {!events.length && <p className="pbMuted">{state.status === "loading" ? "Loading the week's events..." : "Nothing on the schedule."}</p>}
      <h4 className="pbH">Your trophies</h4>
      <TrophyShelf trophies={state.trophies} />
    </div>
  )
}

export default Tournaments
