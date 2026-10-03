import { useState } from "react"
import { Big, Notice, Screen, usePartnerInfo, useQuiz } from "./parts"
import { HowTo } from "./HowTo"
import { Host } from "./Host"
import { setQuizData, showsPlayed, useQuizData } from "./storage"
import { LENGTHS, TIMES, defaultPack, isUnlocked, packsFor } from "./shared/show.js"

// Setting up a show (How Well Do You Know Me, This or That): how you're playing (live on
// two phones, passing one phone, or taking turns), the question pack, how long, and the
// clock. The first time, "How to play" opens on top.

const TITLES = { knowme: "How Well Do You Know Me?", tot: "This or That" }
const PITCH = {
  knowme: "One of you answers about yourself, the other guesses. Match to score!",
  tot: "Quick picks, both at once. Pick the same side and you both score!",
}

const WAYS = (partner) => [
  { id: "live", title: "Live, on two phones", text: partner ? `You and ${partner} play at the same time, each on your own screen. Reveals pop up on both at once.` : "Each on your own screen, at the same time. Reveals pop up on both at once." },
  { id: "pass", title: "Pass the phone", text: "Sitting together? Play on this one device and hand it back and forth." },
  { id: "turns", title: "Take turns", text: partner ? `Answer now; ${partner} gets a notification and plays when they're free.` : "Answer now; they get a notification and play when they're free." },
]

export const Setup = ({ mode, onBack, onLive, onPass, onTurns }) => {
  const { aim, net, sounds } = useQuiz()
  const data = useQuizData()
  const { partner, online } = usePartnerInfo()
  const saved = data.setup?.[mode] || {}
  const shows = showsPlayed(data)
  const packs = packsFor(mode)
  const [how, setHow] = useState(saved.how || (partner && online ? "live" : partner ? "turns" : "pass"))
  const [pack, setPack] = useState(isUnlocked(packs.find((p) => p.id === saved.pack), shows) ? saved.pack : defaultPack(mode))
  const [count, setCount] = useState(LENGTHS[mode].some((l) => l.count === saved.count) ? saved.count : LENGTHS[mode][1].count)
  const [clock, setClock] = useState(saved.clock !== false)
  const [howTo, setHowTo] = useState(!data.howto?.[mode])
  const [busy, setBusy] = useState(false)

  const options = { pack, count, clock }
  const netOnline = net?.status === "online"
  const signedIn = !!aim?.token
  const problem =
    how === "live" && !netOnline
      ? "Live games need the network, and it isn't answering right now. Try passing the phone!"
      : how === "turns" && !signedIn
        ? "Taking turns needs 98 Messenger (that's how the quiz finds them). Sign on first, or pass the phone."
        : null
  const go = async () => {
    sounds.tap()
    setQuizData((d) => ({ setup: { ...d.setup, [mode]: { how, ...options } } }))
    if (how === "pass") return onPass(options)
    if (how === "turns") return onTurns(options)
    setBusy(true)
    await onLive(options)
    setBusy(false)
  }
  const goLabel = how === "pass" ? "Start the show!" : how === "turns" ? (mode === "knowme" ? "Answer my questions" : "Make my picks") : partner ? `Invite ${partner}` : "Open the studio"

  return (
    <Screen title={TITLES[mode]} mode={mode} onBack={onBack} className="qzSetup2">
      <div className="qzSetupHead">
        <Host line={PITCH[mode]} />
        <button type="button" className="qzHowBtn" onClick={() => setHowTo(true)} data-action="howto">
          ? How to play
        </button>
      </div>

      <h3 className="qzSection">How are you playing?</h3>
      <div className="qzWays" role="radiogroup" aria-label="How are you playing?">
        {WAYS(partner).map((w) => (
          <button key={w.id} type="button" role="radio" aria-checked={how === w.id} className={`qzWay${how === w.id ? " is-on" : ""}`} data-way={w.id} onClick={() => (sounds.tap(), setHow(w.id))}>
            <span className="qzRadio" aria-hidden="true" />
            <span className="qzWayText">
              <b>
                {w.title}
                {w.id === "live" && partner && <span className={`qzDot${online ? " is-on" : ""}`}>{online ? `${partner} is online` : `${partner} is offline`}</span>}
              </b>
              <small>{w.text}</small>
            </span>
          </button>
        ))}
      </div>

      <h3 className="qzSection">Question pack</h3>
      <div className="qzPacks">
        {packs.map((p) => {
          const open = isUnlocked(p, shows)
          const left = p.unlock - shows
          return (
            <button key={p.id} type="button" className={`qzPack${pack === p.id ? " is-on" : ""}${open ? "" : " is-locked"}`} disabled={!open} data-pack={p.id} onClick={() => (sounds.tap(), setPack(p.id))} aria-pressed={pack === p.id}>
              <b>
                {!open && <Lock />}
                {p.name}
              </b>
              <small>{open ? p.blurb : `Play ${left} more show${left === 1 ? "" : "s"} to unlock`}</small>
            </button>
          )
        })}
      </div>

      <h3 className="qzSection">Length</h3>
      <div className="qzSeg" role="radiogroup" aria-label="Length">
        {LENGTHS[mode].map((l) => (
          <button key={l.count} type="button" role="radio" aria-checked={count === l.count} className={count === l.count ? "is-on" : ""} onClick={() => setCount(l.count)}>
            <b>{l.name}</b> <small>{mode === "knowme" ? `${l.count} each` : `${l.count} picks`}</small>
          </button>
        ))}
      </div>
      <div className="qzToggle">
        <input id={`qz-clock-${mode}`} type="checkbox" checked={clock} onChange={(e) => setClock(e.target.checked)} />
        <label htmlFor={`qz-clock-${mode}`}>Ticking clock ({TIMES.normal} seconds a question). The lightning round is always timed!</label>
      </div>

      {problem && <Notice kind="is-warn">{problem}</Notice>}
      {how === "live" && partner && !online && !problem && <Notice>{partner} doesn't look signed on right now. You can still invite them, or try "Take turns".</Notice>}
      <div className="qzActions qzSticky">
        <Big onClick={go} disabled={!!problem || busy} data-action="go-show">
          {busy ? "Opening the studio..." : goLabel}
        </Big>
      </div>
      {howTo && <HowTo mode={mode} onDone={() => setHowTo(false)} />}
    </Screen>
  )
}

const Lock = () => (
  <svg className="qzIcon" viewBox="0 0 12 14" width="11" height="13" aria-hidden="true">
    <rect x="1" y="6" width="10" height="7" rx="1.5" fill="#8a6d1a" />
    <path d="M3 6V4a3 3 0 0 1 6 0v2" fill="none" stroke="#8a6d1a" strokeWidth="1.6" />
  </svg>
)
