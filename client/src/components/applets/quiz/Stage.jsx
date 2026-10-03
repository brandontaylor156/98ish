import { useEffect, useRef, useState } from "react"
import { Big, Choices, HeartMeter, TimerBar, useQuiz } from "./parts"
import { Heart } from "./art"
import { Host } from "./Host"
import { BETS, betAmount, hostLine, roundInfo } from "./shared/show.js"

// The stage of a show (How Well Do You Know Me, This or That), shared by live games and
// pass-the-phone games: the scoreboard, a round's title card with its count-in, the
// question, the drum-roll reveal with both answers side by side, the big bet, confetti, and
// the results. Screens pass plain values in; nothing here talks to the server.

// A show's question as one person sees it -> { text, options }. aboutYou: you're the one
// answering about yourself; name: whose answer is being guessed.
export const showQuestion = (mode, packs, id, { aboutYou = false, name = "they" } = {}) => {
  if (mode === "tot") {
    const p = packs.pairs.find((x) => x.id === id)
    if (!p) return { text: "?", options: ["?", "?"] }
    return { text: p.kind === "wyr" ? "Would you rather..." : `${p.a} or ${p.b}?`, options: [p.a, p.b], kicker: p.kind === "date" ? "Date night" : p.kind === "wyr" ? null : "This or that?" }
  }
  const q = packs.aboutMe.find((x) => x.id === id)
  if (!q) return { text: "?", options: [] }
  return { text: aboutYou ? q.me : q.them.replace(/\{name\}/g, name), options: q.options }
}

// What a step gained, in words: "+250 for Ben", "-100 for Ana (the bet)", "+200 each"
export const gainedWords = (mode, gained, names, guesser) => {
  if (mode === "tot") return gained[0] > 0 ? `+${gained[0]} each` : null
  const g = gained[guesser]
  if (!g) return null
  return g > 0 ? `+${g} for ${names[guesser]}` : `${g} for ${names[guesser]}`
}

// "All in! (450 pts)"
export const betWords = (id, points) => (id ? `${BETS.find((b) => b.id === id)?.name} (${betAmount(id, points)} pts)` : null)

// ---------- little pictures ----------

export const Flame = ({ size = 14 }) => (
  <svg className="qzIcon" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
    <path d="M8 1c1 3 4 4.5 4 8.5A4 4 0 0 1 4 9.5C4 7 5.5 6 6 4c1 1.5 1 2.5 2 3 .5-2 .5-4 0-6z" fill="#ff8a2a" stroke="#a33a00" strokeWidth="0.8" />
    <path d="M8 8.5c.8 1.2 1.8 1.8 1.8 3.2a1.8 1.8 0 0 1-3.6 0c0-1 .8-1.6 1.8-3.2z" fill="#ffe066" />
  </svg>
)

export const Crown = ({ size = 18 }) => (
  <svg className="qzIcon" viewBox="0 0 20 16" width={size} height={(size * 16) / 20} aria-hidden="true">
    <path d="M2 13L1 4l5 4 4-7 4 7 5-4-1 9z" fill="#ffd23f" stroke="#8a6d1a" strokeWidth="1" strokeLinejoin="round" />
    <circle cx="10" cy="9" r="1.6" fill="#ff4f8b" />
  </svg>
)

// Confetti falling over the stage: show it with a new `fire` number each time
const CONFETTI = ["#ff4f8b", "#ffd23f", "#7ec8ff", "#8be3a4", "#c94fff", "#ff9a76"]
export const Confetti = ({ fire, count = 46 }) => {
  const [shown, setShown] = useState(null)
  useEffect(() => {
    if (!fire) return
    setShown(fire)
    const t = setTimeout(() => setShown(null), 3200)
    return () => clearTimeout(t)
  }, [fire])
  if (!shown) return null
  return (
    <div className="qzConfetti" key={shown} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i
          key={i}
          style={{
            "--x": `${(i * 37 + shown * 11) % 100}%`,
            "--c": CONFETTI[i % CONFETTI.length],
            "--d": `${(i % 9) * 0.11}s`,
            "--t": `${1.8 + ((i * 7) % 10) / 10}s`,
            "--r": `${((i * 53) % 360) - 180}deg`,
            "--s": `${0.7 + ((i * 3) % 5) / 6}`,
          }}
        />
      ))}
    </div>
  )
}

// A number that counts up to its value
export const CountUp = ({ value }) => {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf
    const step = (t) => {
      const k = Math.min(1, (t - start) / 700)
      setShown(Math.round(a + (value - a) * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(step)
      else from.current = value
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{shown}</>
}

// Seconds left until a time on this computer's clock (0 when it's passed)
export const useSecondsTo = (until) => {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!until) return
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [until])
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0
}

// ---------- the scoreboard ----------

const Plate = ({ name, points, streak, you, team, highlight }) => (
  <div className={`qzPlate${you ? " is-you" : ""}${team ? " is-team" : ""}${highlight ? " is-on" : ""}`}>
    <span className="qzPlateAvatar" aria-hidden="true">
      {you || team ? <Heart size={18} /> : (name || "?").slice(0, 1).toUpperCase()}
    </span>
    <span className="qzPlateText">
      <span className="qzPlateName">{name}</span>
      <b className="qzPlatePoints">
        <CountUp value={points} /> <small>pts</small>
      </b>
    </span>
    {streak >= 2 && (
      <span className="qzPlateStreak" title={`${streak} in a row`}>
        <Flame /> {streak}
      </span>
    )}
  </div>
)

// players: [{ name, points, streak, you }]; for This or That one team plate.
// highlight: the index of whoever's turn it is
export const ScoreBar = ({ mode, players, step, total, highlight = null }) => {
  const label = total ? `${Math.min(step + 1, total)}/${total}` : ""
  if (mode === "tot") {
    const team = { name: players.map((p) => p.name).join(" & "), points: players[0]?.points || 0, streak: players[0]?.streak || 0 }
    return (
      <div className="qzScoreBar is-team">
        <Plate {...team} team />
        <span className="qzScoreStep">{label}</span>
      </div>
    )
  }
  return (
    <div className="qzScoreBar">
      <Plate {...players[0]} highlight={highlight === 0} />
      <span className="qzScoreStep">{label}</span>
      <Plate {...players[1]} highlight={highlight === 1} />
    </div>
  )
}

// ---------- a round's title card ----------

const ROUND_LINES = { one: "start", warmup: "start", two: "double", double: "double", lightning: "lightning", final: "final" }

// until: the count-in ends then (live); otherwise a button starts the round (one phone)
// you: which of `names` is looking at it (live games), so the card can say "you"
export const RoundCard = ({ mode, round, names, you = null, until, onGo, onSkip, n = 0 }) => {
  const { sounds } = useQuiz()
  const info = { ...roundInfo(mode, round, names) }
  const subject = round === "one" ? 0 : round === "two" ? 1 : null
  if (mode === "knowme" && subject !== null && you !== null) {
    const other = names[1 - subject]
    info.title = you === subject ? "All about you!" : `All about ${names[subject]}`
    info.text = you === subject ? `Answer about yourself (secretly!). ${other} guesses what you said.` : `${names[subject]} answers about themself (secretly!). You guess what they said.`
  }
  const secs = useSecondsTo(until)
  const last = useRef(null)
  useEffect(() => {
    sounds.whoosh()
  }, [round])
  useEffect(() => {
    if (!until || secs === last.current) return
    last.current = secs
    if (secs >= 1 && secs <= 3) sounds.beep(secs === 1)
  }, [secs])
  const line = round === "two" ? "Switcheroo! Same game, new hot seat." : hostLine(ROUND_LINES[round] || "start", n)
  return (
    <div className={`qzRoundCard is-${round}`} data-round={round}>
      <div className="qzRoundKicker">{info.kicker}</div>
      <h2 className="qzRoundTitle">{info.title}</h2>
      <p className="qzRoundText">{info.text}</p>
      {(round === "double" || round === "one" || round === "two") && mode === "knowme" && <p className="qzRoundNote">The last question of the round is worth double points!</p>}
      <Host line={line} mood={round === "final" || round === "lightning" ? "wow" : "happy"} />
      {until ? (
        <div className="qzCountIn" aria-live="polite">
          {secs > 3 ? <span className="qzCountWord">Get ready...</span> : <span className="qzCountNum" key={secs}>{secs || "Go!"}</span>}
          {onSkip && (
            <button type="button" className="qzLink" onClick={onSkip}>
              Skip
            </button>
          )}
        </div>
      ) : (
        <div className="qzActions">
          <Big onClick={onGo} data-action="go">
            Let's go!
          </Big>
        </div>
      )}
    </div>
  )
}

// ---------- a question ----------

// The chip above a question: the round, double points, lightning, the bet
export const StepBadges = ({ step }) => (
  <div className="qzBadgeRow">
    {step.round === "lightning" && <span className="qzChip is-lightning">Lightning round</span>}
    {step.mult > 1 && <span className="qzChip is-double">Double points!</span>}
    {step.bet && <span className="qzChip is-bet">The Big Bet{step.betText ? `: ${step.betText}` : ""}</span>}
  </div>
)

// role: { kind: "self" | "guess" | "pick", name } (whose answer is being guessed)
// done: locked in (even without a pick, when time ran out)
export const QuestionView = ({ step, role, text, options, picked, done = false, onPick, deadline, seconds, waiting, onTimeUp }) => {
  const { sounds } = useQuiz()
  const answered = done || (picked !== null && picked !== undefined)
  const banner =
    role.kind === "self" ? (
      <>
        <b>About you!</b> Answer honestly. {role.other ? `${role.other} can't see it.` : "It stays secret."}
      </>
    ) : role.kind === "guess" ? (
      <>
        <b>Guess!</b> What did {role.name} say?
      </>
    ) : (
      <>
        <b>Pick your side!</b> Same as {role.other || "your partner"}? You both score.
      </>
    )
  return (
    <div className={`qzAsk is-${role.kind}`}>
      <StepBadges step={step} />
      {deadline && !answered ? (
        <TimerBar key={deadline} deadline={deadline} seconds={seconds} onTick={() => sounds.tick()} onEnd={onTimeUp} />
      ) : (
        <div className="qzTimerSpacer" />
      )}
      <div className={`qzRole is-${role.kind}`}>{banner}</div>
      <div className="qzQuestion" key={text}>
        {text}
      </div>
      <Choices options={options} picked={answered ? picked : null} disabled={answered} letters={options.length > 2} onPick={(i) => (sounds.lock(), onPick(i))} />
      {answered && (
        <div className="qzWaiting" aria-live="polite">
          <span className="qzBeat">
            <Heart size={14} />
          </span>{" "}
          {waiting || "Locked in!"}
        </div>
      )}
    </div>
  )
}

// ---------- the reveal ----------

// cards: [{ label: "Ana said", answer: index | null }, { label: "Ben guessed", ... }]
// showAt: the reveal opens then (this computer's clock); before that, a drum roll.
// onOpen(n): it's open (the scoreboard can show the new points now)
export const RevealView = ({ mode, step, n, text, options, cards, match, gainedLine, showAt: openAt, onFire, streak, guesserName, timedOut, betWon, onNext, nextLabel, canNext = true, footer, onOpen }) => {
  const { sounds } = useQuiz()
  const showAt = useRef(null)
  if (showAt.current === null || showAt.current.n !== n) showAt.current = { n, at: openAt || Date.now() + 1600 }
  const [open, setOpen] = useState(() => Date.now() >= showAt.current.at)
  const [burst, setBurst] = useState(0)
  useEffect(() => {
    const wait = showAt.current.at - Date.now()
    if (wait <= 0) {
      setOpen(true)
      return
    }
    setOpen(false)
    sounds.longroll()
    const t = setTimeout(() => setOpen(true), wait)
    return () => clearTimeout(t)
  }, [n])
  // a moment to enjoy it before Next
  const [ready, setReady] = useState(false)
  useEffect(() => {
    setReady(false)
    if (!open) return
    const t = setTimeout(() => setReady(true), 1000)
    return () => clearTimeout(t)
  }, [open, n])
  useEffect(() => {
    if (!open) return
    onOpen?.(n)
    if (match) {
      sounds.match()
      if (step.bet) sounds.cash()
      if (onFire || step.mult > 1 || step.bet) sounds.cheer()
      setBurst((b) => b + 1)
    } else sounds.wahwah()
  }, [open])
  const kind = mode === "tot" ? (match ? "totMatch" : "totMiss") : timedOut ? "timeout" : step.bet ? (match ? "betWin" : "betLose") : onFire ? "fire" : match ? "match" : "miss"
  const line = hostLine(kind, n, { name: guesserName, n: streak })
  return (
    <div className={`qzRevealStage${open ? " is-open" : ""}${match ? " is-match" : " is-miss"}`} data-open={open ? "1" : "0"}>
      <Confetti fire={burst} />
      <StepBadges step={step} />
      <div className="qzQuestion is-small">{text}</div>
      <div className="qzDuo">
        {cards.map((c, i) => (
          <div key={i} className={`qzFlip${open ? " is-flipped" : ""}`} style={{ "--delay": `${i * 0.25}s` }}>
            <div className="qzFlipInner">
              <div className="qzFlipFront">
                <span className="qzFlipQ">?</span>
                <small>{c.label}</small>
              </div>
              <div className={`qzFlipBack${match ? " is-match" : ""}`}>
                <small>{c.label}</small>
                <b>{c.answer === null || c.answer === undefined ? "(no answer)" : options[c.answer]}</b>
              </div>
            </div>
          </div>
        ))}
      </div>
      {open ? (
        <>
          <div className={`qzVerdict${match ? " is-match" : ""}`}>
            {match ? (mode === "tot" ? "Same pick!" : "It's a match!") : mode === "tot" ? "Split decision!" : timedOut ? "Out of time!" : "No match!"}
            {gainedLine && <span className="qzGained">{gainedLine}</span>}
          </div>
          <Host line={line} mood={match ? (betWon || onFire ? "wow" : "happy") : "sad"} />
          <div className="qzActions">
            <Big onClick={onNext} disabled={!canNext || !ready} data-action="next">
              {nextLabel}
            </Big>
          </div>
          {footer}
        </>
      ) : (
        <div className="qzDrumroll" aria-live="polite">
          <span className="qzDrums" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          Drum roll, please...
        </div>
      )}
    </div>
  )
}

// ---------- the big bet ----------

// rows: [{ name, points, bet, you, onText: "on guessing Ana's answer", hidden, decided }];
// onBet(rowIndex, id). hidden: someone else's bet (secret), decided: they've placed it
export const BetView = ({ rows, onBet, deadline, seconds, waiting }) => {
  const { sounds } = useQuiz()
  return (
    <div className="qzBet">
      <h2 className="qzBetTitle">The Big Bet</h2>
      <Host line="Bet on your final guess. Right? You win your bet. Wrong? You lose it!" mood="wink" />
      {deadline && <TimerBar key={deadline} deadline={deadline} seconds={seconds} onTick={() => sounds.tick()} />}
      {rows.map((r, i) => (
        <div key={i} className="qzBetRow" data-bet-row={i}>
          <div className="qzBetWho">
            <b>{r.you ? "Your bet" : `${r.name}'s bet`}</b> <small>{r.onText} &middot; {r.points} pts now</small>
          </div>
          {r.bet ? (
            <div className="qzBetPlaced">
              Bet placed: <b>{BETS.find((b) => b.id === r.bet)?.name}</b> ({betAmount(r.bet, r.points)} pts)
            </div>
          ) : r.hidden ? (
            <div className="qzBetPlaced">{r.decided ? `${r.name} has placed a bet. Shh, it's secret!` : `${r.name} is thinking...`}</div>
          ) : (
            <div className="qzBetChoices">
              {BETS.map((b) => (
                <button key={b.id} type="button" className={`qzBetBtn is-${b.id}`} data-bet={b.id} onClick={() => (sounds.lock(), onBet(i, b.id))}>
                  <b>{b.name}</b>
                  <small>{betAmount(b.id, r.points)} pts</small>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      {waiting && <div className="qzWaiting">{waiting}</div>}
    </div>
  )
}

// ---------- results ----------

// summary: { headline, tier, line, percent }; players: [{ name, points, best, you, winner }]
// recap: [{ text, answers: [{ label, text }], match }]
export const ShowResults = ({ mode, summary, players, recap = [], note, unlocked, onAgain, againLabel = "Play again", onHome, extra }) => {
  const { sounds } = useQuiz()
  const [fire, setFire] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => {
      sounds.fanfare()
      if (summary.percent >= 55) setFire(1)
    }, 400)
    return () => clearTimeout(t)
  }, [])
  const ranked = mode === "tot" ? [] : [...players].sort((a, b) => b.points - a.points)
  return (
    <div className="qzFinale">
      <Confetti fire={fire} count={70} />
      {note && <div className="qzNotice is-warn">{note}</div>}
      <div className="qzFinaleKicker">And the verdict is...</div>
      <h2 className="qzFinaleTier">{summary.tier}!</h2>
      <HeartMeter percent={summary.percent} size={110} />
      <p className="qzFinaleHeadline">{summary.headline}</p>
      <Host line={hostLine(`results:${summary.tier}`)} mood={summary.percent >= 55 ? "wow" : "wink"} />
      {mode === "tot" ? (
        <div className="qzTeamTotal">
          Team score: <b>{players[0]?.points ?? 0}</b> pts &middot; best streak {players[0]?.best ?? 0}
        </div>
      ) : (
        <ol className="qzPodium2">
          {ranked.map((p, i) => (
            <li key={p.name + i} className={`${p.winner ? "is-winner" : ""}${p.you ? " is-you" : ""}`}>
              <span className="qzPodiumPlace">{p.winner ? <Crown /> : i + 1}</span>
              <span className="qzPodiumName">{p.you ? `${p.name} (you)` : p.name}</span>
              <span className="qzPodiumPts">
                {p.points} pts{p.best >= 2 ? <small> &middot; best streak {p.best}</small> : null}
              </span>
            </li>
          ))}
          {ranked.length === 2 && !ranked.some((p) => p.winner) && <li className="qzPodiumTie">It's a tie! Perfectly matched.</li>}
        </ol>
      )}
      {unlocked && (
        <div className="qzUnlock">
          <b>New pack unlocked:</b> {unlocked}
        </div>
      )}
      {extra}
      <div className="qzActions">
        {onAgain && (
          <Big onClick={onAgain} data-action="again">
            {againLabel}
          </Big>
        )}
        <Big kind="is-alt" onClick={onHome}>
          Back to the studio
        </Big>
      </div>
      {recap.length > 0 && (
        <details className="qzRecap">
          <summary>See every answer</summary>
          <ul>
            {recap.map((r, i) => (
              <li key={i} className={r.match ? "is-match" : ""}>
                <span className="qzRecapQ">{r.text}</span>
                {r.answers.map((a, j) => (
                  <span key={j} className="qzRecapA">
                    {a.label}: <b>{a.text}</b>
                  </span>
                ))}
                {r.match && <Heart size={14} />}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
