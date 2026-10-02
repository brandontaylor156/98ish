import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import { keyOf, useBuddyGroups } from "../aim/AimContext"
import { Heart, HeartBurst, ModeIcon } from "./art"

// Shared pieces of the Quiz Show: the context every screen reads, screen frames, big
// answer buttons, timers, the heart meter, the person picker, and a question runner.

export const QuizCtx = createContext(null)
export const useQuiz = () => useContext(QuizCtx)

// The couples module (utils/couple.js), when this 98ish has it: your partner is the
// first choice of who to play with. Without it, anyone on 98 Messenger or the network.
const coupleModules = import.meta.glob("../../../utils/couple.js", { eager: true })
const useCoupleHook = Object.values(coupleModules)[0]?.useCouple || (() => null)
export const usePartner = () => {
  const couple = useCoupleHook()
  return couple?.status === "paired" && couple.partner ? couple.partner : null
}

export const LETTERS = ["A", "B", "C", "D", "E", "F"]

export const Screen = ({ title, mode, onBack, children, footer, className = "" }) => (
  <div className={`qzScreen ${className}`}>
    {(title || onBack) && (
      <div className="qzHead">
        {onBack && (
          <button type="button" className="qzBack" onClick={onBack} aria-label="Back">
            <span aria-hidden="true">&#9664;</span> Back
          </button>
        )}
        {mode && <ModeIcon mode={mode} size={24} />}
        <h2>{title}</h2>
      </div>
    )}
    <div className="qzBody">{children}</div>
    {footer && <div className="qzFoot">{footer}</div>}
  </div>
)

export const Big = ({ children, onClick, disabled, kind = "", type = "button", ...rest }) => (
  <button type={type} className={`qzBig ${kind}`} onClick={onClick} disabled={disabled} {...rest}>
    {children}
  </button>
)

// Big answer buttons. marks: { index: [names] } (who picked what, on a reveal);
// correct: the right one (green); picked: yours
export const Choices = ({ options, picked = null, onPick, disabled, correct = null, marks = null, wide = false, letters = true }) => (
  <div className={`qzChoices${wide || options.length === 2 ? " is-two" : ""}`}>
    {options.map((text, i) => {
      const state = correct !== null ? (i === correct ? " is-right" : picked === i ? " is-wrong" : " is-dim") : picked === i ? " is-picked" : ""
      return (
        <button key={i} type="button" className={`qzChoice qzC${i % 6}${state}`} disabled={disabled} onClick={() => onPick?.(i)} aria-pressed={picked === i}>
          {letters && <span className="qzLetter">{LETTERS[i]}</span>}
          <span className="qzChoiceText">{text}</span>
          {marks?.[i]?.length > 0 && (
            <span className="qzMarks">
              {marks[i].map((n) => (
                <span key={n} className="qzMark">
                  {n}
                </span>
              ))}
            </span>
          )}
        </button>
      )
    })}
  </div>
)

export const Progress = ({ step, total, label }) => (
  <div className="qzProgress">
    <span>{label || `Question ${step + 1} of ${total}`}</span>
    <span className="qzDots" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < step ? "is-done" : i === step ? "is-now" : ""} />
      ))}
    </span>
  </div>
)

// A shrinking bar until `deadline` (in this computer's time); onTick each second left
export const TimerBar = ({ deadline, seconds, onTick, onEnd }) => {
  const [now, setNow] = useState(Date.now())
  const lastTick = useRef(null)
  const ended = useRef(false)
  useEffect(() => {
    ended.current = false
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [deadline])
  const left = Math.max(0, deadline - now)
  const secs = Math.ceil(left / 1000)
  useEffect(() => {
    if (secs !== lastTick.current) {
      lastTick.current = secs
      if (secs > 0 && secs <= 5) onTick?.(secs)
    }
    if (left <= 0 && !ended.current) {
      ended.current = true
      onEnd?.()
    }
  }, [secs, left])
  const pct = Math.max(0, Math.min(100, (left / (seconds * 1000)) * 100))
  return (
    <div className={`qzTimer${secs <= 5 ? " is-low" : ""}`} role="timer" aria-label={`${secs} seconds left`}>
      <div className="qzTimerFill" style={{ width: `${pct}%` }} />
      <span>{secs}s</span>
    </div>
  )
}

// A big heart that fills up to `percent`, counting up
export const HeartMeter = ({ percent, size = 120 }) => {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    let raf
    const start = performance.now()
    const step = (t) => {
      const k = Math.min(1, (t - start) / 1200)
      setShown(Math.round(percent * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [percent])
  const id = useMemo(() => `qzClip${Math.random().toString(36).slice(2)}`, [])
  return (
    <div className="qzMeter" style={{ width: size, height: size }}>
      <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
        <defs>
          <clipPath id={id}>
            <path d="M16 28C6 21 3 15.5 3 11.5A6.5 6.5 0 0 1 16 8.5a6.5 6.5 0 0 1 13 3c0 4-3 9.5-13 16.5z" />
          </clipPath>
        </defs>
        <path d="M16 28C6 21 3 15.5 3 11.5A6.5 6.5 0 0 1 16 8.5a6.5 6.5 0 0 1 13 3c0 4-3 9.5-13 16.5z" fill="#ffe3ef" />
        <rect clipPath={`url(#${id})`} x="0" width="32" y={28 - (shown / 100) * 21} height="32" fill="#ff4f8b" />
        <path d="M16 28C6 21 3 15.5 3 11.5A6.5 6.5 0 0 1 16 8.5a6.5 6.5 0 0 1 13 3c0 4-3 9.5-13 16.5z" fill="none" stroke="#a3123f" strokeWidth="1.2" />
        <path d="M8 10.5a3 3 0 0 1 3.5-2" stroke="#fff" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </svg>
      <span className="qzMeterText">{shown}%</span>
    </div>
  )
}

export const ResultCard = ({ title, percent, line, children, burst }) => (
  <div className="qzResult">
    <HeartBurst burst={burst} count={22} />
    <div className="qzResultTitle">{title}</div>
    {percent !== undefined && percent !== null && <HeartMeter percent={percent} />}
    {line && <p className="qzResultLine">{line}</p>}
    {children}
  </div>
)

export const Loading = ({ text = "Loading..." }) => (
  <div className="qzLoading">
    <span className="qzBeat">
      <Heart size={28} />
    </span>
    {text}
  </div>
)

export const Notice = ({ children, kind = "" }) => <div className={`qzNotice ${kind}`}>{children}</div>

// "Sign on to 98 Messenger" (async quizzes need an account on both ends)
export const SignOnPrompt = ({ what = "send and take quizzes" }) => {
  const { openMessenger } = useQuiz()
  return (
    <Notice>
      <p>
        Sign on to <b>98 Messenger</b> to {what}. Quizzes wait in each other's Inbox, so you can answer whenever you like.
      </p>
      <Big kind="is-small" onClick={openMessenger}>
        Open 98 Messenger
      </Big>
    </Notice>
  )
}

// Who to play with. kind "live": people online now (98 Messenger buddies and computers on
// the network); "async": any 98 Messenger screen name. -> onPick({ screenName } | { id, name })
export const PersonPicker = ({ kind, onPick, onCancel, title }) => {
  const { aim, net } = useQuiz()
  const partner = usePartner()
  const groups = useBuddyGroups()
  const [typed, setTyped] = useState("")
  const meKey = keyOf(aim?.me?.screenName)
  const buddies = []
  const seen = new Set()
  for (const g of groups) {
    for (const b of g.buddies) {
      const k = keyOf(b.screenName)
      if (seen.has(k) || k === meKey) continue
      if (kind === "live" && !b.online) continue
      seen.add(k)
      buddies.push({ name: b.screenName, target: { screenName: b.screenName }, note: b.online ? "online" : "offline", online: b.online })
    }
  }
  const computers =
    kind === "live"
      ? (net?.computers || []).filter((c) => !c.me && !seen.has(keyOf(c.name))).map((c) => ({ name: c.name, target: { id: c.id, name: c.name }, note: c.busy ? "playing a game" : c.user ? "on the network" : "guest on the network", online: true }))
      : []
  const people = [...buddies, ...computers]
  if (partner && !seen.has(keyOf(partner)) && keyOf(partner) !== meKey) people.unshift({ name: partner, target: { screenName: partner }, note: "your sweetheart", partner: true })
  else if (partner) {
    const i = people.findIndex((p) => keyOf(p.name) === keyOf(partner))
    if (i > 0) people.unshift({ ...people.splice(i, 1)[0], partner: true })
    else if (i === 0) people[0] = { ...people[0], partner: true }
  }

  return (
    <div className="qzPicker">
      <h3>{title || (kind === "live" ? "Who's playing?" : "Send it to...")}</h3>
      {people.length ? (
        <ul className="qzPeople">
          {people.map((p) => (
            <li key={`${p.name}:${p.target.id || ""}`}>
              <button type="button" className={`qzPerson${p.partner ? " is-partner" : ""}`} onClick={() => onPick(p.target, p.name)}>
                <span className="qzAvatar" aria-hidden="true">
                  {p.partner ? <Heart size={20} /> : p.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="qzPersonName">{p.name}</span>
                <span className={`qzPersonNote${p.online ? " is-on" : ""}`}>{p.note}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="qzHint">{kind === "live" ? "Nobody else is online right now. Ask someone to open 98ish, or send a quiz to answer later!" : "Add buddies in 98 Messenger, or type a screen name below."}</p>
      )}
      {kind === "async" && (
        <form
          className="qzTyped"
          onSubmit={(e) => {
            e.preventDefault()
            const name = typed.trim()
            if (name) onPick({ screenName: name }, name)
          }}
        >
          <label htmlFor="qz-to">Screen name:</label>
          <input id="qz-to" value={typed} maxLength={16} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          <button type="submit" disabled={!typed.trim()}>
            Pick
          </button>
        </form>
      )}
      {onCancel && (
        <button type="button" className="qzLink" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  )
}

// One question at a time, big buttons. questions: [{ type, text, options }]; names: {
// author, taker } for "which of us" questions. feedback(i) -> the right answer to show
// after picking (trivia), or omit. timer: seconds per question (0 = none).
// -> onDone(answers)
export const QuestionRunner = ({ questions, onDone, names = {}, feedback, timer = 0, lead, onAnswer }) => {
  const { sounds } = useQuiz()
  const [i, setI] = useState(0)
  const [answers, setAnswers] = useState([])
  const [picked, setPicked] = useState(null)
  const [text, setText] = useState("")
  const [deadline, setDeadline] = useState(() => (timer ? Date.now() + timer * 1000 : 0))
  const [burst, setBurst] = useState(0)
  const q = questions[i]

  useEffect(() => {
    setPicked(null)
    setText("")
    if (timer) setDeadline(Date.now() + timer * 1000)
  }, [i])

  const advance = (value) => {
    const next = [...answers, value]
    setAnswers(next)
    onAnswer?.(i, value)
    if (next.length >= questions.length) onDone(next)
    else setI(i + 1)
  }

  const pick = (value) => {
    if (picked !== null) return
    setPicked(value)
    const right = feedback ? feedback(i) : null
    if (feedback) {
      if (value === right) {
        sounds.right()
        setBurst((b) => b + 1)
      } else sounds.wrong()
    } else sounds.lock()
    setTimeout(() => advance(value), feedback ? 1100 : 350)
  }

  if (!q) return null
  const right = feedback && picked !== null ? feedback(i) : null
  const whoOptions = [names.author || "Them", `Me${names.taker ? ` (${names.taker})` : ""}`, "Both of us"]

  return (
    <div className="qzRunner">
      <HeartBurst burst={burst} count={12} />
      <Progress step={i} total={questions.length} />
      {timer > 0 && picked === null && (
        <TimerBar key={`t${i}`} deadline={deadline} seconds={timer} onTick={() => sounds.tick()} onEnd={() => picked === null && pick(null)} />
      )}
      {lead && <div className="qzLead">{lead(i)}</div>}
      <div className="qzQuestion" key={`q${i}`}>
        {q.text}
      </div>
      {q.type === "choice" && <Choices options={q.options} picked={picked} correct={right} onPick={pick} disabled={picked !== null} />}
      {q.type === "truefalse" && <Choices options={["True", "False"]} picked={picked === null ? null : picked ? 0 : 1} onPick={(n) => pick(n === 0)} disabled={picked !== null} letters={false} />}
      {q.type === "who" && <Choices options={whoOptions} picked={picked === null ? null : ["author", "taker", "both"].indexOf(picked)} onPick={(n) => pick(["author", "taker", "both"][n])} disabled={picked !== null} letters={false} />}
      {q.type === "text" && (
        <form
          className="qzTextAnswer"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) pick(text.trim())
          }}
        >
          <input value={text} maxLength={80} onChange={(e) => setText(e.target.value)} placeholder="Type your answer" aria-label="Your answer" autoFocus disabled={picked !== null} />
          <Big type="submit" disabled={!text.trim() || picked !== null}>
            Lock it in
          </Big>
        </form>
      )}
    </div>
  )
}
