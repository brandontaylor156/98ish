import React, { useEffect, useRef } from "react"
import { readSwipe } from "../../touchplay.js"
import { createTrailCanvas } from "../../trailcanvas.js"
import { swipeLook } from "../../swipetrail.js"

// The screen while an activity runs (My Park, acts/useActivities.jsx). Kept simple, as My
// Park is: the score up top, Leave in the top-right corner (where the park's one button is),
// the move pad's zone along the bottom where a thumb rests, and the rest of the screen for
// the swipe (tennis, hoops) or the beat (the workout). Words in the middle when something
// happens; an end card with Play again.

// a swipe anywhere in the zone: its points -> touchplay.js readSwipe -> run.swipe
const SwipeZone = ({ run, kind, className = "", label, onTap = null }) => {
  const ref = useRef(null)
  const trailRef = useRef(null)
  const trail = useRef(null)
  const sw = useRef(null)
  useEffect(() => {
    const cv = trailRef.current
    if (!cv) return
    trail.current = createTrailCanvas(cv)
    return () => trail.current?.dispose?.()
  }, [])
  const size = () => {
    const r = ref.current?.closest(".pkRoot")?.getBoundingClientRect() || { width: window.innerWidth, height: window.innerHeight }
    return { width: r.width, height: r.height }
  }
  const down = (e) => {
    if (sw.current) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
    sw.current = { id: e.pointerId, pts: [{ x: e.clientX, y: e.clientY, t: performance.now() }] }
    trail.current?.start(sw.current.pts[0])
    run.swipeStart?.()
  }
  const move = (e) => {
    const s = sw.current
    if (!s || s.id !== e.pointerId) return
    s.pts.push({ x: e.clientX, y: e.clientY, t: performance.now() })
    if (s.pts.length > 64) s.pts.splice(1, 1)
    const r = readSwipe(s.pts, size())
    trail.current?.move({ x: e.clientX, y: e.clientY, t: performance.now() }, swipeLook(r).color)
    run.swipeMove?.(r)
  }
  const up = (e) => {
    const s = sw.current
    if (!s || s.id !== e.pointerId) return
    sw.current = null
    s.pts.push({ x: e.clientX, y: e.clientY, t: performance.now() })
    if (e.type === "pointercancel") {
      trail.current?.cancel()
      run.swipeMove?.(null)
      return
    }
    const r = readSwipe(s.pts, size())
    // (down the screen: what kind of swipe, for the workout's rows)
    const a = s.pts[0]
    const z = s.pts[s.pts.length - 1]
    r.down = z.y - a.y > Math.abs(z.x - a.x) && z.y - a.y > 30
    trail.current?.end(z, r)
    if (r.tap && onTap) onTap()
    else run.swipe?.(r)
  }
  return (
    <div ref={ref} className={`pkActSwipe pkActSwipe--${kind} ${className}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-touch-surface data-act="swipe" aria-label={label}>
      <canvas ref={trailRef} className="pkActTrail" aria-hidden="true" />
    </div>
  )
}

const Top = ({ hud, onLeave, children }) => (
  <div className="pkActTop">
    <div className="pkActScore" data-act="score">
      {hud.court && <small className="pkActWhere">{hud.court}</small>}
      <b>{hud.big}</b>
      {hud.small && <small>{hud.small}</small>}
      {children}
    </div>
    <button type="button" className="pkActLeave" onClick={onLeave} data-act="leave">
      Leave
    </button>
  </div>
)

const EndCard = ({ over, onAgain, onLeave, again = "Play again", children }) => (
  <div className="pkCenter pkDim pkActEndWrap">
    <div className="pkPanel window pkActEnd" data-act="end">
      <b className={over.won === false ? "pkLose" : "pkWin"}>{over.title || (over.won ? "You win!" : over.won === false ? "Good game!" : "Done!")}</b>
      {over.line && <p className="pkFinal2">{over.line}</p>}
      {children}
      <div className="pkActEndRow">
        {onAgain && (
          <button type="button" className="pkPrimary" onClick={onAgain} data-act="again">
            {again}
          </button>
        )}
        <button type="button" onClick={onLeave} data-act="end-leave">
          Leave
        </button>
      </div>
    </div>
  </div>
)

const MoveZone = ({ showPad, padSide }) => (showPad ? <div className={`pkActMove pkActMove--${padSide}`} data-control="move" data-touch-surface aria-label="Move pad" /> : null)

// ---- tennis ----
const TennisHud = ({ run, hud, showPad, padSide, onLeave, onAgain }) => (
  <>
    <Top hud={hud} onLeave={onLeave} />
    <SwipeZone run={run} kind="tennis" label="Swipe up to hit" />
    <MoveZone showPad={showPad} padSide={padSide} />
    {hud.tip && <div className="pkActTip" data-act="tip">{hud.tip}</div>}
    {hud.note && <div className="pkActWord" data-act="word">{hud.note}</div>}
    {hud.over && <EndCard over={{ ...hud.over, line: hud.over.line }} onAgain={hud.online && !hud.host ? null : onAgain} onLeave={onLeave} />}
  </>
)

// ---- hoops ----
const Letters = ({ word = "", who }) => (
  <span className="pkActLetters" aria-label={`${who}: ${word || "no letters"}`}>
    {"HORSE".split("").map((ch, i) => (
      <i key={i} className={i < word.length ? "is-on" : ""}>
        {ch}
      </i>
    ))}
  </span>
)
const HoopsHud = ({ run, hud, showPad, padSide, onLeave, onAgain }) => (
  <>
    <Top hud={hud} onLeave={onLeave}>
      {hud.mode === "horse" && (
        <span className="pkActHorse">
          <Letters word={hud.letters?.me} who="You" />
          <Letters word={hud.letters?.them} who={hud.opp || "Them"} />
        </span>
      )}
    </Top>
    <SwipeZone run={run} kind="hoops" label="Swipe up to shoot" />
    <MoveZone showPad={showPad} padSide={padSide} />
    {hud.power !== null && hud.power !== undefined && (
      <div className="pkActPower" aria-hidden="true">
        <span style={{ height: `${Math.round(Math.min(1.2, hud.power) * 80)}%` }} className={hud.power > 0.84 && hud.power < 1.16 ? "is-sweet" : ""} />
      </div>
    )}
    {hud.tip && <div className="pkActTip" data-act="tip">{hud.tip}</div>}
    {hud.note && <div className="pkActWord" data-act="word">{hud.note}</div>}
    {hud.over && <EndCard over={hud.over} onAgain={hud.online && !hud.host ? null : onAgain} onLeave={onLeave} />}
  </>
)

// ---- the workout ----
const WorkoutHud = ({ run, hud, onLeave, onAgain, fitness }) => (
  <>
    <Top hud={hud} onLeave={onLeave}>
      {hud.mate && (
        <small className="pkActMate" data-act="mate">
          {hud.mate.name}: {hud.mate.score} · {hud.mate.streak}x
        </small>
      )}
    </Top>
    <div className="pkActMove2" aria-live="polite" data-act="move">
      <span aria-hidden="true">{hud.move?.icon}</span> <b>{hud.move?.name}</b>
      {hud.set && <small>{hud.set}</small>}
    </div>
    <div className="pkActLane" ref={(el) => run.attachLane?.(el)} aria-hidden="true">
      <div className="pkActTarget" />
    </div>
    <SwipeZone run={run} kind="workout" label={hud.move?.input === "swipe" ? "Swipe down on the beat" : "Tap on the beat"} onTap={() => run.tap?.()} />
    {hud.judge && (
      <div key={hud.judge.id} className={`pkActJudge is-${hud.judge.kind}`} data-act="judge">
        {hud.judge.text}
      </div>
    )}
    {hud.combo > 1 && <div className="pkActCombo">{hud.combo}x</div>}
    {hud.camera && <div className="pkActCamChip" data-act="cam">{hud.camera}</div>}
    {hud.tip && <div className="pkActTip" data-act="tip">{hud.tip}</div>}
    {hud.note && <div className="pkActWord" data-act="word">{hud.note}</div>}
    {hud.over && (
      <EndCard over={hud.over} onAgain={hud.online && !hud.host ? null : onAgain} onLeave={onLeave} again="Go again">
        <ul className="pkActEndList">
          <li>
            {hud.over.reps} reps · {hud.over.perfect} perfect · best streak {hud.over.streak}
          </li>
          {hud.over.newBest && <li>New best score!</li>}
          {fitness && (
            <li>
              Fitness: <b>{fitness.name}</b>
              {fitness.next ? ` · ${fitness.next.left} more to ${fitness.next.name}` : ""}
            </li>
          )}
          {hud.over.pumped && <li>Your player's pumped for the next half hour 💪</li>}
        </ul>
      </EndCard>
    )}
  </>
)

// ---- the TV ----
const TvHud = ({ run, hud, onLeave, actions }) => {
  const vref = useRef(null)
  return (
    <>
      <div className="pkActTop">
        <div className="pkActScore">
          <small className="pkActWhere">{hud.court}</small>
          <b>📺 {hud.title}</b>
        </div>
        <button type="button" className="pkActLeave" onClick={onLeave} data-act="leave">
          Leave
        </button>
      </div>
      <div className={`pkActTv${hud.playing ? " is-playing" : ""}`} data-act="tv">
        <div className="pkActTvScreen">
          {hud.playing?.url ? (
            <video ref={vref} src={hud.playing.url} controls playsInline autoPlay data-act="tv-video" />
          ) : (
            <div className="pkActTvMenu">
              <p>{hud.msg}</p>
              {hud.list?.length ? (
                <ul>
                  {hud.list.map((it) => (
                    <li key={it.id}>
                      <button type="button" onClick={() => (it.live ? actions.watchLive?.(it) : run.play?.(it))} data-act={`tv-${it.id}`}>
                        <b>{it.name}</b>
                        {it.sub && <small>{it.sub}</small>}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>
        <div className="pkActTvRow">
          {hud.channels?.map((c) => (
            <button type="button" key={c.id} className={c.id === hud.channel ? "is-on" : ""} onClick={() => (c.id === "together" ? actions.together?.() : run.channel?.(c.id))} data-act={`ch-${c.id}`}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

export const ActHud = ({ run, hud, mobile, showPad, padSide, onLeave, onAgain, fitness, actions = {} }) => {
  const props = { run, hud, mobile, showPad, padSide, onLeave, onAgain, fitness, actions }
  return (
    <div className={`pkAct pkAct--${hud.kind}${showPad ? " is-touch" : ""}`} data-act-kind={hud.kind}>
      {hud.kind === "tennis" && <TennisHud {...props} />}
      {hud.kind === "hoops" && <HoopsHud {...props} />}
      {hud.kind === "workout" && <WorkoutHud {...props} />}
      {hud.kind === "tv" && <TvHud {...props} />}
    </div>
  )
}
