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
      <p className="pkFinal2">{result.score ? `${result.score[0]} - ${result.score[1]}` : ""}</p>
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

// the menu: resume, the courts (watch any of them), say something, the Locker Room, leave
export const ParkMenu = ({ courts = [], rep, online, onResume, onWatch, onSay, onEmote, onLocker, onLeave }) => {
  const lv = repLevel(rep?.points || 0)
  return (
    <div className="pkCenter pkDim" onClick={(e) => e.target === e.currentTarget && onResume()}>
      <div className="pkPanel pkParkMenu window" data-park="menu-sheet">
        <div className="pkParkMenuHead">
          <b>My Park</b>
          <small>{online ? `Park ${online.park} · ${online.people} here` : "Just you and the regulars"}</small>
        </div>
        <p className="pkParkRep">
          Park rep: <b>{lv.name}</b> · {rep?.wins || 0}-{rep?.losses || 0}
          {lv.next ? <small> ({lv.toNext} to {lv.next})</small> : null}
        </p>
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
          <button type="button" onClick={onLeave} data-park="leave">
            Leave My Park
          </button>
        </div>
      </div>
    </div>
  )
}
