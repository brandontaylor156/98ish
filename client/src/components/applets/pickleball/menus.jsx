import React, { useEffect, useState } from "react"
import { CHARACTERS, OUTFITS, characterById } from "./looks.js"
import { STYLES, LEVELS } from "./ai.js"
import { VENUE_INFO as VENUES } from "./looks.js"
import { TOUR, nextMatch, unlocks } from "./career.js"
import { ACTIONS, ACTION_LABEL, bindingsFor, keyName, rebind } from "./input.js"

// Pickleball 98's menus: the title screen, Quick Match, players, the World Tour, practice,
// two players on one computer, settings and controls. Each is a panel over the 3D scene
// (the demo match, or the character viewer on the players screen).

export const LEVEL_NAMES = { beginner: "Rookie", intermediate: "Club", pro: "Pro", legend: "Legend" }
export const TIMING = { relaxed: 0.085, normal: 0.06, strict: 0.042 }

const Radio = ({ name, value, options, onChange, disabled }) => (
  <div className="pkRadios" role="radiogroup">
    {options.map(([v, label, off]) => (
      <label key={String(v)} className={`pkRadio${value === v ? " is-on" : ""}${off ? " is-off" : ""}`}>
        <input type="radio" name={name} checked={value === v} disabled={disabled || off} onChange={() => onChange(v)} />
        <span>{label}</span>
      </label>
    ))}
  </div>
)

const Panel = ({ title, children, onBack, wide, className = "" }) => (
  <div className={`pkPanel2 window${wide ? " is-wide" : ""} ${className}`}>
    <div className="title-bar">
      <div className="title-bar-text">{title}</div>
      {onBack && (
        <div className="title-bar-controls">
          <button aria-label="Close" onClick={onBack} />
        </div>
      )}
    </div>
    <div className="window-body pkPanelBody">{children}</div>
  </div>
)

const Stat = ({ label, value }) => (
  <div className="pkStat">
    <span>{label}</span>
    <i style={{ "--v": Math.max(0.1, Math.min(1, (value - 0.85) / 0.3)) }} />
  </div>
)

const Portrait = ({ c, outfit }) => {
  const look = c.look
  const shirt = OUTFITS.find((o) => o.id === outfit)?.shirt || look.shirt
  return (
    <span className="pkFace" aria-hidden="true" style={{ "--skin": ["#f6d3b3", "#eab98f", "#d39a6a", "#b5784a", "#8c5734", "#5f3a22"][look.skin] || "#d39a6a", "--hair": look.hairColor, "--shirt": shirt, "--hat": look.hat === "none" ? "transparent" : look.hatColor }}>
      <span className="pkFaceShirt" />
      <span className="pkFaceHead" />
      <span className={`pkFaceHair pkFaceHair--${look.hair}`} />
      {look.hat !== "none" && <span className={`pkFaceHat pkFaceHat--${look.hat}`} />}
    </span>
  )
}

// ---------- the title screen ----------
// where: { text, onChange } (the venue and time you play: the scene behind is it; play/)
// parkName: the venue My Park opens at
export const TitleMenu = ({ onPick, onOnline, tour, showPad, offer = null, where = null, parkName = null }) => {
  return (
    <div className="pkTitle2">
      <div className="pkLogo2" aria-label="Pickleball 98">
        <span className="pkLogoA">PICKLE</span>
        <span className="pkLogoB">BALL</span>
        <span className="pkLogo98">98</span>
        <small>WORLD TOUR EDITION</small>
      </div>
      {/* the shared launcher pattern (docs/simplicity.md): Play (Quick Match), then Practice
          (where the game teaches itself), Play Online, then the other modes under More
          modes; the small row stays. offer: the first-time "New to pickleball?" card */}
      {/* the fundamental UI stays simple (owner, 2026-10-06; docs/simplicity.md): four places to
          go, nothing else. Quick Match setup holds Play Online, World Tour and 2 Players; the
          menu bar holds Settings, Controls and Rules; My Player holds Players + Locker Room. */}
      <div className="pkMainMenu">
        {offer}
        <button type="button" className="pkBig pkBigPlay" data-menu="quick" onClick={() => onPick("quick")} autoFocus>
          <b>Play</b>
          <small>Quick Match · online with friends · World Tour</small>
        </button>
        <button type="button" className="pkBig" data-menu="park" onClick={() => onPick("park")}>
          <b>My Park</b>
          <small>{parkName ? `Walk ${parkName}: watch, call next and play` : "Walk real venues, watch, call next and play"}</small>
        </button>
        <button type="button" className="pkBig" data-menu="practice" onClick={() => onPick("practice")}>
          <b>Practice</b>
          <small>Lessons, a ball machine, drills</small>
        </button>
        <button type="button" className="pkBig" data-menu="club" onClick={() => onPick("club")}>
          <b>Real Games</b>
          <small>Your real-life pickleball with friends</small>
        </button>
        <div className="pkSmallRow">
          <button type="button" data-menu="players" onClick={() => onPick("players")}>
            My Player
          </button>
          {where && (
            <button type="button" data-menu="where" onClick={where.onChange} title="Where and when you play">
              {where.text}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------- players ----------
export const PlayersMenu = ({ prefs, setPrefs, tour, onBack, slot = "p1", onPreview, onLocker, title = "Choose Your Player" }) => {
  const mine = slot === "p2" ? prefs.p2 : { character: prefs.character, outfit: prefs.outfit }
  const [sel, setSel] = useState(mine.character)
  const [outfit, setOutfit] = useState(mine.outfit || "home")
  const u = unlocks(tour)
  const list = CHARACTERS.filter((c) => !c.boss || u.champion)
  const c = characterById(sel)
  useEffect(() => {
    onPreview?.(sel, outfit)
  }, [sel, outfit])
  const save = () => {
    if (slot === "p2") setPrefs({ p2: { character: sel, outfit } })
    else setPrefs({ character: sel, outfit })
    onBack()
  }
  return (
    <div className="pkPlayers">
      <Panel title={title} onBack={onBack} className="pkPlayersPanel">
        <div className="pkCharGrid" role="listbox" aria-label="Players">
          {list.map((ch) => (
            <button type="button" key={ch.id} role="option" aria-selected={sel === ch.id} className={`pkChar${sel === ch.id ? " is-on" : ""}`} onClick={() => setSel(ch.id)} data-char={ch.id}>
              <Portrait c={ch} outfit={sel === ch.id ? outfit : "home"} />
              <b>{ch.nick}</b>
              <small>{STYLES[ch.style].label}</small>
            </button>
          ))}
        </div>
        <div className="pkCharInfo">
          <b className="pkCharName">{c.name}</b>
          <i>{STYLES[c.style].label}</i>
          <p>{c.blurb}</p>
          <Stat label="Speed" value={c.stats.speed} />
          <Stat label="Power" value={c.stats.power} />
          <Stat label="Touch" value={c.stats.touch} />
          {prefs.looks?.[sel] && <p className="pkLockerNote">Wearing their Locker Room look.</p>}
          <div className="pkOutfits">
            {OUTFITS.map((o) => {
              const open = u.outfits.includes(o.id)
              return (
                <button type="button" key={o.id} disabled={!open} className={outfit === o.id ? "is-on" : ""} title={open ? o.name : `${o.name}: unlock it on the World Tour`} onClick={() => setOutfit(o.id)}>
                  <span className="pkSwatch" style={{ background: o.shirt || c.look.shirt }} />
                  {open ? o.name : "Locked"}
                </button>
              )
            })}
          </div>
          <div className="pkRow">
            <button type="button" className="pkPrimary" onClick={save} data-action="choose">
              Choose {c.nick}
            </button>
            {onLocker && (
              <button type="button" data-action="locker" onClick={() => onLocker(sel)}>
                Locker Room...
              </button>
            )}
            <button type="button" onClick={onBack}>
              Cancel
            </button>
          </div>
        </div>
      </Panel>
    </div>
  )
}

const venueOptions = (tour) => {
  const u = unlocks(tour)
  return Object.values(VENUES).map((v) => [v.id, `${v.name} (${v.time})`, !u.venues.includes(v.id)])
}

// (Quick Match's setup is play/PlaySetup.jsx: vs Computer | Online first)

// ---------- the World Tour ----------
export const TourMenu = ({ tour, onPlay, onBack, onReset }) => {
  const next = nextMatch(tour)
  return (
    <Panel title="World Tour" onBack={onBack} wide>
      <p className="pkLead">Eight matches from the park to the stadium. Win to move up; each club and city unlocks something new.</p>
      <ol className="pkLadder">
        {TOUR.map((t, i) => {
          const c = characterById(t.opponent)
          const state = i < tour.stage ? "won" : i === tour.stage ? "next" : "locked"
          return (
            <li key={t.id} className={`pkRung is-${state}`} data-round={t.id}>
              <Portrait c={c} />
              <div>
                <b>{t.title}</b>
                <small>
                  vs {c.name} ({STYLES[c.style].label}, {LEVEL_NAMES[t.level]}) &middot; {VENUES[t.venue].name} &middot; to {t.target}
                </small>
                {t.reward && <small className="pkReward">Prize: {t.reward.text}</small>}
              </div>
              <span className="pkRungState">{state === "won" ? "Won" : state === "next" ? "Next" : ""}</span>
            </li>
          )
        })}
      </ol>
      <div className="pkRow pkRowEnd">
        {next ? (
          <button type="button" className="pkPrimary pkGo" onClick={() => onPlay(next)} data-action="play-tour" autoFocus>
            Play: {next.title}
          </button>
        ) : (
          <b className="pkChamp">Tour Champion!</b>
        )}
        {tour.stage > 0 && (
          <button type="button" onClick={onReset}>
            Start Over
          </button>
        )}
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
    </Panel>
  )
}

// (practice: lessons, the ball machine and drills are in practice/PracticeHub.jsx)

// ---------- two players ----------
export const VersusMenu = ({ prefs, setPrefs, tour, onStart, onBack, onPlayers, showPad }) => {
  const p1 = characterById(prefs.character)
  const p2 = characterById(prefs.p2.character)
  const b = bindingsFor(prefs.keys)
  return (
    <Panel title="2 Players" onBack={onBack} wide>
      <div className="pkVs">
        <button type="button" className="pkWho pkWho--big" onClick={() => onPlayers("p1")}>
          <Portrait c={p1} outfit={prefs.outfit} />
          <b>Player 1: {p1.nick}</b>
          <small>
            {keyName(b.p1.up[0])}
            {keyName(b.p1.left[0])}
            {keyName(b.p1.down[0])}
            {keyName(b.p1.right[0])} move &middot; {keyName(b.p1.hit[0])} hit (tap soft, hold hard)
          </small>
          <small>or gamepad 1</small>
        </button>
        <span className="pkVsBadge">VS</span>
        <button type="button" className="pkWho pkWho--big" onClick={() => onPlayers("p2")}>
          <Portrait c={p2} outfit={prefs.p2.outfit} />
          <b>Player 2: {p2.nick}</b>
          <small>
            Arrows move &middot; {keyName(b.p2.hit[0])} hit (tap soft, hold hard)
          </small>
          <small>or gamepad 2</small>
        </button>
      </div>
      <div className="pkForm">
        <div className="pkField">
          <span>Format</span>
          <Radio name="pk-vformat" value={prefs.doubles} options={[[false, "Singles"], [true, "Doubles (computer partners)"]]} onChange={(v) => setPrefs({ doubles: v })} />
        </div>
        <div className="pkField">
          <span>Venue</span>
          <Radio name="pk-vvenue" value={prefs.venue} options={venueOptions(tour)} onChange={(v) => setPrefs({ venue: v })} />
        </div>
      </div>
      {showPad && <p className="pkMuted">On a touch screen only Player 1 has on-screen buttons: connect keyboards or gamepads for two.</p>}
      <div className="pkRow pkRowEnd">
        <button type="button" className="pkPrimary pkGo" onClick={onStart} data-action="start-versus">
          Start
        </button>
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
    </Panel>
  )
}

// ---------- settings ----------
export const SettingsMenu = ({ prefs, setPrefs, onBack, onControls, showPad, onTouchEdit, onChooseScheme }) => (
  <Panel title="Settings" onBack={onBack} wide>
    <div className="pkForm">
      {showPad && (
        <>
          <div className="pkField" data-field="scheme">
            <span>Touch controls</span>
            <Radio name="pk-scheme" value={prefs.scheme || "swipe"} options={[["swipe", "Swipe (recommended)"], ["classic", "Classic (aim + hold)"]]} onChange={(v) => setPrefs({ scheme: v })} />
            {onChooseScheme && (
              <button type="button" className="pkLinkBtn" onClick={onChooseScheme}>
                Show me...
              </button>
            )}
          </div>
          <div className="pkField" data-field="padSide">
            <span>Move pad</span>
            <Radio name="pk-pad" value={prefs.padSide || "left"} options={[["left", "Left"], ["right", "Right"]]} onChange={(v) => setPrefs({ padSide: v })} />
          </div>
        </>
      )}
      <div className="pkField">
        <span>Graphics</span>
        <Radio name="pk-quality" value={prefs.quality} options={[["low", "Low"], ["medium", "Medium"], ["high", "High"]]} onChange={(v) => setPrefs({ quality: v })} />
      </div>
      <div className="pkField">
        <span>Camera</span>
        <Radio name="pk-cam" value={prefs.camera} options={[["broadcast", "Broadcast"], ["tv", "TV high"], ["side", "Sideline"], ["player", "Behind you"]]} onChange={(v) => setPrefs({ camera: v })} />
      </div>
      <div className="pkField">
        <span>Timing</span>
        <Radio name="pk-timing" value={prefs.timing} options={[["relaxed", "Relaxed"], ["normal", "Normal"], ["strict", "Strict"]]} onChange={(v) => setPrefs({ timing: v })} />
      </div>
      <div className="pkField">
        <span>Slow-mo on speed-ups</span>
        <Radio name="pk-focus" value={prefs.focus || "auto"} options={[["auto", "Rookie & practice"], ["on", "Always"], ["off", "Off"]]} onChange={(v) => setPrefs({ focus: v })} />
      </div>
      <div className="pkField pkChecks">
        {[
          ["sound", "Sound"],
          ["voice", "Umpire voice"],
          ["aid", "Shot guides (where the ball lands, your aim dot)"],
          ["swipeTrail", "Show swipe trail (touch: your finger's path; Classic: a ripple)"],
          ["trail", "Swing trail (your paddle's path)"],
          ["replays", "Instant replays"],
          ["cuts", "TV camera cuts to the server between points"],
          ["hints", "Show controls on screen"],
        ].map(([k, l]) => (
          <label key={k}>
            <input type="checkbox" checked={!!prefs[k]} onChange={(e) => setPrefs({ [k]: e.target.checked })} /> {l}
          </label>
        ))}
      </div>
    </div>
    <div className="pkRow pkRowEnd">
      <button type="button" onClick={onControls}>
        Controls...
      </button>
      {showPad && (
        <button type="button" onClick={onTouchEdit}>
          Move Touch Buttons...
        </button>
      )}
      <button type="button" className="pkPrimary" onClick={onBack}>
        Done
      </button>
    </div>
  </Panel>
)

// ---------- controls (and rebinding) ----------
export const ControlsMenu = ({ prefs, setPrefs, onBack, showPad }) => {
  const [set, setSet] = useState("solo")
  const [listening, setListening] = useState(null)
  const b = bindingsFor(prefs.keys)
  useEffect(() => {
    if (!listening) return
    const onKey = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code !== "Escape") setPrefs({ keys: rebind(prefs.keys || {}, set, listening, e.code) })
      setListening(null)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [listening, set, prefs.keys])
  return (
    <Panel title="Controls" onBack={onBack} wide>
      <Radio name="pk-keyset" value={set} options={[["solo", "One player"], ["p1", "2P: Player 1"], ["p2", "2P: Player 2"]]} onChange={setSet} />
      <table className="pkKeys">
        <tbody>
          {ACTIONS.map((a) => (
            <tr key={a}>
              <th>{ACTION_LABEL[a]}</th>
              <td>{(b[set][a] || []).map(keyName).join(" / ") || "(none)"}</td>
              <td>
                <button type="button" onClick={() => setListening(a)} className={listening === a ? "is-on" : ""}>
                  {listening === a ? "Press a key..." : "Change"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pkHelpText">
        <p>
          <b>One hit control.</b> Aim with the mouse: point at their court (the ring shows where it goes). Press hit (click,
          or {keyName(b.solo.hit[0])}) and LET GO just before the ball reaches you: the meter's marker in the green. How
          long you held it is the pace: a quick TAP is soft (a dink at the kitchen line, a drop or a reset from farther
          back), a long HOLD is hard (a drive, a speed-up, a counter). A soft ball aimed deep goes up high: a lob.
        </p>
        <p>
          <b>Read the ball.</b> The little ring on the ball turns orange when you'll meet it above the net: that one you
          can attack. Below the net, keep it soft: a hard swing from down there sails long (a red dot shows where it would
          land). When they speed it up at you there's no time to wind up: hold hit early (paddle up) and let go to counter,
          or tap late to block it soft.
        </p>
        <p>
          <b>Serving:</b> hold hit to fill the serve meter, let go in the green (early = a soft, safe serve). Point at the
          box to aim.
        </p>
        <p>
          <b>Two players on one keyboard:</b> no mouse; while holding hit, the move keys steer the aim (sideways, and toward
          the net = deeper). <b>Gamepad:</b> left stick moves, right stick aims, any face button or trigger hits, Start
          pauses.
          {showPad ? " Touch: drag on the left to move; touch anywhere else to hit: on their court it aims right there, elsewhere drag to steer; hold for pace." : ""} C changes the camera, P pauses.
        </p>
      </div>
      <div className="pkRow pkRowEnd">
        <button type="button" onClick={() => setPrefs({ keys: {} })}>
          Reset Keys
        </button>
        <button type="button" className="pkPrimary" onClick={onBack}>
          Done
        </button>
      </div>
    </Panel>
  )
}
