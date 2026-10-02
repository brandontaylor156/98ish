import { useEffect, useMemo, useState } from "react"
import { Big, Loading, Notice, PersonPicker, QuestionRunner, ResultCard, Screen, SignOnPrompt, useQuiz } from "./parts"
import { Heart, ModeIcon, Rosette } from "./art"
import { DeepCard } from "./Live"
import { badgesOf, bumpStat, recordGame, seeDeepCard, statsOf, toggleFavorite, useQuizData } from "./storage"
import { BADGES, buildAboutUs, compatResult, pickSome, seeded, shuffle, triviaPoints } from "./shared/logic.js"

// The rest of the Quiz Show's modes: compatibility quizzes, Deep Talk on your own, Trivia
// About Us, the Party Pack, and your history and badges.

// ---------- compatibility ----------

export const CompatCard = ({ quiz, result, who, small }) => {
  const cat = quiz.categories[result.top]
  return (
    <div className={`qzCompatCard${small ? " is-small" : ""}`} style={{ "--accent": quiz.color }}>
      {who && <div className="qzCompatWho">{who}</div>}
      <div className="qzCompatName">{cat.name}</div>
      {!small && <p>{cat.blurb}</p>}
      <ul className="qzBars">
        {result.order.map((c) => (
          <li key={c}>
            <span>{quiz.categories[c].short}</span>
            <span className="qzBar">
              <i style={{ width: `${result.percents[c]}%` }} />
            </span>
            <b>{result.percents[c]}%</b>
          </li>
        ))}
      </ul>
    </div>
  )
}

export const CompatScreen = ({ onBack, go }) => {
  const { packs, aim, api, sounds } = useQuiz()
  const [quiz, setQuiz] = useState(null)
  const [answers, setAnswers] = useState(null)
  const [sending, setSending] = useState(null) // null | "pick" | "sending" | "sent" | error text
  const seed = useMemo(() => Math.floor(Math.random() * 1e9), [quiz])

  // each question's answers in a shuffled order (mapped back before scoring)
  const orders = useMemo(() => (quiz ? quiz.questions.map((q, i) => shuffle(q.options.map((_, j) => j), seeded(seed + i))) : []), [quiz, seed])
  const questions = useMemo(() => (quiz ? quiz.questions.map((q, i) => ({ type: "choice", text: q.q, options: orders[i].map((j) => q.options[j].text) })) : []), [quiz, orders])

  if (!quiz) {
    return (
      <Screen title="Compatibility Quizzes" mode="compat" onBack={onBack}>
        <p className="qzIntro">Take one for yourself, then send it to someone to see how you fit together.</p>
        <div className="qzCards">
          {packs.compat.map((q) => (
            <button key={q.id} type="button" className="qzQuizCard" style={{ "--accent": q.color }} onClick={() => (sounds.tap(), setQuiz(q), setAnswers(null), setSending(null))}>
              <b>{q.title}</b>
              <span>{q.blurb}</span>
              <small>{q.questions.length} questions</small>
            </button>
          ))}
        </div>
      </Screen>
    )
  }

  if (!answers) {
    return (
      <Screen title={quiz.title} mode="compat" onBack={() => setQuiz(null)}>
        <QuestionRunner
          questions={questions}
          lead={() => "About you"}
          onDone={(picked) => {
            const real = picked.map((p, i) => orders[i][p])
            setAnswers(real)
            recordGame({ mode: "compat", title: quiz.title, percent: null })
            sounds.fanfare()
          }}
        />
      </Screen>
    )
  }

  const result = compatResult(quiz, answers)
  const send = async (target) => {
    setSending("sending")
    const r = await api.send({ kind: "compat", quizId: quiz.id, answers, to: target.screenName })
    if (r.ok) {
      bumpStat("sent")
      sounds.pop()
    }
    setSending(r.ok ? "sent" : r.error)
  }

  return (
    <Screen title={quiz.title} mode="compat" onBack={() => setQuiz(null)} className="qzDone">
      <ResultCard title="You are a..." burst={1}>
        <CompatCard quiz={quiz} result={result} />
      </ResultCard>
      {sending === "pick" && (aim?.token ? <PersonPicker kind="async" title="Compare with..." onPick={send} onCancel={() => setSending(null)} /> : <SignOnPrompt what="compare results with someone" />)}
      {sending === "sending" && <Loading text="Sending..." />}
      {sending === "sent" && (
        <Notice>
          Sent! When they've taken it too, your <b>combined result</b> shows up in your Inbox.
        </Notice>
      )}
      {sending && !["pick", "sending", "sent"].includes(sending) && <Notice kind="is-error">{sending}</Notice>}
      <div className="qzActions">
        {sending !== "sent" && sending !== "pick" && <Big onClick={() => setSending("pick")}>Compare with someone</Big>}
        {sending === "sent" && <Big onClick={() => go({ id: "inbox" })}>Go to my Inbox</Big>}
        <Big kind="is-alt" onClick={() => setQuiz(null)}>
          Take another quiz
        </Big>
      </div>
    </Screen>
  )
}

// ---------- Deep Talk on your own (or side by side on one screen) ----------

export const DeepSolo = ({ onBack, onLive }) => {
  const { packs, sounds } = useQuiz()
  const data = useQuizData()
  const [level, setLevel] = useState(1)
  const [showFavs, setShowFavs] = useState(false)
  const decks = useMemo(() => Object.fromEntries([1, 2, 3].map((l) => [l, shuffle(packs.deep.filter((c) => c.level === l))])), [packs])
  const [at, setAt] = useState({ 1: 0, 2: 0, 3: 0 })
  const card = decks[level][at[level] % decks[level].length]
  useEffect(() => {
    if (!showFavs) seeDeepCard(card.id)
  }, [card.id, showFavs])

  if (showFavs) {
    const favs = packs.deep.filter((c) => data.favorites.includes(c.id))
    return (
      <Screen title="Favorite cards" mode="deep" onBack={() => setShowFavs(false)}>
        {favs.length ? (
          <ul className="qzFavList">
            {favs.map((c) => (
              <li key={c.id} className={`qzLevel${c.level}`}>
                <span>{c.text}</span>
                <button type="button" className="qzLink" onClick={() => toggleFavorite(c.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Notice>Tap the heart on a card to keep it here.</Notice>
        )}
      </Screen>
    )
  }

  return (
    <Screen title="Deep Talk Cards" mode="deep" onBack={onBack} className="qzDeep">
      <div className="qzLevels" role="tablist">
        {[1, 2, 3].map((l) => (
          <button key={l} type="button" role="tab" aria-selected={level === l} className={level === l ? "is-on" : ""} onClick={() => (sounds.flip(), setLevel(l))}>
            {["Light", "Deeper", "Deepest"][l - 1]}
          </button>
        ))}
      </div>
      <DeepCard card={card} flipKey={card.id} favorite={data.favorites.includes(card.id)} onFavorite={() => toggleFavorite(card.id)} />
      <p className="qzHint">{["Warm-up questions to get you smiling.", "Stories, feelings and what makes you tick.", "The big, tender stuff. Take your time."][level - 1]}</p>
      <div className="qzActions">
        <Big onClick={() => (sounds.flip(), setAt({ ...at, [level]: at[level] + 1 }))}>Next card</Big>
        <Big kind="is-alt" onClick={onLive}>
          Play live with someone
        </Big>
        <button type="button" className="qzLink" onClick={() => setShowFavs(true)}>
          Favorites ({data.favorites.length}) &middot; {data.deepSeen.length} cards talked through
        </button>
      </div>
    </Screen>
  )
}

// ---------- a solo trivia round (Party Pack practice, Trivia About Us) ----------

const SoloTrivia = ({ title, mode, questions, timer, onBack, onAgain, recordAs }) => {
  const { sounds } = useQuiz()
  const [answers, setAnswers] = useState(null)
  const [score, setScore] = useState(0)
  const [start, setStart] = useState(Date.now())
  if (!answers) {
    return (
      <Screen title={title} mode={mode} onBack={onBack}>
        <QuestionRunner
          key={start}
          questions={questions.map((q) => ({ type: "choice", text: q.q, options: q.options }))}
          feedback={(i) => questions[i].answer}
          timer={timer}
          onAnswer={(i, a) => setScore((s) => s + triviaPoints(a === questions[i].answer))}
          onDone={(a) => {
            setAnswers(a)
            const correct = a.filter((x, i) => x === questions[i].answer).length
            const percent = Math.round((correct / questions.length) * 100)
            recordGame({ mode: recordAs, title, percent, score: correct, total: questions.length, won: percent >= 70, triviaPerfect: correct === questions.length })
            percent >= 70 ? sounds.fanfare() : sounds.miss()
          }}
        />
      </Screen>
    )
  }
  const correct = answers.filter((x, i) => x === questions[i].answer).length
  const percent = Math.round((correct / questions.length) * 100)
  return (
    <Screen title={title} mode={mode} onBack={onBack} className="qzDone">
      <ResultCard title={percent === 100 ? "Perfect score!" : percent >= 70 ? "Brainy!" : "Good try!"} percent={percent} line={`${correct} of ${questions.length} right, ${score} points.`} burst={percent >= 70 ? 1 : 0} />
      <div className="qzActions">
        <Big
          onClick={() => {
            setAnswers(null)
            setScore(0)
            setStart(Date.now())
            onAgain?.()
          }}
        >
          Play again
        </Big>
        <Big kind="is-alt" onClick={onBack}>
          Back
        </Big>
      </div>
    </Screen>
  )
}

export const AboutUs = ({ onBack, go }) => {
  const { packs } = useQuiz()
  const data = useQuizData()
  const [round, setRound] = useState(0)
  const questions = useMemo(() => buildAboutUs(data.facts, packs.aboutMe, { count: 10 }), [round])
  if (questions.length < 3) {
    return (
      <Screen title="Trivia About Us" mode="aboutus" onBack={onBack}>
        <Notice>
          <p>This quiz builds itself from your answers in <b>How Well Do You Know Me?</b> Play a couple of rounds together first, then come back to test your memory!</p>
          <Big kind="is-small" onClick={() => go({ id: "menu", mode: "knowme" })}>
            Play How Well Do You Know Me?
          </Big>
        </Notice>
      </Screen>
    )
  }
  return <SoloTrivia key={round} title="Trivia About Us" mode="aboutus" questions={questions} onBack={onBack} onAgain={() => setRound(round + 1)} recordAs="aboutus" />
}

export const PartyPack = ({ onBack, onLive }) => {
  const { packs, sounds } = useQuiz()
  const [pack, setPack] = useState(null)
  const [timer, setTimer] = useState(20)
  const [round, setRound] = useState(0)
  const questions = useMemo(() => {
    if (!pack) return []
    const pool = pack === "mix" ? packs.trivia : packs.triviaPacks.find((p) => p.id === pack).questions
    return pickSome(pool, 10)
  }, [pack, round])

  if (pack && questions.length) {
    const name = pack === "mix" ? "Mix of everything" : packs.triviaPacks.find((p) => p.id === pack).name
    return <SoloTrivia key={round} title={name} mode="party" questions={questions} timer={timer} onBack={() => setPack(null)} onAgain={() => setRound(round + 1)} recordAs="trivia" />
  }

  return (
    <Screen title="Party Pack" mode="party" onBack={onBack}>
      <p className="qzIntro">General-knowledge trivia for any group of friends. Play live together (everyone answers at once, fastest right answers score most) or practice on your own.</p>
      <Big onClick={onLive}>Play live with friends</Big>
      <h3 className="qzSection">Practice a pack</h3>
      <div className="qzCards">
        {[...packs.triviaPacks, { id: "mix", name: "Mix of everything", blurb: "A bit of every pack.", questions: packs.trivia }].map((p) => (
          <button key={p.id} type="button" className="qzQuizCard" onClick={() => (sounds.tap(), setPack(p.id))}>
            <b>{p.name}</b>
            <span>{p.blurb}</span>
            <small>{p.questions.length} questions</small>
          </button>
        ))}
      </div>
      <label className="qzField">
        Timer
        <select value={timer} onChange={(e) => setTimer(Number(e.target.value))}>
          {[0, 10, 15, 20, 30].map((n) => (
            <option key={n} value={n}>
              {n ? `${n} seconds` : "Off"}
            </option>
          ))}
        </select>
      </label>
    </Screen>
  )
}

// ---------- history and badges ----------

const MODE_NAMES = { knowme: "How Well Do You Know Me?", tot: "This or That", trivia: "Party Trivia", compat: "Compatibility", custom: "Custom Quiz", aboutus: "Trivia About Us" }
const MODE_ICONS = { knowme: "knowme", tot: "tot", trivia: "party", compat: "compat", custom: "builder", aboutus: "aboutus" }

export const History = ({ onBack }) => {
  const { aim, api } = useQuiz()
  const data = useQuizData()
  const stats = statsOf(data)
  const earned = badgesOf(data)
  const [scores, setScores] = useState(null)
  useEffect(() => {
    if (aim?.token) api.scores().then((r) => r.ok && setScores(r.scores))
  }, [aim?.token])
  const best = Math.max(0, ...data.history.map((h) => h.percent ?? 0))
  return (
    <Screen title="History & Badges" mode="history" onBack={onBack}>
      <div className="qzStats">
        <div>
          <b>{stats.games}</b>
          <span>games</span>
        </div>
        <div>
          <b>{stats.wins}</b>
          <span>wins</span>
        </div>
        <div>
          <b>{best}%</b>
          <span>best</span>
        </div>
        <div className={stats.streak ? "is-hot" : ""}>
          <b>{stats.streak}</b>
          <span>day streak</span>
        </div>
      </div>
      <h3 className="qzSection">Badges ({earned.length} of {BADGES.length})</h3>
      <ul className="qzBadges">
        {BADGES.map((b) => (
          <li key={b.id} className={earned.includes(b.id) ? "is-on" : ""} title={b.text}>
            <Rosette on={earned.includes(b.id)} />
            <b>{b.name}</b>
            <small>{b.text}</small>
          </li>
        ))}
      </ul>
      {scores && scores.length > 0 && (
        <>
          <h3 className="qzSection">Together</h3>
          <ul className="qzTogether">
            {scores.map((s) => (
              <li key={s.with}>
                <Heart size={18} />
                <span>
                  <b>You & {s.with}</b>
                  <small>
                    {s.games} games &middot; average {s.average}% &middot; best {s.best}%{s.perfect ? ` · ${s.perfect} perfect` : ""}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3 className="qzSection">Recent games</h3>
      {data.history.length ? (
        <ul className="qzHistory">
          {data.history.slice(0, 30).map((h, i) => (
            <li key={i}>
              <ModeIcon mode={MODE_ICONS[h.mode] || "knowme"} size={20} />
              <span>
                <b>{h.title || MODE_NAMES[h.mode] || h.mode}</b>
                <small>
                  {h.with ? `with ${h.with} · ` : ""}
                  {new Date(h.at).toLocaleDateString()}
                  {h.live ? " · live" : ""}
                </small>
              </span>
              {h.percent !== null && <em>{h.percent}%</em>}
            </li>
          ))}
        </ul>
      ) : (
        <Notice>No games yet. Your scores will show up here.</Notice>
      )}
    </Screen>
  )
}
