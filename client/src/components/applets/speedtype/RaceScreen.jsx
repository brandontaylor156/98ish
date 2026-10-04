import React, { useEffect, useRef, useState } from "react"
import Track from "./Track"
import PromptText from "./PromptText"
import Results, { resultText } from "./Results"
import { shareOut, textPayload } from "../../../utils/share"
import { accuracy, judge, startTyping, step, wpm } from "./typing"
import { categoryLabel } from "./prompts/index.js"
import { requestKeyboard } from "../../shared/keyboard/native"

// One race (or a best-of-3 match) on screen, online or against the computer: the track,
// the countdown, the prompt and the typing field, then the results. The rules' view says
// what's happening; act() sends your progress (the server checks it). now() is the
// server's clock (online) or Date.now (here in the browser).
//
// The typing field is an ordinary text input driven by its input events, so any keyboard
// works: a real one, a phone's, or 98ish's on-screen keyboard.

const SEND_MS = 300 // online: at most ~3 progress reports a second (the room's rate limit)

export const liveWpm = (r, view, now, length) => {
  if (r.finishedAt != null) return wpm(length, r.finishedAt - view.goAt)
  if (now <= view.goAt) return 0
  return wpm(r.pos, Math.min(now, view.limitAt) - view.goAt)
}

// finishers' places, in finishing order
export const placesOf = (racers) => {
  const order = racers
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.finishedAt != null)
    .sort((a, b) => a.r.finishedAt - b.r.finishedAt)
  const places = {}
  order.forEach(({ i }, k) => (places[i] = k + 1))
  return places
}

const useNow = (now, fast) => {
  const clock = useRef(now)
  clock.current = now
  const [t, setT] = useState(() => now())
  useEffect(() => {
    setT(clock.current())
    const h = setInterval(() => setT(clock.current()), fast ? 100 : 500)
    return () => clearInterval(h)
  }, [fast])
  return t
}

const RaceScreen = ({ view, act, now: clockNow, sounds, mobile = false, online = false, footer = null, heading = null, onRoundEnd }) => {
  const prompt = view.prompt.text
  const raceKey = `${view.round}:${view.goAt}`
  const you = view.you
  const me = you != null ? view.racers[you] : null
  const [t, setT] = useState(startTyping)
  const timeline = useRef([])
  const inputRef = useRef(null)
  const sent = useRef({ at: 0, timer: null, pos: -1, keys: -1, mistakes: -1 })
  const latest = useRef(t)
  latest.current = t
  const sudden = view.mode === "sudden"
  const strict = !!view.strict

  const racing = view.phase === "racing" || view.phase === "countdown"
  const now = useNow(clockNow, racing)
  const go = now >= view.goAt
  const { correct, wrong } = judge(prompt, t)
  const iAmOut = sudden && t.mistakes > 0
  const canType = racing && go && me && !me.out && me.finishedAt == null && !t.done && !iAmOut && view.phase === "racing"

  // a new race: a fresh typing field
  useEffect(() => {
    setT(startTyping())
    timeline.current = []
    clearTimeout(sent.current.timer)
    sent.current = { at: 0, timer: null, pos: -1, keys: -1, mistakes: -1 }
  }, [raceKey])
  useEffect(() => () => clearTimeout(sent.current.timer), [])

  // countdown beeps, the horn, and focus on the field at the green light
  const secs = Math.ceil((view.goAt - now) / 1000)
  const lastBeep = useRef(null)
  useEffect(() => {
    if (view.phase !== "countdown" && view.phase !== "racing") return
    const key = `${raceKey}:${go ? "go" : secs}`
    if (lastBeep.current === key || secs > 3) return
    if (go && now - view.goAt > 1000) return
    lastBeep.current = key
    if (go) {
      sounds?.go()
      inputRef.current?.focus({ preventScroll: true })
    } else sounds?.beep()
  }, [secs, go])
  useEffect(() => {
    if (view.phase === "countdown" && me) inputRef.current?.focus({ preventScroll: true })
  }, [raceKey])

  // someone else crossed the line
  const finishers = view.racers.filter((r) => r.finishedAt != null).length
  const prevFinishers = useRef(finishers)
  useEffect(() => {
    if (finishers > prevFinishers.current && !(me?.finishedAt != null && finishers === 1)) {
      const others = view.racers.filter((r, i) => i !== you && r.finishedAt != null).length
      if (others && me?.finishedAt == null) sounds?.ping()
    }
    prevFinishers.current = finishers
  }, [finishers])

  // a race just ended: the results go to the stats
  const reported = useRef(view.results.length ? `${view.results.length}:${view.goAt}` : -1)
  useEffect(() => {
    const n = view.results.length
    if (!n || reported.current === `${n}:${view.goAt}`) return
    const last = view.results[n - 1]
    if (last.round !== view.round) return
    reported.current = `${n}:${view.goAt}`
    onRoundEnd?.({ result: last, timeline: timeline.current.slice(), typing: latest.current, view })
  }, [view.results.length, view.phase])

  // ---------- sending progress ----------
  const flush = () => {
    const s = sent.current
    clearTimeout(s.timer)
    s.timer = null
    const cur = latest.current
    const { correct: pos } = judge(prompt, cur)
    if (pos === s.pos && cur.keys === s.keys && cur.mistakes === s.mistakes) return
    s.at = performance.now()
    s.pos = pos
    s.keys = cur.keys
    s.mistakes = cur.mistakes
    Promise.resolve(act({ type: "progress", text: prompt.slice(0, pos), keys: cur.keys, mistakes: cur.mistakes })).then((r) => {
      if (r && !r.ok && sent.current === s) {
        // (refused: the green light hasn't reached the server yet, or a burst was too
        // fast) try again in a moment with whatever's typed by then
        s.pos = -1
        if (!s.timer) s.timer = setTimeout(flush, 250)
      }
    })
  }
  const sendSoon = (urgent) => {
    const s = sent.current
    if (!online) return flush()
    const wait = Math.max(0, SEND_MS - (performance.now() - s.at))
    if (wait === 0 || (urgent && wait < 60)) return flush()
    if (!s.timer) s.timer = setTimeout(flush, wait)
  }

  const onChange = (e) => {
    if (!canType) return
    const before = t
    const n = step(prompt, before, e.target.value, { strict })
    const next = { ...n, rejected: false }
    setT(next)
    latest.current = next
    if (n.lastError || (n.rejected && n.mistakes > before.mistakes)) sounds?.wrong()
    else if (n.keys > before.keys) e.target.value.endsWith(" ") ? sounds?.space() : sounds?.key()
    const pos = judge(prompt, next).correct
    const last = timeline.current[timeline.current.length - 1]
    const ms = Math.max(0, Math.round(clockNow() - view.goAt))
    if (!last || last[1] !== pos) timeline.current.push([ms, pos])
    if (next.done) sounds?.finish(!view.racers.some((r, i) => i !== you && r.finishedAt != null))
    if (sudden && next.mistakes > 0 && before.mistakes === 0) sounds?.out()
    sendSoon(next.done || (sudden && next.mistakes > 0))
  }

  // (no pasting the prompt in)
  const block = (e) => e.preventDefault()

  // ---------- what's on screen ----------
  const length = prompt.length
  const places = placesOf(view.racers)
  const lanes = view.racers.map((r, i) => {
    const mine = i === you
    const pos = mine && r.finishedAt == null ? Math.max(r.pos, correct) : r.pos
    return { ...r, pos, you: mine, place: places[i] || null, wpm: mine && r.finishedAt == null && !r.out ? wpm(correct, Math.max(0, Math.min(now, view.limitAt) - view.goAt)) : liveWpm(r, view, now, length) }
  })
  const elapsed = Math.max(0, Math.min(now, view.limitAt) - view.goAt)
  const myWpm = me?.finishedAt != null ? wpm(length, me.finishedAt - view.goAt) : wpm(correct, elapsed)
  const myAcc = accuracy(t.keys, t.mistakes) * 100
  const left = Math.max(0, Math.ceil((view.limitAt - now) / 1000))
  const lastResult = view.results[view.results.length - 1]
  const showResults = (view.phase === "between" || view.phase === "done") && lastResult
  const multi = view.rounds > 1

  // On a phone the 98ish keyboard comes up by itself whenever typing is on: at the green
  // light, and when the race comes back into view (window switched back, phone unlocked).
  // No tap needed (the box is data-kb-auto); a keyboard put away with its X stays away.
  const canTypeRef = useRef(canType)
  canTypeRef.current = canType
  const ready = () => {
    const el = inputRef.current
    if (!el || !canTypeRef.current || !el.getClientRects().length) return
    if (document.activeElement !== el) el.focus({ preventScroll: true })
    requestKeyboard(el)
  }
  useEffect(() => {
    if (canType) ready()
  }, [canType])
  const boxShown = !!me && !showResults
  useEffect(() => {
    const el = inputRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    let shown = el.getClientRects().length > 0
    const ro = new ResizeObserver(() => {
      const now = el.getClientRects().length > 0
      if (now && !shown) ready()
      shown = now
    })
    ro.observe(el)
    const onVisible = () => document.visibilityState === "visible" && ready()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      ro.disconnect()
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [boxShown])

  let banner = null
  if (view.phase === "countdown" || (view.phase === "racing" && !go)) banner = secs > 3 ? <span className="stReady">Get ready...</span> : <span className="stCount" key={secs}>{secs}</span>
  else if (view.phase === "racing" && now - view.goAt < 800) banner = <span className="stGo">GO!</span>

  let status = null
  if (view.phase === "racing" && me) {
    if (me.finishedAt != null || t.done) status = places[you] ? `You finished ${["", "1st", "2nd", "3rd", "4th", "5th"][places[you]] || ""}! Waiting for the others...` : "Finished!"
    else if (me.out || iAmOut) status = me.left ? "You left the race." : "Wrong key: you're out! Watch the others finish."
  } else if (!me && view.phase === "racing") status = "You're watching this race."

  const points = multi && (
    <div className="stPoints" aria-label="Race wins">
      {view.racers.map((r, i) => (
        <span key={i} className={i === you ? "is-you" : ""}>
          {r.name}: <b>{r.points}</b>
        </span>
      ))}
    </div>
  )

  return (
    <div className={`stRace${mobile ? " is-mobile" : ""}`} data-phase={view.phase} data-race={raceKey}>
      <div className="stRaceHead">
        {heading}
        <span className="stRaceInfo">
          {multi ? `Race ${view.round + 1} of ${view.rounds} · first to ${view.toWin}` : view.mode === "sudden" ? "Sudden Death" : "Race"}
          {" · "}
          {categoryLabel(view.prompt.category)}
          {strict && " · strict"}
        </span>
        {view.phase === "racing" && left <= 20 && <span className="stClock">{left}s left</span>}
      </div>
      {points}
      <Track racers={lanes} length={length} compact={mobile} />

      {showResults ? (
        <div className="stAfter">
          <Results
            table={lastResult.table}
            you={you}
            mine={timeline.current}
            title={view.phase === "between" ? `Race ${view.round + 1} results` : multi ? "Final race" : "Results"}
            note={view.phase === "between" ? `Next race in ${Math.max(0, Math.ceil((view.nextAt - now) / 1000))}s...` : null}
          />
          {view.phase === "done" && multi && view.winner != null && (
            <p className="stMatchWinner">{view.winner === you ? "You win the match!" : `${view.racers[view.winner].name} wins the match.`}</p>
          )}
          {view.phase === "done" && (
            <div className="stShareRow">
              <button type="button" data-share-result onClick={() => shareOut(textPayload("Speed Typist 98", resultText(lastResult.table, you)), "apps", { title: "Speed Typist 98" })}>
                Share Result...
              </button>
            </div>
          )}
          {view.phase === "done" && footer}
        </div>
      ) : (
        <>
          <div className="stBoard">
            {banner && <div className="stBanner">{banner}</div>}
            <PromptText prompt={prompt} correct={me ? correct : 0} wrong={me ? wrong : 0} waiting={!go} />
          </div>
          {me && (
            <div className="stTypeRow">
              <input
                ref={inputRef}
                className={`stInput${t.lastError ? " is-error" : ""}${wrong ? " has-wrong" : ""}`}
                value={t.value}
                onChange={onChange}
                onPaste={block}
                onDrop={block}
                readOnly={!canType}
                aria-label="Type the prompt here"
                placeholder={!go ? "Get ready..." : canType ? (t.committed === 0 && !t.value ? "Start typing!" : "") : ""}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="next"
                data-typing
                data-kb-auto
              />
              <div className="stLive" aria-live="off">
                <span>
                  <b data-live="wpm">{Math.round(myWpm)}</b> WPM
                </span>
                <span>
                  <b data-live="acc">{Math.round(myAcc)}%</b> acc
                </span>
                <span className="stHideNarrow">
                  <b>{t.mistakes}</b> {t.mistakes === 1 ? "mistake" : "mistakes"}
                </span>
              </div>
            </div>
          )}
          {status && <p className="stStatus" role="status">{status}</p>}
          {strict && view.phase === "racing" && canType && <p className="stHint">Strict: wrong keys don't go in, and there's no backspace.</p>}
          {view.phase === "racing" && canType && wrong > 0 && !strict && <p className="stHint is-error">Fix the red letters (Backspace) before you go on.</p>}
          {view.phase === "done" && footer}
        </>
      )}
    </div>
  )
}

export default RaceScreen
