import React, { useEffect, useState } from "react"
import { Coach } from "./Coach"
import { CourtDiagram } from "./CourtDiagram"
import { Stars } from "./PracticeHub"
import { drillStars, scoreText } from "./drillbook.js"
import "./practice.css"

// Pickleball 98 practice: what's on screen during a session. Kept small:
//   - one bar at the top: what you're doing and how far along (balls, goal, streak, time)
//   - one line under it after each shot: a label (Drop / Dink / Out / Net / Pop-up...) with
//     what the coach says, or a "what to do" hint when a mistake repeats; it fades
//   - "Split!" as the machine hits (the split-step drill)
//   - a lesson's tip card before its task; the results at the end
// plan: { kind, title, drill?, lesson?, spec }; train: { snap, result, cue } from the session

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

const progressText = (plan, snap) => {
  const s = snap || {}
  const spec = plan.spec
  if (plan.drill?.measure === "streak") return `In a row: ${s.streak || 0} · best ${s.bestStreak || 0}/${spec.streakGoal}`
  if (spec.need) return `${Math.min(s.made || 0, spec.need)} / ${spec.need}`
  if (plan.drill?.measure === "points") return `${s.points || 0} pts · ball ${Math.min((s.attempts || 0) + 1, spec.balls)}/${spec.balls}`
  if (spec.balls) return `${plan.drill ? `${s.made || 0} good · ` : ""}ball ${Math.min((s.attempts || 0) + 1, spec.balls)}/${spec.balls}`
  return `${s.made || 0}`
}

export const PracticeHud = ({ plan, train, intro, touch, onStartTask, onPause, onAgain, onNext, onDone }) => {
  const snap = train?.snap
  const result = train?.result
  // the feedback line: shown for a moment after each shot
  const [line, setLine] = useState(null)
  useEffect(() => {
    if (!result) return
    setLine(result)
    const t = setTimeout(() => setLine((l) => (l === result ? null : l)), result.hint ? 3200 : 1900)
    return () => clearTimeout(t)
  }, [result?.id])
  const [cue, setCue] = useState(false)
  useEffect(() => {
    if (!train?.cue) return
    setCue(true)
    const t = setTimeout(() => setCue(false), 520)
    return () => clearTimeout(t)
  }, [train?.cue])

  if (intro && plan.lesson) {
    const l = plan.lesson
    return (
      <div className="pkCenter pkDim">
        <div className="pkLessonCard window" data-lesson-card={l.id}>
          <div className="title-bar">
            <div className="title-bar-text">
              Lesson {plan.index + 1} of {plan.count}
            </div>
          </div>
          <div className="window-body">
            <div className="pkLessonHead">
              <Coach />
              <b>{l.title}</b>
            </div>
            <div className="pkLessonBody">
              <CourtDiagram diagram={l.diagram} label={`${l.title}: how it looks on court`} />
              <div>
                <p className="pkTip">{(touch && l.tipTouch) || l.tip}</p>
                <p className="pkTask">
                  <b>Your turn:</b> {l.task}
                </p>
              </div>
            </div>
            <div className="pkRow pkRowEnd">
              <button type="button" className="pkPrimary pkGo" onClick={onStartTask} data-action="lesson-go" autoFocus>
                Try it
              </button>
              <button type="button" onClick={onDone}>
                Back
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (snap?.done) {
    const d = plan.drill
    const stars = d ? drillStars(d, snap) : null
    const passed = plan.lesson ? snap.made >= plan.spec.need : null
    return (
      <div className="pkCenter pkDim">
        <div className="pkTrainDone window" data-train-done={plan.kind}>
          <div className="title-bar">
            <div className="title-bar-text">{plan.title}</div>
          </div>
          <div className="window-body">
            {plan.lesson && (
              <div className="pkLessonHead">
                <Coach mood={passed ? "happy" : "plain"} />
                <b>{passed ? "Lesson done!" : "Time's up: try it again"}</b>
              </div>
            )}
            {d && (
              <div className="pkDoneStars">
                <Stars n={stars} />
                <b>{scoreText(d, snap)}</b>
                <small>
                  ★ {d.stars[0]} &middot; ★★ {d.stars[1]} &middot; ★★★ {d.stars[2]}
                </small>
              </div>
            )}
            {!plan.lesson && (
              <table className="pkStats pkTrainStats">
                <tbody>
                  <tr>
                    <th>In</th>
                    <td>{snap.counts.in}</td>
                    <th>Accuracy</th>
                    <td>{snap.accuracy}%</td>
                  </tr>
                  <tr>
                    <th>Out</th>
                    <td>{snap.counts.out}</td>
                    <th>Net</th>
                    <td>{snap.counts.net}</td>
                  </tr>
                  <tr>
                    <th>Missed</th>
                    <td>{snap.counts.miss + (snap.counts.fault || 0)}</td>
                    <th>Avg speed</th>
                    <td>{snap.avgMph} mph</td>
                  </tr>
                  {plan.spec.zones && (
                    <tr>
                      <th>Points</th>
                      <td>{snap.points}</td>
                      <th>Best streak</th>
                      <td>{snap.bestStreak}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            <div className="pkRow pkRowCenter">
              {onNext && (
                <button type="button" className="pkPrimary" onClick={onNext} data-action="train-next" autoFocus>
                  {plan.lesson ? "Next Lesson" : "Next Drill"}
                </button>
              )}
              <button type="button" className={onNext ? "" : "pkPrimary"} onClick={onAgain} data-action="train-again" autoFocus={!onNext}>
                Again
              </button>
              <button type="button" onClick={onDone} data-action="train-done">
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const time = plan.spec.time && snap ? Math.max(0, plan.spec.time - snap.t) : null
  const goal = plan.drill ? plan.drill.goal : plan.lesson ? plan.lesson.task : null
  return (
    <>
      <div className="pkTrainBar" data-train={plan.kind}>
        <div className="pkTrainWhat">
          <b>{plan.title}</b>
          {goal && <small>{goal}</small>}
        </div>
        <span className="pkTrainCount" data-progress>
          {progressText(plan, snap)}
          {time !== null && time < 60 && <em> &middot; {fmt(time)}</em>}
        </span>
        <button type="button" className="pkTrainPause" onClick={onPause} aria-label="Pause" data-action="train-pause">
          ❚❚
        </button>
      </div>
      {line && (
        <div key={line.id} className={`pkTrainLine is-${line.label?.tone || "ok"}`} role="status" data-shot-label={line.label?.text}>
          <b>{line.label?.text}</b>
          {(line.hint || line.msg) && <span>{line.hint ? `Tip: ${line.hint}` : line.msg}</span>}
        </div>
      )}
      {cue && (
        <div className="pkSplitCue" aria-hidden="true">
          Split!
        </div>
      )}
    </>
  )
}
