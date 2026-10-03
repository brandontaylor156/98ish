import { useEffect, useMemo, useState } from "react"
import { Big, Choices, Loading, Notice, PersonPicker, QuestionRunner, ResultCard, Screen, SignOnPrompt, useQuiz } from "./parts"
import { Heart, ModeIcon } from "./art"
import { Host } from "./Host"
import { RevealView, ScoreBar, ShowResults, gainedWords, showQuestion } from "./Stage"
import { addFacts, bumpStat, getQuizData, recordGame, recordShow, setQuizData } from "./storage"
import { challengeQuestions, KIND_NAMES, LIMITS, pickSome, soulmateLine } from "./shared/logic.js"
import { newScore, packPool, scoreStep, summarize } from "./shared/show.js"
import { CompatCard } from "./Modes"

// A taken-turns show, played back: [author, taker] answers, the last question for double
// -> { steps, score, outcomes, summary }
export const asyncShow = (c) => {
  const mode = c.kind
  const n = c.payload.items.length
  const steps = c.payload.items.map((id, i) => ({ id, subject: mode === "knowme" ? 0 : null, round: mode === "knowme" ? "one" : "warmup", mult: i === n - 1 ? 2 : 1, base: 100, timer: 0, bet: false }))
  let score = newScore()
  const outcomes = steps.map((step, i) => {
    const r = scoreStep(mode, score, step, [c.authorAnswers?.[i] ?? null, c.takerAnswers?.[i] ?? null])
    score = r.score
    return r.outcome
  })
  return { steps, score, outcomes, summary: summarize(mode, score, [c.from, c.to]) }
}

// Quizzes that wait for someone: answer about yourself now, they guess later. Results
// wait in both Inboxes (server/quiz).

const MODE_ICON = { knowme: "knowme", tot: "tot", custom: "builder", compat: "compat" }

// ---------- sending How Well Do You Know Me / This or That ----------

// options: { pack, count } from the show setup: straight to answering (after picking who,
// unless it's your partner)
export const AsyncSend = ({ kind, preset = null, options = null, onBack, go }) => {
  const { aim, api, packs, sounds } = useQuiz()
  const [to, setTo] = useState(preset)
  const [count, setCount] = useState(options?.count ? Math.min(LIMITS.maxItems, Math.max(LIMITS.minItems, options.count)) : kind === "knowme" ? 5 : 10)
  const pool = useMemo(() => (options?.pack ? packPool(packs, kind, options.pack) : kind === "knowme" ? packs.aboutMe : packs.pairs), [])
  const [items, setItems] = useState(() => (options && preset ? pickSome(pool, count).map((q) => q.id) : null))
  const [step, setStep] = useState(preset ? (options ? "answer" : "setup") : "who")
  const [error, setError] = useState(null)
  const title = KIND_NAMES[kind]

  const questions = useMemo(() => {
    if (!items) return []
    if (kind === "knowme") return items.map((id) => packs.aboutMe.find((q) => q.id === id)).map((q) => ({ type: "choice", text: q.me, options: q.options }))
    return items.map((id) => packs.pairs.find((p) => p.id === id)).map((p) => ({ type: "choice", text: p.kind === "wyr" ? "Would you rather..." : `${p.a} or ${p.b}?`, options: [p.a, p.b] }))
  }, [items])

  if (!aim?.token && step !== "sent") {
    return (
      <Screen title={title} mode={MODE_ICON[kind]} onBack={onBack}>
        <SignOnPrompt what="send a quiz to answer later" />
      </Screen>
    )
  }

  const begin = () => {
    sounds.tap()
    setItems(pickSome(pool, count).map((q) => q.id))
    setStep("answer")
  }

  const send = async (answers) => {
    setStep("sending")
    const result = await api.send({ kind, to: to.screenName, items, answers })
    if (!result.ok) {
      setError(result.error)
      setStep("error")
      return
    }
    bumpStat("sent")
    sounds.pop()
    setStep("sent")
  }

  return (
    <Screen title={title} mode={MODE_ICON[kind]} onBack={onBack}>
      {step === "who" && (
        <PersonPicker
          kind="async"
          title={kind === "knowme" ? "Who should guess your answers?" : "Who's comparing picks with you?"}
          onPick={(target) => {
            setTo(target)
            if (options) {
              setItems(pickSome(pool, count).map((q) => q.id))
              setStep("answer")
            } else setStep("setup")
          }}
        />
      )}
      {step === "setup" && (
        <div className="qzSetup">
          <p className="qzIntro">
            {kind === "knowme" ? (
              <>
                Answer a few questions <b>about yourself</b>. Then <b>{to.screenName}</b> tries to guess what you said. No peeking: your answers stay secret until they've guessed!
              </>
            ) : (
              <>
                Pick your side of each pair. <b>{to.screenName}</b> picks theirs later, then you'll both see where you match.
              </>
            )}
          </p>
          <div className="qzSeg" role="radiogroup" aria-label="How many questions">
            {(kind === "knowme" ? [5, 8, 10] : [5, 10, 15]).map((n) => (
              <button key={n} type="button" role="radio" aria-checked={count === n} className={count === n ? "is-on" : ""} onClick={() => setCount(n)}>
                {n} questions
              </button>
            ))}
          </div>
          <div className="qzActions">
            <Big onClick={begin}>Let's go!</Big>
            {!preset && (
              <Big kind="is-alt" onClick={() => setStep("who")}>
                Pick someone else
              </Big>
            )}
          </div>
        </div>
      )}
      {step === "answer" && (
        <>
          <div className="qzRole is-self">
            {kind === "knowme" ? (
              <>
                <b>About you!</b> Answer honestly. {to.screenName} will try to guess these later.
              </>
            ) : (
              <>
                <b>Your picks!</b> {to.screenName} picks later; matches score.
              </>
            )}
          </div>
          <QuestionRunner questions={questions} onDone={send} lead={() => (kind === "knowme" ? "About you" : "Your pick")} />
        </>
      )}
      {step === "sending" && <Loading text="Sending..." />}
      {step === "sent" && (
        <ResultCard title="Sent with love!" burst={1}>
          <Host line={`Your answers are sealed! ${to.screenName} gets a notification, and when they've played, the reveal is waiting in your Inbox.`} />
          <p className="qzResultLine">
            Your turn is done. Now it's <b>{to.screenName}</b>'s turn to {kind === "knowme" ? "guess" : "pick"}.
          </p>
          <div className="qzActions">
            <Big onClick={() => go({ id: "inbox" })}>Go to my Inbox</Big>
            <Big kind="is-alt" onClick={onBack}>
              Back to the menu
            </Big>
          </div>
        </ResultCard>
      )}
      {step === "error" && (
        <Notice kind="is-error">
          <p>{error}</p>
          <Big kind="is-small" onClick={() => setStep(to ? "setup" : "who")}>
            Try again
          </Big>
        </Notice>
      )}
    </Screen>
  )
}

// ---------- the Inbox ----------

const ago = (t) => {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000))
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

export const Inbox = ({ onBack, go }) => {
  const { aim, api, net } = useQuiz()
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const load = async () => {
    const result = await api.inbox()
    if (result.ok) setList(result.challenges)
    else setError(result.error)
  }
  useEffect(() => {
    if (!aim?.token) return
    load()
    const socket = net?.socket
    socket?.on("quiz:new", load)
    socket?.on("quiz:done", load)
    return () => {
      socket?.off("quiz:new", load)
      socket?.off("quiz:done", load)
    }
  }, [aim?.token])

  if (!aim?.token)
    return (
      <Screen title="Inbox" mode="inbox" onBack={onBack}>
        <SignOnPrompt what="get quizzes from friends" />
      </Screen>
    )

  const toTake = (list || []).filter((c) => !c.mine && c.status === "waiting")
  const done = (list || []).filter((c) => c.status === "done")
  const waiting = (list || []).filter((c) => c.mine && c.status === "waiting")
  const row = (c) => (
    <li key={c.id}>
      <button type="button" className={`qzMail${!c.mine && c.status === "waiting" ? " is-new" : ""}`} onClick={() => go({ id: "challenge", challengeId: c.id })}>
        <ModeIcon mode={MODE_ICON[c.kind]} size={28} />
        <span className="qzMailText">
          <b>{c.title || c.kindName}</b>
          <small>
            {c.mine ? `To ${c.to}` : `From ${c.from}`} &middot; {c.count} questions &middot; {ago(c.doneAt || c.createdAt)}
          </small>
        </span>
        {c.status === "done" ? <span className="qzPct">{c.percent}%</span> : !c.mine ? <span className="qzTake">Take it!</span> : <span className="qzWait">waiting</span>}
      </button>
    </li>
  )

  return (
    <Screen title="Inbox" mode="inbox" onBack={onBack} footer={<button type="button" className="qzLink" onClick={load}>Refresh</button>}>
      {error && <Notice kind="is-error">{error}</Notice>}
      {!list && !error && <Loading />}
      {list && !list.length && <Notice>Nothing here yet. Send someone a quiz from the main menu, and it will show up here when they've answered!</Notice>}
      {toTake.length > 0 && (
        <section>
          <h3 className="qzSection">For you to take</h3>
          <ul className="qzMailList">{toTake.map(row)}</ul>
        </section>
      )}
      {done.length > 0 && (
        <section>
          <h3 className="qzSection">Results</h3>
          <ul className="qzMailList">{done.map(row)}</ul>
        </section>
      )}
      {waiting.length > 0 && (
        <section>
          <h3 className="qzSection">Waiting for answers</h3>
          <ul className="qzMailList">{waiting.map(row)}</ul>
        </section>
      )}
    </Screen>
  )
}

// ---------- one challenge ----------

export const answerText = (q, value, names) => {
  if (value === null || value === undefined) return "(no answer)"
  if (q.type === "choice") return q.options[value] ?? "?"
  if (q.type === "truefalse") return value ? "True" : "False"
  if (q.type === "who") return { author: names.author, taker: names.taker, both: "Both of us" }[value] || "?"
  return String(value)
}

// remember a finished challenge here once: history, facts, badges
const remember = (c) => {
  const d = getQuizData()
  if (d.seenResults.includes(c.id)) return
  setQuizData({ seenResults: [...d.seenResults, c.id].slice(-300) })
  const taker = !c.mine
  const other = c.mine ? c.to : c.from
  if (c.kind === "knowme" || c.kind === "tot") {
    const { summary, score } = asyncShow(c)
    recordShow({
      mode: c.kind,
      how: "turns",
      with: other,
      summary: { tier: summary.tier.name, headline: summary.headline, percent: summary.percent },
      points: score.points[taker ? 1 : 0],
      won: summary.percent >= 55,
      perfect: c.kind === "knowme" && taker && c.result.percent === 100,
      facts: c.kind === "knowme" ? c.payload.items.map((qid, i) => ({ subject: c.from, qid, answer: c.authorAnswers[i] })) : [],
    })
    return
  }
  recordGame({
    mode: c.kind,
    title: c.title,
    with: other,
    percent: c.result.percent,
    won: c.result.percent >= 50,
    perfect: c.kind === "knowme" && taker && c.result.percent === 100,
  })
  if (c.kind === "knowme") addFacts(c.payload.items.map((qid, i) => ({ subject: c.from, qid, answer: c.authorAnswers[i] })))
}

export const ChallengeView = ({ challengeId, onBack, go }) => {
  const { aim, api, packs, sounds } = useQuiz()
  const [c, setC] = useState(null)
  const [error, setError] = useState(null)
  const [taking, setTaking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [revealing, setRevealing] = useState(false) // just answered: play the reveals one by one

  useEffect(() => {
    api.get(challengeId).then((r) => (r.ok ? setC(r.challenge) : setError(r.error)))
  }, [challengeId])

  useEffect(() => {
    if (c?.status === "done") remember(c)
  }, [c?.status])

  const title = c ? c.title || c.kindName : "Quiz"
  if (error)
    return (
      <Screen title="Quiz" onBack={onBack}>
        <Notice kind="is-error">{error}</Notice>
      </Screen>
    )
  if (!c)
    return (
      <Screen title="Quiz" onBack={onBack}>
        <Loading />
      </Screen>
    )

  const names = c.mine ? { author: "You", taker: c.to } : { author: c.from, taker: "You" }
  const questions = challengeQuestions(c.kind, c.payload, packs, { author: c.from })

  const submit = async (answers) => {
    setBusy(true)
    const r = await api.attempt(c.id, answers)
    setBusy(false)
    setTaking(false)
    if (!r.ok) return setError(r.error)
    if (c.kind === "knowme" || c.kind === "tot") setRevealing(true)
    else sounds.drumroll()
    setC(r.challenge)
  }

  if (c.status === "waiting" && !c.mine) {
    if (busy) return <Screen title={title} mode={MODE_ICON[c.kind]} onBack={onBack}><Loading text="Scoring..." /></Screen>
    if (taking) {
      const lead =
        c.kind === "knowme" ? () => `Guess ${c.from}'s answer!` : c.kind === "tot" ? () => "Your pick" : c.kind === "compat" ? () => "About you" : undefined
      return (
        <Screen title={title} mode={MODE_ICON[c.kind]} onBack={() => setTaking(false)}>
          <QuestionRunner questions={questions} names={{ author: c.from, taker: aim?.me?.screenName }} onDone={submit} lead={lead} />
        </Screen>
      )
    }
    return (
      <Screen title={title} mode={MODE_ICON[c.kind]} onBack={onBack}>
        <div className="qzEnvelope">
          <Heart size={40} />
          <p>
            <b>{c.from}</b> sent you <b>{c.title || c.kindName}</b>!
          </p>
          <p className="qzHint">
            {c.kind === "knowme"
              ? `It's your turn! ${c.from} answered ${questions.length} questions about themself. Guess what they said: every match is 100 points, and the last one counts double.`
              : c.kind === "tot"
                ? `It's your turn! ${c.from} picked a side of ${questions.length} pairs. Pick yours: every match scores for you both.`
                : c.kind === "compat"
                  ? `Answer for yourself, then see your combined result.`
                  : `${questions.length} questions, written by ${c.from}.`}
          </p>
          <Big
            onClick={() => {
              sounds.tap()
              setTaking(true)
            }}
          >
            Take the quiz
          </Big>
        </div>
      </Screen>
    )
  }

  if (c.status === "waiting") {
    return (
      <Screen title={title} mode={MODE_ICON[c.kind]} onBack={onBack}>
        <Notice>
          Waiting for <b>{c.to}</b> to take it. The results will show up in your Inbox.
        </Notice>
        {c.kind !== "compat" && (
          <ul className="qzAnswers">
            {questions.map((q, i) => (
              <li key={i}>
                <span>{c.kind === "knowme" ? packs.aboutMe.find((x) => x.id === c.payload.items[i])?.me : q.text}</span>
                <b>{answerText(q, c.authorAnswers?.[i], names)}</b>
              </li>
            ))}
          </ul>
        )}
        <div className="qzActions">
          <Big
            kind="is-alt"
            onClick={async () => {
              await api.remove(c.id)
              onBack()
            }}
          >
            Take it back
          </Big>
        </div>
      </Screen>
    )
  }

  if (c.kind === "knowme" || c.kind === "tot") {
    if (revealing) return <AsyncReveal c={c} onDone={() => setRevealing(false)} onBack={onBack} />
    return <ShowChallengeResult c={c} onReplay={() => setRevealing(true)} onBack={onBack} go={go} />
  }
  return <ChallengeResult c={c} questions={questions} names={names} onBack={onBack} go={go} />
}

// The reveals of a taken-turns show, one question at a time
const AsyncReveal = ({ c, onDone, onBack }) => {
  const { packs } = useQuiz()
  const show = useMemo(() => asyncShow(c), [c.id])
  const [i, setI] = useState(0)
  const [opened, setOpened] = useState(-1)
  const mode = c.kind
  const me = (name, mine) => (mine ? "You" : name)
  const names = [me(c.from, c.mine), me(c.to, !c.mine)]
  const step = show.steps[i]
  const o = show.outcomes[i]
  // the running score up to this question
  const sofar = show.outcomes.slice(0, opened === i ? i + 1 : i).reduce((s, x) => s.map((p, k) => p + x.gained[k]), [0, 0])
  const q = showQuestion(mode, packs, step.id, { name: names[0] })
  const cards =
    mode === "knowme"
      ? [
          { label: `${names[0]} said`, answer: c.authorAnswers[i] },
          { label: `${names[1]} guessed`, answer: c.takerAnswers[i] },
        ]
      : [
          { label: `${names[0]} picked`, answer: c.authorAnswers[i] },
          { label: `${names[1]} picked`, answer: c.takerAnswers[i] },
        ]
  const last = i + 1 >= show.steps.length
  return (
    <Screen title={c.title || c.kindName} mode={MODE_ICON[c.kind]} onBack={onBack} className="qzShow is-reveal">
      <ScoreBar mode={mode} players={names.map((name, k) => ({ name, points: sofar[k], streak: 0, you: name === "You" }))} step={i} total={show.steps.length} />
      <div className="qzShowBody" key={i}>
        <RevealView
          mode={mode}
          step={step}
          n={i}
          text={q.text}
          options={q.options}
          cards={cards}
          match={o.match}
          onFire={o.onFire}
          streak={o.streak}
          guesserName={names[1]}
          onOpen={setOpened}
          gainedLine={gainedWords(mode, o.gained, names, 1)}
          nextLabel={last ? "See the results!" : "Next reveal"}
          onNext={() => (last ? onDone() : setI(i + 1))}
        />
      </div>
    </Screen>
  )
}

const ShowChallengeResult = ({ c, onReplay, onBack, go }) => {
  const { packs } = useQuiz()
  const { summary, score, outcomes } = useMemo(() => asyncShow(c), [c.id])
  const mode = c.kind
  const names = [c.mine ? `${c.from} (you)` : c.from, c.mine ? c.to : `${c.to} (you)`]
  const recap = c.payload.items.map((id, i) => {
    const q = showQuestion(mode, packs, id, { name: c.mine ? "you" : c.from })
    const text = (a) => (a === null || a === undefined ? "(no answer)" : q.options[a])
    return {
      text: q.text,
      match: outcomes[i].match,
      answers: [
        { label: mode === "knowme" ? `${c.mine ? "You" : c.from} said` : c.mine ? "You" : c.from, text: text(c.authorAnswers[i]) },
        { label: mode === "knowme" ? `${c.mine ? c.to : "You"} guessed` : c.mine ? c.to : "You", text: text(c.takerAnswers[i]) },
      ],
    }
  })
  const other = c.mine ? c.to : c.from
  return (
    <Screen title={c.title || c.kindName} mode={MODE_ICON[c.kind]} onBack={onBack} className="qzShow is-done">
      <ShowResults
        mode={mode}
        summary={{ tier: summary.tier.name, headline: summary.headline, percent: summary.percent }}
        players={names.map((name, k) => ({ name, points: score.points[k], best: mode === "tot" ? score.teamBest : score.best[k], you: c.mine ? k === 0 : k === 1, winner: false })).filter((p, k) => mode === "tot" || k === 1)}
        recap={recap}
        onAgain={() => go({ id: "send", kind: c.kind, preset: { screenName: other }, options: { count: c.payload.items.length } })}
        againLabel={mode === "knowme" && !c.mine ? `Your turn! Answer, and ${other} guesses` : `Send ${other} another round`}
        onHome={onBack}
        extra={
          <button type="button" className="qzLink" onClick={onReplay}>
            Replay the reveals
          </button>
        }
      />
    </Screen>
  )
}

const ChallengeResult = ({ c, questions, names, onBack, go }) => {
  const { packs, sounds } = useQuiz()
  const r = c.result
  useEffect(() => {
    const t = setTimeout(() => (r.percent >= 50 ? sounds.fanfare() : sounds.miss()), 450)
    return () => clearTimeout(t)
  }, [])

  const other = c.mine ? c.to : c.from
  let card
  if (c.kind === "compat") {
    const quiz = packs.compat.find((q) => q.id === c.payload.quizId)
    const mine = c.mine ? r.author : r.taker
    const theirs = c.mine ? r.taker : r.author
    card = (
      <ResultCard title={`${quiz.title}: you & ${other}`} percent={r.percent} line={r.couple.text} burst={r.couple.same ? 1 : 0}>
        <div className="qzPair">
          <CompatCard quiz={quiz} result={mine} who="You" small />
          <CompatCard quiz={quiz} result={theirs} who={other} small />
        </div>
        <Notice>
          <b>Tip for you:</b>{" "}
          {quiz.id === "love-notes" ? (
            <>
              {other} feels most cared for through <b>{quiz.categories[theirs.top].short.toLowerCase()}</b>.
            </>
          ) : (
            <>
              {other} is a <b>{quiz.categories[theirs.top].name}</b>.
            </>
          )}{" "}
          {quiz.categories[theirs.top].tip}
        </Notice>
      </ResultCard>
    )
  } else {
    const takerName = c.mine ? c.to : "You"
    const line =
      c.kind === "knowme" ? soulmateLine(r.percent) : c.kind === "tot" ? `You matched on ${r.correct} of ${r.total}!` : `${takerName} got ${r.correct} of ${r.total} right.`
    card = <ResultCard title={c.kind === "knowme" ? "Soulmate level" : c.kind === "tot" ? "In sync" : "Score"} percent={r.percent} line={line} burst={r.percent >= 50 ? 1 : 0} />
  }

  return (
    <Screen title={c.title || c.kindName} mode={MODE_ICON[c.kind]} onBack={onBack} className="qzDone">
      {card}
      {c.kind !== "compat" && (
        <ul className="qzAnswers is-compare">
          {questions.map((q, i) => (
            <li key={i} className={r.per[i] ? "is-match" : ""}>
              <span className="qzRecapQ">{q.text}</span>
              <span className="qzRecapA">
                {c.kind === "knowme" ? `${c.mine ? "You" : c.from} said` : c.kind === "tot" ? (c.mine ? "You" : c.from) : "Answer"}: <b>{answerText(q, c.authorAnswers[i], names)}</b>
              </span>
              <span className="qzRecapA">
                {c.kind === "knowme" ? `${c.mine ? c.to : "You"} guessed` : c.mine ? c.to : "You"}: <b>{answerText(q, c.takerAnswers[i], names)}</b>
              </span>
              {r.per[i] && <Heart size={16} />}
            </li>
          ))}
        </ul>
      )}
      <div className="qzActions">
        {!c.mine && (c.kind === "knowme" || c.kind === "tot") && (
          <Big onClick={() => go({ id: "send", kind: c.kind, preset: { screenName: c.from } })}>Your turn: send one to {c.from}</Big>
        )}
        <Big kind="is-alt" onClick={onBack}>
          Back
        </Big>
      </div>
    </Screen>
  )
}

export { Choices }
