import React, { useEffect, useState } from "react"
import { CHAT_LINES, EMOTES, INTRO } from "./lines.js"
import { repLevel, repLine } from "./rep.js"
import "./park.css"

// My Park's screen, kept simple (the owner: "keep the UI SIMPLE"): the move pad, ONE
// context button (what you can do right here: Watch, Call next, Sit, Locker Room, Ball
// Machine), a small menu button, and names over people in the world (world.js labels).
// Watching a court: that court's score, Cam and Leave. Everything else (the courts list,
// things to say, leaving the park) is in the menu.

export const ParkHud = ({ hud, showPad, padSide = "left", onAction, onMenu, onCam }) => {
  const a = hud?.action
  const w = hud?.watching
  const q = hud?.queued
  return (
    <div className={`pkPark${showPad ? " is-touch" : ""} pkPark--pad-${padSide}`}>
      <button type="button" className="pkParkMenuBtn" onClick={onMenu} aria-label="Menu" data-park="menu">
        <span aria-hidden="true">☰</span>
      </button>
      {w && (
        <div className="pkParkScore" data-park="score">
          <small>
            {w.name} · {w.level}
          </small>
          <div>
            <span className="pkParkTeam">{(w.people ? w.people : w.names)[0]}</span>
            <b>
              {w.score[0]} - {w.score[1]}
            </b>
            <span className="pkParkTeam">{(w.people ? w.people : w.names)[1]}</span>
          </div>
        </div>
      )}
      {!w && q && (
        <div className="pkParkChip" data-park="queued">
          Your paddle's in on {q.name}
          {q.ahead > 0 ? ` · ${q.ahead} ahead` : " · you're next"}
        </div>
      )}
      {showPad && hud?.mode === "walk" && <div className="pkParkPad" data-control="move" data-touch-surface aria-label="Move pad" />}
      <div className="pkParkActions">
        {w && (
          <button type="button" className="pkParkSmall" onClick={onCam} data-park="cam">
            Cam: {w.angle}
          </button>
        )}
        {a && (
          <button type="button" className={`pkParkAct pkParkAct--${a.kind}`} onClick={onAction} data-park="action" data-kind={a.kind}>
            <b>{a.label}</b>
            {a.detail && <small>{a.detail}</small>}
          </button>
        )}
      </div>
    </div>
  )
}

// the first visit: three lines
export const ParkIntro = ({ onDone, showPad }) => (
  <div className="pkCenter pkDim pkParkIntroWrap">
    <div className="pkPanel pkParkIntro window" data-park="intro">
      <b>Welcome to My Park</b>
      <ul>
        {INTRO.map((t, i) => (
          <li key={i}>{i === 0 && !showPad ? "Walk with the arrow keys or WASD (Shift runs)." : t}</li>
        ))}
      </ul>
      <button type="button" className="pkPrimary" onClick={onDone} autoFocus>
        Let's go
      </button>
    </div>
  </div>
)

// your turn: a moment's notice, then the game starts
export const ParkTurn = ({ turn, onGo }) => {
  const [left, setLeft] = useState(3)
  useEffect(() => {
    if (left <= 0) return onGo()
    const id = setTimeout(() => setLeft((n) => n - 1), 800)
    return () => clearTimeout(id)
  }, [left])
  return (
    <div className="pkCenter pkParkTurnWrap">
      <div className="pkPanel pkParkTurn" data-park="turn">
        <b>You're up on {turn.name}!</b>
        <p>{turn.kind === "room" ? "Doubles with people from the park, to 11." : `Doubles with the park's ${turn.levelName} regulars, to 11.`}</p>
        <button type="button" className="pkPrimary" onClick={onGo}>
          Play
        </button>
      </div>
    </div>
  )
}

// the result, back to the park
export const ParkResult = ({ result, onBack }) => (
  <div className="pkCenter pkDim">
    <div className="pkPanel pkParkResult window" data-park="result">
      <b className={result.won ? "pkWin" : "pkLose"}>{result.won ? "You win!" : "Good game!"}</b>
      {result.vs && <small className="pkParkVs">vs {result.vs}</small>}
      <p className="pkFinal2">{result.score ? `${result.score[0]} - ${result.score[1]}` : ""}</p>
      {result.line && <p className="pkParkCloneLine">"{result.line}"</p>}
      {result.rep && (
        <p>
          +{result.earned} park rep · <b>{repLine(result.rep)}</b>
        </p>
      )}
      <button type="button" className="pkPrimary" onClick={onBack} autoFocus data-park="back">
        Back to the park
      </button>
    </div>
  </div>
)

// where to play: Riverside Park and the real venues (your favorites first). One tap goes.
export const RIVERSIDE_ENTRY = { id: "riverside", name: "Riverside Park", short: "Riverside Park", city: "98ish", indoor: false, access: "public", courts: 4, live: 4 }
export const ParkVenues = ({ list = [], current = "riverside", favs = [], loading = null, onPick, onFav, onClose }) => {
  const all = [RIVERSIDE_ENTRY, ...list]
  const fav = new Set(favs)
  const sorted = [...all.filter((v) => fav.has(v.id)), ...all.filter((v) => !fav.has(v.id))]
  return (
    <div className="pkCenter pkDim" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="pkPanel pkParkVenues window" data-park="venues">
        <div className="pkParkMenuHead">
          <b>My Park: where to?</b>
          <button type="button" className="pkParkVenuesX" onClick={onClose} aria-label="Close" data-park="venues-close">
            ×
          </button>
        </div>
        <ul className="pkParkVenueList">
          {sorted.map((v) => (
            <li key={v.id} className={v.id === current ? "is-current" : ""}>
              <button type="button" className="pkParkVenueGo" onClick={() => onPick(v.id)} disabled={!!loading} data-venue={v.id}>
                <b>{v.short || v.name}</b>
                <small>
                  {v.city} · {v.courts} courts · {v.indoor ? "indoor" : "outdoor"}
                  {v.access === "members" ? " · members' club" : ""}
                </small>
                {loading === v.id && <small className="pkParkVenueLoading">Loading...</small>}
              </button>
              <button type="button" className={`pkParkVenueStar${fav.has(v.id) ? " is-on" : ""}`} onClick={() => onFav(v.id)} aria-label={fav.has(v.id) ? `Unstar ${v.short}` : `Star ${v.short}`} aria-pressed={fav.has(v.id)} data-star={v.id}>
                {fav.has(v.id) ? "★" : "☆"}
              </button>
            </li>
          ))}
        </ul>
        <p className="pkParkCredit">Real venues: map data © OpenStreetMap contributors (ODbL); skyline from AWS Terrain Tiles (USGS 3DEP, SRTM); drawn in 98ish style. No location needed.</p>
      </div>
    </div>
  )
}

// the menu: resume, the courts (watch any of them), say something, the Locker Room, leave
export const ParkMenu = ({ courts = [], rep, online, venueName = "My Park", onResume, onWatch, onSay, onEmote, onLocker, onVenues, onLeave, voice = null, onBackdrop = null, onClone = null }) => {
  const lv = repLevel(rep?.points || 0)
  return (
    <div className="pkCenter pkDim" onClick={(e) => e.target === e.currentTarget && onResume()}>
      <div className="pkPanel pkParkMenu window" data-park="menu-sheet">
        <div className="pkParkMenuHead">
          <b>{venueName}</b>
          <small>{online ? `Park ${online.park} · ${online.people} here` : "Just you and the regulars"}</small>
        </div>
        <p className="pkParkRep">
          Park rep: <b>{lv.name}</b> · {rep?.wins || 0}-{rep?.losses || 0}
          {lv.next ? <small> ({lv.toNext} to {lv.next})</small> : null}
        </p>
        {voice?.supported && <VoiceMenu voice={voice} names={voice.names || {}} />}
        <div className="pkParkCourts">
          {courts.map((c) => (
            <div key={c.id} className="pkParkCourtRow">
              <span>
                <b>{c.name}</b> {c.level}
                <small>{c.state === "human" ? "people playing" : c.state === "changeover" ? "next game" : `${c.score[0]}-${c.score[1]}`}</small>
              </span>
              <button type="button" onClick={() => onWatch(c.id)} data-park={`watch-${c.id}`}>
                Watch
              </button>
            </div>
          ))}
        </div>
        <div className="pkParkSay">
          {CHAT_LINES.map((t, i) => (
            <button type="button" key={t} onClick={() => onSay(i)}>
              {t}
            </button>
          ))}
          {EMOTES.map((e) => (
            <button type="button" key={e.id} className="pkParkEmote" onClick={() => onEmote(e.id)}>
              {e.label}
            </button>
          ))}
        </div>
        <div className="pkPauseMenu">
          <button type="button" className="pkPrimary" onClick={onResume} autoFocus>
            Back to the park
          </button>
          <button type="button" onClick={onLocker}>
            Locker Room
          </button>
          {onVenues && (
            <button type="button" onClick={onVenues} data-park="venues-open">
              Change venue...
            </button>
          )}
          {onClone && (
            <button type="button" onClick={onClone} data-park="clone-open">
              My clone in the park...
            </button>
          )}
          {onBackdrop && (
            <button type="button" onClick={onBackdrop} data-park="backdrop-open">
              Photoreal backdrop...
            </button>
          )}
          <button type="button" onClick={onLeave} data-park="leave">
            Leave My Park
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- spatial voice (useParkVoice.js) ----------
// In the menu: turn voice on or off, push to talk, and mute anyone you hear.
const VoiceMenu = ({ voice, names }) => {
  const v = voice.state
  const live = v.status === "on" || v.status === "paused" || v.status === "starting"
  const heard = Object.keys(v.peers || {})
  return (
    <div className="pkParkVoice" data-park="voice">
      <button type="button" className={live ? "pkPrimary" : ""} onClick={voice.toggle} data-park="voice-toggle" aria-pressed={live}>
        {v.status === "starting" ? "Voice: starting..." : live ? "Voice: On" : "Voice: Off"}
      </button>
      <small>{live ? (heard.length ? `Hearing ${heard.length} ${heard.length === 1 ? "person" : "people"} near you` : "Nobody near you has voice on yet") : "Talk to people near you in the park"}</small>
      {live && (
        <label className="pkParkVoicePtt">
          <input type="checkbox" checked={!!v.ptt} onChange={(e) => voice.session?.setPushToTalk(e.target.checked)} data-park="voice-ptt" />
          <span>Push to talk</span>
        </label>
      )}
      {live && heard.length > 0 && (
        <div className="pkParkVoicePeople">
          {heard.map((id) => (
            <button type="button" key={id} onClick={() => voice.session?.muteFriend(Number(id), !v.peers[id].muted)} data-park={`voice-mute-${id}`}>
              {v.peers[id].muted ? "Unmute" : "Mute"} {names[id] || `Player ${id}`}
            </button>
          ))}
        </div>
      )}
      {v.error && <p className="pkParkVoiceErr">{v.error}</p>}
    </div>
  )
}

// On screen while voice is on: a mic chip (tap: mute yourself), and a hold-to-talk button
// with push to talk
export const VoiceChip = ({ voice }) => {
  const v = voice?.state
  if (!v || v.status === "off") return null
  if (v.status === "error") return null
  const s = voice.session
  const heard = Object.values(v.peers || {}).filter((p) => p.state === "connected" || p.level > 0).length
  return (
    <div className="pkVoiceChip" data-park="voice-chip" data-talking={v.talking ? "1" : undefined}>
      <button type="button" className={`pkVoiceMic${v.muted ? " is-muted" : ""}`} onClick={() => s?.setMuted(!v.muted)} aria-label={v.muted ? "Unmute your microphone" : "Mute your microphone"} data-park="voice-mute">
        <span aria-hidden="true">{v.muted ? "🔇" : "🎙"}</span>
        <b>{v.status === "paused" ? "Voice paused" : v.muted ? "Muted" : "Mic on"}</b>
        <small>{v.status === "paused" ? "Back in 98ish to talk" : `${heard} near you`}</small>
      </button>
      {v.ptt && !v.muted && (
        <button
          type="button"
          className={`pkVoicePtt${v.pressed ? " is-down" : ""}`}
          onPointerDown={(e) => (e.currentTarget.setPointerCapture?.(e.pointerId), s?.press(true))}
          onPointerUp={() => s?.press(false)}
          onPointerCancel={() => s?.press(false)}
          data-park="voice-hold"
          data-touch-surface
        >
          Hold to talk
        </button>
      )}
    </div>
  )
}

// ---------- Live Venue Presence: friends who are at this venue for real ----------
// A strip at the top of the park: who's here (by court) or nearby, with Say hi (an IM) and
// Plan a game (a Real Games session here). here/nearby: [{ key, name, area }]; courtName(area)
export const RealFriendsBar = ({ here = [], nearby = [], venueName = "", courtName = () => "", canIm = false, onHi, onPlan }) => {
  const [sent, setSent] = useState({})
  if (!here.length && !nearby.length) return null
  const first = here[0] || nearby[0]
  const isHere = !!here.length
  const more = (isHere ? here.length : nearby.length) - 1
  const where = isHere ? courtName(first.area) : ""
  const hi = async () => {
    const r = await onHi?.(first)
    setSent((s) => ({ ...s, [first.key]: r?.ok === false ? "error" : "sent" }))
  }
  return (
    <div className="pkRealBar" data-real-bar>
      <span className="pkRealPin" aria-hidden="true" />
      <span className="pkRealText">
        <b>{first.name}</b>
        {more > 0 ? ` and ${more} more` : ""} {isHere ? `${more > 0 ? "are" : "is"} here for real` : `${more > 0 ? "are" : "is"} near ${venueName}`}
        {where ? ` · ${where}` : ""}
      </span>
      {canIm && (
        <button type="button" onClick={hi} disabled={!!sent[first.key]} data-real-hi>
          {sent[first.key] === "sent" ? "Sent" : sent[first.key] === "error" ? "Couldn't send" : "Say hi"}
        </button>
      )}
      {isHere && onPlan && (
        <button type="button" onClick={() => onPlan(first)} data-real-plan>
          Plan a game
        </button>
      )}
    </div>
  )
}
