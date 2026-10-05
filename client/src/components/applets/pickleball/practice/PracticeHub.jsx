import React, { useState } from "react"
import MoreOptions from "../../../shared/MoreOptions"
import { COUNTS, PLACES, RATES, SHOTS, SPEEDS, SPINS, TARGETS, machineSummary, normalizeMachine } from "./machine.js"
import { DRILLS } from "./drillbook.js"
import { LESSONS, suggestedLesson } from "./lessons.js"
import { Coach } from "./Coach"
import "./practice.css"

// Pickleball 98 practice: the hub (three big tiles: lessons, the ball machine, drills) and
// its three short screens. Everything starts in one or two taps; the ball machine's finer
// settings wait under More options (docs/simplicity.md).
//   onStart({ kind: "machine", settings } | { kind: "drill", id } | { kind: "lesson", id })

const Panel = ({ title, onBack, children }) => (
  <div className="pkPanel2 window is-wide pkHub">
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

const Radio = ({ name, value, options, onChange }) => (
  <div className="pkRadios" role="radiogroup" aria-label={name}>
    {options.map(([v, label]) => (
      <label key={String(v)} className={`pkRadio${value === v ? " is-on" : ""}`}>
        <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
        <span>{label}</span>
      </label>
    ))}
  </div>
)

// small pictures for the tiles (drawn, no emoji)
const Icon = ({ kind }) => (
  <svg className="pkHubIcon" viewBox="0 0 32 32" aria-hidden="true">
    {kind === "lessons" && (
      <>
        <rect x="3" y="5" width="26" height="18" fill="#2a5d9f" stroke="#0b1224" strokeWidth="1.5" />
        <path d="M8 18 Q14 6 22 12" fill="none" stroke="#ffd23f" strokeWidth="2" strokeDasharray="2 2" />
        <circle cx="22" cy="12" r="2.2" fill="#d9f03c" stroke="#0b1224" />
        <rect x="12" y="23" width="8" height="5" fill="#808080" />
      </>
    )}
    {kind === "machine" && (
      <>
        <rect x="7" y="13" width="18" height="12" fill="#1f6f4a" stroke="#0b1224" strokeWidth="1.5" />
        <path d="M9 13 L6 5 L26 5 L23 13 Z" fill="#9fd8ff" stroke="#0b1224" strokeWidth="1.2" />
        <circle cx="13" cy="9" r="2" fill="#d9f03c" />
        <circle cx="18" cy="8" r="2" fill="#d9f03c" />
        <circle cx="10" cy="27" r="2.5" fill="#24272e" />
        <circle cx="22" cy="27" r="2.5" fill="#24272e" />
      </>
    )}
    {kind === "drills" && (
      <>
        <circle cx="16" cy="16" r="12" fill="#ff7a5c" stroke="#0b1224" strokeWidth="1.5" />
        <circle cx="16" cy="16" r="8" fill="#fff" />
        <circle cx="16" cy="16" r="4" fill="#ff7a5c" />
        <path d="M16 4 l2.2 4.4 4.8 0.7 -3.5 3.4 0.8 4.8 -4.3 -2.3 -4.3 2.3 0.8 -4.8 -3.5 -3.4 4.8 -0.7 z" fill="#ffd23f" stroke="#0b1224" strokeWidth="0.8" transform="translate(9 -3) scale(0.55)" />
      </>
    )}
  </svg>
)

export const Stars = ({ n, of = 3 }) => (
  <span className="pkStars" aria-label={`${n} of ${of} stars`}>
    {Array.from({ length: of }, (_, i) => (
      <i key={i} className={i < n ? "is-on" : ""} aria-hidden="true">
        ★
      </i>
    ))}
  </span>
)

// ---------- the hub ----------
export const PracticeHub = ({ prefs, setPrefs, onStart, onTutorial, onBack, initialView = "hub" }) => {
  const [view, setView] = useState(initialView) // hub | machine | drills | lessons
  const lessonsDone = prefs.lessons || {}
  const doneN = LESSONS.filter((l) => lessonsDone[l.id]).length
  const stars = prefs.drillStars || {}
  const starN = DRILLS.reduce((s, d) => s + (stars[d.id] || 0), 0)
  if (view === "machine") return <MachinePanel prefs={prefs} setPrefs={setPrefs} onStart={onStart} onBack={() => setView("hub")} />
  if (view === "drills") return <DrillsPanel stars={stars} onStart={onStart} onBack={() => setView("hub")} />
  if (view === "lessons") return <LessonsPanel done={lessonsDone} onStart={onStart} onBack={() => setView("hub")} />
  return (
    <Panel title="Practice" onBack={onBack}>
      <div className="pkHubTiles">
        <button type="button" className="pkHubTile is-lessons" data-practice="lessons" onClick={() => setView("lessons")} autoFocus>
          <Icon kind="lessons" />
          <span>
            <b>Learn to play like a pro</b>
            <small>Short lessons with a coach &middot; {doneN} of {LESSONS.length} done</small>
          </span>
        </button>
        <button type="button" className="pkHubTile" data-practice="machine" onClick={() => setView("machine")}>
          <Icon kind="machine" />
          <span>
            <b>Ball Machine</b>
            <small>Pick a shot and hit as many as you like</small>
          </span>
        </button>
        <button type="button" className="pkHubTile" data-practice="drills" onClick={() => setView("drills")}>
          <Icon kind="drills" />
          <span>
            <b>Drills</b>
            <small>
              One goal, 1-3 minutes, up to 3 stars &middot; {starN} of {DRILLS.length * 3} ★
            </small>
          </span>
        </button>
      </div>
      <div className="pkRow pkRowEnd">
        <button type="button" onClick={onTutorial} data-action="tutorial">
          Controls Tutorial
        </button>
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
    </Panel>
  )
}

// ---------- the ball machine's settings ----------
const MachinePanel = ({ prefs, setPrefs, onStart, onBack }) => {
  const s = normalizeMachine(prefs.machine)
  const set = (patch) => setPrefs({ machine: normalizeMachine({ ...s, ...patch }) })
  return (
    <Panel title="Ball Machine" onBack={onBack}>
      <p className="pkLead">What should it feed you?</p>
      <div className="pkShotTiles" role="radiogroup" aria-label="Shot type">
        {SHOTS.map((x) => (
          <button type="button" key={x.id} role="radio" aria-checked={s.shot === x.id} className={`pkShotTile${s.shot === x.id ? " is-on" : ""}`} data-shot={x.id} onClick={() => set({ shot: x.id })}>
            <b>{x.label}</b>
            <small>{x.sub}</small>
          </button>
        ))}
      </div>
      <div className="pkForm">
        <div className="pkField">
          <span>Speed</span>
          <Radio name="Speed" value={s.speed} options={SPEEDS} onChange={(v) => set({ speed: v })} />
        </div>
      </div>
      <MoreOptions id="pickleball.machine" summary={machineSummary(s)} className="pkMachineMore">
        <div className="pkForm">
          <div className="pkField">
            <span>Spin</span>
            <Radio name="Spin" value={s.spin} options={SPINS} onChange={(v) => set({ spin: v })} />
          </div>
          <div className="pkField">
            <span>Placement</span>
            <Radio name="Placement" value={s.place} options={PLACES} onChange={(v) => set({ place: v })} />
          </div>
          <div className="pkField">
            <span>Balls a minute</span>
            <Radio name="Balls a minute" value={s.rate} options={RATES.map((r) => [r, String(r)])} onChange={(v) => set({ rate: v })} />
          </div>
          <div className="pkField">
            <span>Balls</span>
            <Radio name="Balls" value={s.balls} options={COUNTS.map((r) => [r, String(r)])} onChange={(v) => set({ balls: v })} />
          </div>
          <div className="pkField">
            <span>Target zones</span>
            <Radio name="Target zones" value={s.targets} options={TARGETS} onChange={(v) => set({ targets: v })} />
          </div>
        </div>
      </MoreOptions>
      <div className="pkRow pkRowEnd pkHubGo">
        <button type="button" className="pkPrimary pkGo" data-action="machine-start" onClick={() => onStart({ kind: "machine", settings: s })}>
          Start
        </button>
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
    </Panel>
  )
}

// ---------- drills ----------
const DrillsPanel = ({ stars, onStart, onBack }) => (
  <Panel title="Drills" onBack={onBack}>
    <div className="pkDrillTiles">
      {DRILLS.map((d) => (
        <button type="button" key={d.id} className="pkDrillTile" data-drill2={d.id} onClick={() => onStart({ kind: "drill", id: d.id })}>
          <b>{d.name}</b>
          <small>{d.goal}</small>
          <Stars n={stars[d.id] || 0} />
        </button>
      ))}
    </div>
    <div className="pkRow pkRowEnd">
      <button type="button" onClick={onBack}>
        Back
      </button>
    </div>
  </Panel>
)

// ---------- lessons: a checklist ----------
const LessonsPanel = ({ done, onStart, onBack }) => {
  const next = suggestedLesson(done)
  return (
    <Panel title="Learn to play like a pro" onBack={onBack}>
      <div className="pkCoachLine">
        <Coach />
        <p>{Object.keys(done).length ? `Welcome back! Next up: ${next.title}.` : "Hi, I'm Coach Pat. Start at the top: each lesson is a tip, then you try it."}</p>
      </div>
      <ol className="pkLessonList">
        {LESSONS.map((l, i) => (
          <li key={l.id}>
            <button type="button" className={`pkLessonRow${done[l.id] ? " is-done" : ""}${l.id === next.id ? " is-next" : ""}`} data-lesson={l.id} onClick={() => onStart({ kind: "lesson", id: l.id })} autoFocus={l.id === next.id}>
              <span className="pkCheck" aria-hidden="true">
                {done[l.id] ? "✓" : i + 1}
              </span>
              <span>
                <b>{l.title}</b>
                <small>{l.task}</small>
              </span>
              <span className="pkSr">{done[l.id] ? " (done)" : ""}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="pkRow pkRowEnd">
        <button type="button" className="pkPrimary" onClick={() => onStart({ kind: "lesson", id: next.id })} data-action="lesson-next">
          {Object.keys(done).length ? "Next Lesson" : "Start"}
        </button>
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
    </Panel>
  )
}

// ---------- the first time Pickleball opens: a small offer on the title screen ----------
export const FirstTimeOffer = ({ onLesson, onPlay }) => (
  <div className="pkFirstTime" role="group" aria-label="New to pickleball?">
    <Coach small />
    <div>
      <b>New to pickleball?</b>
      <div className="pkRow">
        <button type="button" className="pkPrimary" onClick={onLesson} data-action="first-lesson">
          Take the 2-minute lesson
        </button>
        <button type="button" onClick={onPlay} data-action="first-play">
          Just play
        </button>
      </div>
    </div>
  </div>
)
