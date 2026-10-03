import { useMemo, useState } from "react"
import { Big, Screen, useQuiz } from "./parts"
import { Heart } from "./art"
import { Host } from "./Host"
import { recordShow } from "./storage"
import { BetView, QuestionView, RevealView, RoundCard, ScoreBar, ShowResults, betWords, gainedWords, showQuestion } from "./Stage"
import { buildShow, newScore, packPool, scoreStep, startsRound, summarize } from "./shared/show.js"

// Pass the phone: a whole show on one device, for two people sitting together. Before each
// secret answer the phone is handed over ("Ana, no peeking!"), then the reveal is for both.

const TITLES = { knowme: "How Well Do You Know Me?", tot: "This or That" }

// Who's playing: two names (yours and your partner's to start with)
const Names = ({ mode, initial, onStart, onBack }) => {
  const [names, setNames] = useState(initial)
  const ok = names.every((n) => n.trim()) && names[0].trim().toLowerCase() !== names[1].trim().toLowerCase()
  return (
    <Screen title={TITLES[mode]} mode={mode} onBack={onBack}>
      <div className="qzPassNames">
        <Host line="One phone, two contestants. Who's playing tonight?" size="big" />
        <form
          className="qzNameForm"
          onSubmit={(e) => {
            e.preventDefault()
            if (ok) onStart(names.map((n) => n.trim()))
          }}
        >
          {[0, 1].map((i) => (
            <label key={i} className="qzNameField">
              <span>{i === 0 ? (mode === "knowme" ? "Player 1 (answers first)" : "Player 1") : "Player 2"}</span>
              <input value={names[i]} maxLength={16} onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))} autoComplete="off" />
            </label>
          ))}
          <Big type="submit" disabled={!ok} data-action="start-pass">
            Start the show!
          </Big>
        </form>
      </div>
    </Screen>
  )
}

export const PassPlay = ({ mode, options, initialNames, onHome }) => {
  const { packs } = useQuiz()
  const [names, setNames] = useState(null)
  const [game, setGame] = useState(0) // a new number starts a new show
  if (!names) return <Names mode={mode} initial={initialNames} onStart={setNames} onBack={onHome} />
  return <PassShow key={game} mode={mode} options={options} names={names} packs={packs} onHome={onHome} onAgain={() => setGame(game + 1)} />
}

const PassShow = ({ mode, options, names, packs, onHome, onAgain }) => {
  const steps = useMemo(() => {
    const fallback = mode === "tot" ? packs.pairs : packs.aboutMe.filter((q) => q.cat !== "flirty")
    return buildShow(mode, { pool: packPool(packs, mode, options.pack), fallback, count: options.count, timer: options.clock })
  }, [])
  // phase: round | bet | handoff | answer | reveal | done
  const { sounds } = useQuiz()
  const [s, setS] = useState({ i: 0, phase: "round", cardShown: 0, turn: 0, answers: [], current: [null, null], score: newScore(), outcomes: [], bets: null, deadline: null, saved: null })
  const step = steps[s.i]
  const order = mode === "knowme" ? [step.subject, 1 - step.subject] : [0, 1]
  const seat = order[s.turn]
  const patch = (p) => setS((x) => ({ ...x, ...p }))

  // the next screen of step i (after its round card / bets)
  const enterStep = (x, i) => {
    if (i >= steps.length) return finish(x)
    if (startsRound(steps, i) && x.cardShown !== i) return { ...x, i, phase: "round", cardShown: i, turn: 0, current: [null, null] }
    if (steps[i].bet && !x.bets) return { ...x, i, phase: "bet", turn: 0, current: [null, null] }
    return { ...x, i, phase: "handoff", turn: 0, current: [null, null] }
  }

  const finish = (x) => {
    const summary = summarize(mode, x.score, names)
    const facts =
      mode === "knowme"
        ? steps.map((st, i) => ({ subject: names[st.subject], qid: st.id, answer: x.answers[i]?.[st.subject] })).filter((f) => Number.isInteger(f.answer))
        : []
    const unlocked = recordShow({ mode, how: "pass", with: names[1], summary, points: x.score.points[0], won: summary.percent >= 55, perfect: mode === "knowme" && summary.percent === 100, facts })
    return { ...x, phase: "done", saved: { summary, unlocked } }
  }

  // an answer (null: out of time) locks in, then the phone goes to the other player, or to
  // the reveal
  const answer = (value) => {
    if (s.locked) return
    const current = s.current.map((a, k) => (k === seat ? value : a))
    patch({ current, locked: true })
    if (s.turn === 0) return setTimeout(() => patch({ turn: 1, phase: "handoff", deadline: null, locked: false }), 450)
    const { score, outcome } = scoreStep(mode, s.score, step, current, s.bets)
    setTimeout(() => patch({ score, outcomes: [...s.outcomes, outcome], answers: [...s.answers, current], phase: "reveal", deadline: null, locked: false, revealOpen: false, openAt: Date.now() + 1500 }), 450)
  }

  const title = TITLES[mode]
  // the new points show once the reveal opens (not during the drum roll)
  const hide = s.phase === "reveal" && !s.revealOpen ? s.outcomes[s.i]?.gained || [0, 0] : [0, 0]
  const players = names.map((name, k) => ({ name, points: s.score.points[k] - hide[k], streak: hide[k] ? 0 : mode === "tot" ? s.score.teamStreak : s.score.streak[k] }))
  const bar = s.phase !== "done" && <ScoreBar mode={mode} players={players} step={s.i} total={steps.length} highlight={s.phase === "handoff" || s.phase === "answer" ? seat : null} />

  let body
  if (s.phase === "round") {
    body = <RoundCard mode={mode} round={step.round} names={names} n={s.i} onGo={() => setS((x) => enterStep(x, x.i))} />
  } else if (s.phase === "bet") {
    // the final: each of you bets on your own guess
    const rows = [0, 1].map((k) => ({ name: names[k], points: s.score.points[k], bet: s.betDraft?.[k] || null, onText: `on guessing ${names[1 - k]}'s answer` }))
    body = (
      <BetView
        rows={rows}
        onBet={(k, id) => {
          const draft = [...(s.betDraft || [null, null])]
          draft[k] = id
          if (draft.every(Boolean)) setTimeout(() => setS((x) => enterStep({ ...x, bets: draft, betDraft: draft }, x.i)), 700)
          patch({ betDraft: draft })
        }}
      />
    )
  } else if (s.phase === "handoff") {
    const who = names[seat]
    const other = names[1 - seat]
    const what =
      mode === "tot" ? "You'll pick your side." : seat === step.subject ? "You'll answer a question about yourself." : `You'll guess what ${names[step.subject]} said.`
    body = (
      <div className="qzHandoff" data-seat={seat}>
        <div className="qzHandoffPhone" aria-hidden="true">
          <Heart size={34} />
        </div>
        <p className="qzHandoffKicker">Pass the phone to</p>
        <h2 className="qzHandoffName">{who}</h2>
        <p className="qzHandoffWhat">{what}</p>
        <p className="qzHandoffPeek">{other}, no peeking!</p>
        <Big onClick={() => (sounds.tap(), patch({ phase: "answer", deadline: step.timer ? Date.now() + step.timer * 1000 : null }))} data-action="ready">
          I'm {who}, show me!
        </Big>
      </div>
    )
  } else if (s.phase === "answer") {
    const aboutYou = mode === "knowme" && seat === step.subject
    const q = showQuestion(mode, packs, step.id, { aboutYou, name: names[step.subject] })
    const role = mode === "tot" ? { kind: "pick", other: names[1 - seat] } : aboutYou ? { kind: "self", other: names[1 - seat] } : { kind: "guess", name: names[step.subject] }
    body = <QuestionView key={`${s.i}:${s.turn}`} step={{ ...step, betText: step.bet && !aboutYou && s.bets ? betWords(s.bets[seat], s.score.points[seat]) : null }} role={role} text={q.text} options={q.options} picked={s.current[seat]} done={s.locked} onPick={answer} deadline={s.deadline} seconds={step.timer} onTimeUp={() => answer(null)} />
  } else if (s.phase === "reveal") {
    const o = s.outcomes[s.i]
    const subject = step.subject ?? 0
    const q = showQuestion(mode, packs, step.id, { name: names[subject] })
    const cards =
      mode === "tot"
        ? [0, 1].map((k) => ({ label: `${names[k]} picked`, answer: s.current[k] }))
        : [
            { label: `${names[subject]} said`, answer: s.current[subject] },
            { label: `${names[1 - subject]} guessed`, answer: s.current[1 - subject] },
          ]
    const last = s.i + 1 >= steps.length
    body = (
      <RevealView
        mode={mode}
        step={step}
        n={s.i}
        text={q.text}
        options={q.options}
        cards={cards}
        match={o.match}
        showAt={s.openAt}
        onOpen={() => patch({ revealOpen: true })}
        onFire={o.onFire}
        streak={o.streak}
        guesserName={mode === "knowme" ? names[o.guesser] : names.join(" & ")}
        timedOut={mode === "knowme" && (s.current[subject] === null || s.current[1 - subject] === null)}
        betWon={step.bet && o.match}
        gainedLine={gainedWords(mode, o.gained, names, o.guesser)}
        nextLabel={last ? "See the results!" : "Next question"}
        onNext={() => setS((x) => enterStep(x, x.i + 1))}
      />
    )
  } else {
    const { summary, unlocked } = s.saved
    const winner = summary.winner
    const recap = steps.map((st, i) => {
      const q = showQuestion(mode, packs, st.id, { name: names[st.subject ?? 0] })
      const a = s.answers[i] || [null, null]
      const text = (k) => (a[k] === null || a[k] === undefined ? "(no answer)" : q.options[a[k]])
      return {
        text: q.text,
        match: s.outcomes[i]?.match,
        answers: mode === "tot" ? [0, 1].map((k) => ({ label: names[k], text: text(k) })) : [{ label: `${names[st.subject]} said`, text: text(st.subject) }, { label: `${names[1 - st.subject]} guessed`, text: text(1 - st.subject) }],
      }
    })
    body = (
      <ShowResults
        mode={mode}
        summary={{ ...summary, tier: summary.tier.name }}
        players={names.map((name, k) => ({ name, points: s.score.points[k], best: mode === "tot" ? s.score.teamBest : s.score.best[k], winner: winner === k }))}
        recap={recap}
        unlocked={unlocked}
        onAgain={onAgain}
        againLabel="Rematch!"
        onHome={onHome}
      />
    )
  }

  return (
    <Screen title={title} mode={mode} onBack={onHome} className={`qzShow is-${s.phase}`}>
      {bar}
      <div className="qzShowBody" key={`${s.phase}:${s.i}:${s.turn}`}>
        {body}
      </div>
    </Screen>
  )
}
