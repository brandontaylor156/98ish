import { useEffect, useMemo, useState } from "react"
import { Big, Choices, Loading, Notice, PersonPicker, QuestionRunner, ResultCard, Screen, SignOnPrompt, useQuiz } from "./parts"
import { Heart, ModeIcon } from "./art"
import { addFacts, bumpStat, getQuizData, recordGame, setQuizData } from "./storage"
import { challengeQuestions, KIND_NAMES, pickSome, soulmateLine } from "./shared/logic.js"
import { CompatCard } from "./Modes"

// Quizzes that wait for someone: answer about yourself now, they guess later. Results
// wait in both Inboxes (server/quiz).

const MODE_ICON = { knowme: "knowme", tot: "tot", custom: "builder", compat: "compat" }

// ---------- sending How Well Do You Know Me / This or That ----------

export const AsyncSend = ({ kind, preset = null, onBack, go }) => {
  const { aim, api, packs, sounds } = useQuiz()
  const [to, setTo] = useState(preset)
  const [count, setCount] = useState(kind === "knowme" ? 5 : 10)
  const [step, setStep] = useState(preset ? "setup" : "who")
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const title = KIND_NAMES[kind]

  const questions = useMemo(() => {
    if (!items) return []
    if (kind === "knowme") return items.map((id) => packs.aboutMe.find((q) => q.id === id)).map((q) => ({ type: "choice", text: q.me, options: q.options }))
    return items.map((id) => packs.pairs.find((p) => p.id === id)).map((p) => ({ type: "choice", text: p.kind === "tot" ? `${p.a} or ${p.b}?` : "Would you rather...", options: [p.a, p.b] }))
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
    setItems(pickSome(kind === "knowme" ? packs.aboutMe : packs.pairs, count).map((q) => q.id))
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
            setStep("setup")
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
      {step === "answer" && <QuestionRunner questions={questions} onDone={send} lead={() => (kind === "knowme" ? "About you" : "Your pick")} />}
      {step === "sending" && <Loading text="Sending..." />}
      {step === "sent" && (
        <ResultCard title="Sent with love!" burst={1}>
          <p className="qzResultLine">
            Your quiz is in <b>{to.screenName}</b>'s Inbox. You'll see the results in yours as soon as they've answered.
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
    sounds.drumroll()
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
              ? `${c.from} answered ${questions.length} questions about themself. How well do you know them?`
              : c.kind === "tot"
                ? `Pick your side of ${questions.length} pairs and see where you match.`
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

  return <ChallengeResult c={c} questions={questions} names={names} onBack={onBack} go={go} />
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
