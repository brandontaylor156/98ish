import { useEffect, useState } from "react"
import { Big, Loading, Notice, PersonPicker, Screen, SignOnPrompt, useQuiz } from "./parts"
import { bumpStat, setQuizData, useQuizData } from "./storage"
import { LIMITS, validateCustom } from "./shared/logic.js"

// The quiz builder: write your own questions about yourself (or "us"), save them, and
// send them to someone to take. Saved on the server when you're signed on to 98
// Messenger (so your phone and computer share them), otherwise in this browser.

const TYPE_LABELS = { choice: "Multiple choice", truefalse: "True or false", text: "Type the answer", who: "Which of us...?" }
const blank = (type = "choice") => ({ type, text: "", options: ["", ""], answer: type === "choice" ? 0 : type === "truefalse" ? true : type === "who" ? "author" : "" })

const Editor = ({ quiz: initial, onSaved, onBack }) => {
  const { aim, api, packs, sounds } = useQuiz()
  const [quiz, setQuiz] = useState(() => initial || { title: "", questions: [blank()] })
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [sendTo, setSendTo] = useState(null) // null | "pick" | "sending" | "sent"

  const update = (i, patch) => setQuiz((q) => ({ ...q, questions: q.questions.map((x, j) => (j === i ? { ...x, ...patch } : x)) }))
  const remove = (i) => setQuiz((q) => ({ ...q, questions: q.questions.filter((_, j) => j !== i) }))
  const move = (i, d) =>
    setQuiz((q) => {
      const list = [...q.questions]
      const j = i + d
      if (j < 0 || j >= list.length) return q
      ;[list[i], list[j]] = [list[j], list[i]]
      return { ...q, questions: list }
    })
  const add = (question) => {
    if (quiz.questions.length >= LIMITS.maxQ) return setError(`A quiz can have at most ${LIMITS.maxQ} questions.`)
    sounds.pop()
    setQuiz((q) => ({ ...q, questions: [...q.questions, question] }))
  }
  const addLikely = () => {
    const used = new Set(quiz.questions.map((q) => q.text))
    const fresh = packs.likely.filter((l) => !used.has(l.text))
    const pick = fresh[Math.floor(Math.random() * fresh.length)] || packs.likely[0]
    add({ ...blank("who"), text: pick.text })
  }

  // the shape the server wants: only the fields each type uses
  const shaped = () => ({
    title: quiz.title,
    questions: quiz.questions.map((q) => (q.type === "choice" ? { type: q.type, text: q.text, options: q.options, answer: q.answer } : { type: q.type, text: q.text, answer: q.answer })),
  })

  const save = async () => {
    const checked = validateCustom(shaped())
    if (!checked.ok) return setError(checked.error)
    setError(null)
    setSaving(true)
    const isNew = !quiz.id
    let saved
    if (aim?.token) {
      const r = await api.saveQuiz({ ...shaped(), id: quiz.id && !quiz.id.startsWith("local-") ? quiz.id : undefined })
      if (!r.ok) {
        setSaving(false)
        return setError(r.error)
      }
      saved = r.quiz
    } else {
      saved = { ...shaped(), id: quiz.id || `local-${Date.now().toString(36)}`, updatedAt: Date.now() }
      setQuizData((d) => ({ drafts: [saved, ...d.drafts.filter((x) => x.id !== saved.id)].slice(0, 30) }))
    }
    if (isNew) bumpStat("customs")
    setSaving(false)
    setQuiz({ ...saved, questions: saved.questions.map((q) => ({ options: ["", ""], ...q })) })
    sounds.lock()
    onSaved?.(saved)
    return saved
  }

  const send = async (target) => {
    const checked = validateCustom(shaped())
    if (!checked.ok) return setError(checked.error)
    setSendTo("sending")
    const r = await api.send({ kind: "custom", to: target.screenName, ...shaped() })
    if (!r.ok) {
      setSendTo(null)
      return setError(r.error)
    }
    bumpStat("sent")
    sounds.pop()
    setSendTo("sent")
  }

  if (sendTo === "pick") {
    return (
      <Screen title="Send your quiz" mode="builder" onBack={() => setSendTo(null)}>
        {aim?.token ? <PersonPicker kind="async" onPick={send} onCancel={() => setSendTo(null)} /> : <SignOnPrompt what="send your quiz" />}
      </Screen>
    )
  }

  return (
    <Screen title={quiz.id ? "Edit quiz" : "New quiz"} mode="builder" onBack={onBack} className="qzBuilder">
      <label className="qzField is-wide">
        Title
        <input value={quiz.title} maxLength={LIMITS.title} onChange={(e) => setQuiz({ ...quiz, title: e.target.value })} placeholder="All about me" />
      </label>
      <ol className="qzBuildList">
        {quiz.questions.map((q, i) => (
          <li key={i} className="qzBuildQ">
            <div className="qzBuildTop">
              <b>{i + 1}.</b>
              <select aria-label="Question type" value={q.type} onChange={(e) => update(i, { ...blank(e.target.value), text: q.text, options: q.options })}>
                {Object.entries(TYPE_LABELS).map(([t, label]) => (
                  <option key={t} value={t}>
                    {label}
                  </option>
                ))}
              </select>
              <span className="qzBuildTools">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                  &#9650;&#xFE0E;
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === quiz.questions.length - 1} aria-label="Move down">
                  &#9660;&#xFE0E;
                </button>
                <button type="button" onClick={() => remove(i)} disabled={quiz.questions.length === 1} aria-label="Delete question">
                  &#10005;
                </button>
              </span>
            </div>
            <input className="qzBuildText" value={q.text} maxLength={LIMITS.text} onChange={(e) => update(i, { text: e.target.value })} placeholder={q.type === "who" ? "Which of us is more likely to..." : q.type === "truefalse" ? "I have never seen snow." : "What's my favorite..."} aria-label={`Question ${i + 1}`} />
            {q.type === "choice" && (
              <div className="qzBuildOptions">
                {q.options.map((o, j) => (
                  <div key={j} className="qzBuildOption">
                    <button type="button" className={`qzRight${q.answer === j ? " is-on" : ""}`} aria-pressed={q.answer === j} aria-label={`Answer ${j + 1} is the right one`} title="The right answer" onClick={() => update(i, { answer: j })}>
                      {q.answer === j ? "✓" : ""}
                    </button>
                    <input value={o} maxLength={LIMITS.option} onChange={(e) => update(i, { options: q.options.map((x, k) => (k === j ? e.target.value : x)) })} placeholder={`Answer ${j + 1}`} aria-label={`Answer ${j + 1}`} />
                    {q.options.length > 2 && (
                      <button type="button" onClick={() => update(i, { options: q.options.filter((_, k) => k !== j), answer: q.answer === j ? 0 : q.answer > j ? q.answer - 1 : q.answer })} aria-label={`Remove answer ${j + 1}`}>
                        &#10005;
                      </button>
                    )}
                  </div>
                ))}
                {q.options.length < LIMITS.maxOptions && (
                  <button type="button" className="qzLink" onClick={() => update(i, { options: [...q.options, ""] })}>
                    + Add an answer
                  </button>
                )}
                <small className="qzHint">Tick the right answer.</small>
              </div>
            )}
            {q.type === "truefalse" && (
              <div className="qzSeg" role="radiogroup" aria-label="The right answer">
                {[true, false].map((v) => (
                  <button key={String(v)} type="button" role="radio" aria-checked={q.answer === v} className={q.answer === v ? "is-on" : ""} onClick={() => update(i, { answer: v })}>
                    {v ? "True" : "False"}
                  </button>
                ))}
              </div>
            )}
            {q.type === "text" && (
              <div className="qzBuildOptions">
                <input value={q.answer} maxLength={LIMITS.answer} onChange={(e) => update(i, { answer: e.target.value })} placeholder="The answer" aria-label="The answer" />
                <small className="qzHint">Close spellings count. Separate other accepted answers with a slash: cafe / coffee shop</small>
              </div>
            )}
            {q.type === "who" && (
              <div className="qzSeg" role="radiogroup" aria-label="Who it is">
                {[
                  ["author", "Me"],
                  ["taker", "You (who takes it)"],
                  ["both", "Both of us"],
                ].map(([v, label]) => (
                  <button key={v} type="button" role="radio" aria-checked={q.answer === v} className={q.answer === v ? "is-on" : ""} onClick={() => update(i, { answer: v })}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
      <div className="qzBuildAdd">
        <Big kind="is-small is-alt" onClick={() => add(blank())}>
          + Question
        </Big>
        <Big kind="is-small is-alt" onClick={addLikely}>
          + "Which of us" idea
        </Big>
      </div>
      {error && <Notice kind="is-error">{error}</Notice>}
      {sendTo === "sending" && <Loading text="Sending..." />}
      {sendTo === "sent" && <Notice>Sent! The results will show up in your Inbox when they've taken it.</Notice>}
      <div className="qzActions">
        <Big onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Big>
        <Big kind="is-alt" onClick={() => setSendTo("pick")} disabled={saving}>
          Send to someone
        </Big>
      </div>
    </Screen>
  )
}

export const Builder = ({ onBack }) => {
  const { aim, api } = useQuiz()
  const data = useQuizData()
  const [list, setList] = useState(null)
  const [editing, setEditing] = useState(null) // null | "new" | quiz
  const [error, setError] = useState(null)
  const signedIn = !!aim?.token

  const load = async () => {
    if (!signedIn) return setList(null)
    const r = await api.quizzes()
    if (r.ok) setList(r.quizzes)
    else setError(r.error)
  }
  useEffect(() => {
    load()
  }, [signedIn])

  if (editing) return <Editor quiz={editing === "new" ? null : editing} onBack={() => (setEditing(null), load())} />

  const quizzes = signedIn ? list : data.drafts
  return (
    <Screen title="Quiz Builder" mode="builder" onBack={onBack}>
      <p className="qzIntro">Write your own questions: multiple choice, true or false, type-the-answer, or "which of us is more likely to...". Then send it to someone and see how they do.</p>
      <Big onClick={() => setEditing("new")}>Make a new quiz</Big>
      {!signedIn && (
        <Notice>
          You're signed off, so quizzes are saved in this browser. Sign on to 98 Messenger to keep them online and send them.
        </Notice>
      )}
      {error && <Notice kind="is-error">{error}</Notice>}
      {signedIn && !list && !error && <Loading />}
      {quizzes && quizzes.length > 0 && (
        <>
          <h3 className="qzSection">Your quizzes</h3>
          <ul className="qzMailList">
            {quizzes.map((q) => (
              <li key={q.id} className="qzSaved">
                <button type="button" className="qzMail" onClick={() => setEditing({ ...q, questions: q.questions.map((x) => ({ options: ["", ""], ...x })) })}>
                  <span className="qzMailText">
                    <b>{q.title}</b>
                    <small>{q.questions.length} questions</small>
                  </span>
                  <span className="qzTake">Edit</span>
                </button>
                <button
                  type="button"
                  className="qzLink"
                  aria-label={`Delete ${q.title}`}
                  onClick={async () => {
                    if (signedIn) {
                      await api.removeQuiz(q.id)
                      load()
                    } else setQuizData((d) => ({ drafts: d.drafts.filter((x) => x.id !== q.id) }))
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Screen>
  )
}
