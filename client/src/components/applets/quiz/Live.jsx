import { useEffect, useMemo, useRef, useState } from "react"
import { Big, Choices, HeartMeter, Loading, Notice, PersonPicker, Progress, ResultCard, Screen, TimerBar, useQuiz } from "./parts"
import { Heart, HeartBurst } from "./art"
import { Host } from "./Host"
import { BetView, QuestionView, RevealView, RoundCard, ScoreBar, ShowResults, betWords, gainedWords, showQuestion } from "./Stage"
import { addFacts, recordGame, recordShow, seeDeepCard, toggleFavorite, useQuizData } from "./storage"
import { reaction, soulmateLine } from "./shared/logic.js"
import { LENGTHS, packsFor } from "./shared/show.js"

// Live games over the network (server/quiz/live.js): a room with a lobby (invite people,
// pick the game), questions everyone answers at once, a reveal after each, and results.

export const LIVE_MODES = {
  knowme: { name: "How Well Do You Know Me?", icon: "knowme", players: "2 players" },
  tot: { name: "This or That", icon: "tot", players: "2 to 8 players" },
  trivia: { name: "Party Trivia", icon: "party", players: "2 to 8 players" },
  deep: { name: "Deep Talk Cards", icon: "deep", players: "2 or more" },
}

const REACTIONS = [
  { kind: "heart", label: "Heart", glyph: "♥" },
  { kind: "blush", label: "Blush", glyph: "^_^" },
  { kind: "laugh", label: "Ha ha", glyph: "LOL" },
  { kind: "wow", label: "Wow", glyph: "!!" },
  { kind: "clap", label: "Clap", glyph: "*clap*" },
]

// The room you're in, kept in sync with the server
export const useLive = (net) => {
  const [room, setRoom] = useState(null)
  const [error, setError] = useState(null)
  const [floaters, setFloaters] = useState([]) // reactions floating up
  const roomRef = useRef(null)
  roomRef.current = room
  const socket = net?.socket

  useEffect(() => {
    if (!socket) return
    const handlers = {
      "quiz:room": (view) => setRoom(view),
      // let into a friend's game (an accepted invitation): join it
      "quiz:invited": ({ roomId }) => net.request("quiz:join", { roomId }).then((r) => !r.ok && setError(r.error)),
      "quiz:reaction": ({ roomId, from, kind }) => {
        if (roomId !== roomRef.current?.id) return
        const id = `${Date.now()}${Math.random()}`
        setFloaters((list) => [...list.slice(-12), { id, from, kind, x: 10 + Math.random() * 80 }])
        setTimeout(() => setFloaters((list) => list.filter((f) => f.id !== id)), 2200)
      },
    }
    for (const [event, fn] of Object.entries(handlers)) socket.on(event, fn)
    const hello = () => net.request("quiz:hello")
    hello()
    socket.on("connect", hello)
    return () => {
      for (const [event, fn] of Object.entries(handlers)) socket.off(event, fn)
      socket.off("connect", hello)
    }
  }, [socket])

  const act = async (event, payload = {}) => {
    setError(null)
    const result = await net.request(event, { roomId: roomRef.current?.id, ...payload })
    if (!result.ok) setError(result.error)
    return result
  }

  const create = async (mode, options = {}) => {
    setError(null)
    const result = await net.request("quiz:create", { mode, options })
    if (!result.ok) setError(result.error)
    return result
  }

  const leave = async () => {
    const id = roomRef.current?.id
    setRoom(null)
    if (id) await net.request("quiz:leave", { roomId: id })
  }

  const invite = async (target, roomId = roomRef.current?.id) => {
    setError(null)
    const result = await net.invite(target, "quiz", { roomId })
    if (!result.ok) setError(result.error)
    return result
  }

  return { room, error, setError, floaters, act, create, leave, invite }
}

const nameIn = (room, id) => room.players.find((p) => p.id === id)?.name || "Someone"
const others = (room) => room.players.filter((p) => p.id !== room.you)

// ---------- lobby ----------

const Lobby = ({ live }) => {
  const { room } = live
  const { packs } = useQuiz()
  const [picking, setPicking] = useState(false)
  const info = LIVE_MODES[room.mode]
  const enough = room.players.length >= room.min
  const full = room.players.length >= room.max
  const setOption = (patch) => live.act("quiz:options", { options: patch })

  if (picking) {
    return (
      <Screen title="Invite someone" mode={info.icon} onBack={() => setPicking(false)}>
        <PersonPicker
          kind="live"
          onPick={async (target) => {
            const r = await live.invite(target)
            if (r.ok) setPicking(false)
          }}
          onCancel={() => setPicking(false)}
        />
        {live.error && <Notice kind="is-error">{live.error}</Notice>}
      </Screen>
    )
  }

  return (
    <Screen title={info.name} mode={info.icon} onBack={live.leave} className="qzLobby">
      <div className="qzStage">
        <div className="qzStageLights" aria-hidden="true" />
        <p className="qzStageTitle">{room.round > 1 ? `Round ${room.round}!` : "Live on stage"}</p>
        <ul className="qzContestants">
          {room.players.map((p) => (
            <li key={p.id} className={p.away ? "is-away" : ""}>
              <span className="qzAvatar">{p.id === room.you ? <Heart size={20} /> : p.name.slice(0, 1).toUpperCase()}</span>
              <b>{p.name}</b>
              {p.id === room.you && <small>(you)</small>}
              {room.hostName === p.name && <small className="qzHostTag">host</small>}
            </li>
          ))}
          {room.invited.map((n) => (
            <li key={`inv-${n}`} className="is-invited">
              <span className="qzAvatar">?</span>
              <b>{n}</b>
              <small>invited...</small>
            </li>
          ))}
        </ul>
      </div>

      {room.host ? (
        <div className="qzOptions">
          <div className="qzSeg" role="radiogroup" aria-label="Game">
            {Object.entries(LIVE_MODES).map(([mode, m]) => (
              <button key={mode} type="button" role="radio" aria-checked={room.mode === mode} className={room.mode === mode ? "is-on" : ""} onClick={() => setOption({ mode })}>
                {m.name}
              </button>
            ))}
          </div>
          {room.mode !== "deep" && (
            <label className="qzField">
              {room.mode === "knowme" ? "Questions each" : "Questions"}
              <select value={room.options.count} onChange={(e) => setOption({ count: Number(e.target.value) })}>
                {(room.mode === "knowme" ? [3, 5, 8, 10] : room.mode === "tot" ? [5, 10, 15, 20] : [5, 10, 15]).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
          {room.mode !== "deep" && (
            <label className="qzField">
              Timer
              <select value={room.options.timer} onChange={(e) => setOption({ timer: Number(e.target.value) })}>
                {[0, 10, 15, 20, 30].map((n) => (
                  <option key={n} value={n}>
                    {n ? `${n} seconds` : "Off"}
                  </option>
                ))}
              </select>
            </label>
          )}
          {room.mode === "trivia" && (
            <label className="qzField">
              Pack
              <select value={room.options.pack} onChange={(e) => setOption({ pack: e.target.value })}>
                <option value="mix">Mix of everything</option>
                {packs.triviaPacks.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {room.mode === "deep" && (
            <label className="qzField">
              Start at
              <select value={room.options.level} onChange={(e) => setOption({ level: Number(e.target.value) })}>
                <option value={1}>Light</option>
                <option value={2}>Deeper</option>
                <option value={3}>Deepest</option>
              </select>
            </label>
          )}
        </div>
      ) : (
        <Notice>
          <b>{room.hostName}</b> is picking the game: {info.name}. Get comfy!
        </Notice>
      )}

      {live.error && <Notice kind="is-error">{live.error}</Notice>}
      <div className="qzActions">
        {!full && (
          <Big kind="is-alt" onClick={() => setPicking(true)}>
            Invite someone
          </Big>
        )}
        {room.host && (
          <Big onClick={() => live.act("quiz:start")} disabled={!enough}>
            {enough ? "Start the show!" : `Waiting for players (${info.players})`}
          </Big>
        )}
      </div>
    </Screen>
  )
}

// ---------- a question ----------

const questionFor = (room, packs) => {
  const id = room.current.item
  if (room.mode === "knowme") {
    const q = packs.aboutMe.find((x) => x.id === id)
    const aboutYou = room.current.subject === room.you
    const subjectName = nameIn(room, room.current.subject)
    return {
      lead: aboutYou ? "All about you! Answer honestly." : `Guess ${subjectName}'s answer!`,
      text: aboutYou ? q.me : q.them.replace(/\{name\}/g, subjectName),
      options: q.options,
      round: room.current.subject === room.players[0]?.id ? 1 : 2,
      subjectName,
    }
  }
  if (room.mode === "tot") {
    const p = packs.pairs.find((x) => x.id === id)
    return p.kind === "tot" ? { lead: "This or that?", text: `${p.a} or ${p.b}?`, options: [p.a, p.b] } : { lead: null, text: "Would you rather...", options: [p.a, p.b] }
  }
  const q = packs.trivia.find((x) => x.id === id)
  return { lead: packs.triviaPacks.find((p) => q.id.startsWith(`tv-${p.id}-`))?.name, text: q.q, options: q.options }
}

const Question = ({ live, offset }) => {
  const { room } = live
  const { packs, sounds } = useQuiz()
  const q = questionFor(room, packs)
  const waitingFor = room.players.filter((p) => !p.answered && p.id !== room.you)
  const answered = room.yourAnswer !== null
  return (
    <div className="qzLive">
      {room.mode === "knowme" && (
        <div className="qzRoundTag">
          Round {q.round}: all about {room.current.subject === room.you ? "you" : q.subjectName}
        </div>
      )}
      <Progress step={room.step} total={room.total} />
      {room.deadline && !answered && <TimerBar key={`t${room.step}`} deadline={room.deadline - offset} seconds={room.options.timer} onTick={() => sounds.tick()} />}
      {q.lead && <div className="qzLead">{q.lead}</div>}
      <div className="qzQuestion" key={`q${room.step}`}>
        {q.text}
      </div>
      <Choices
        options={q.options}
        picked={room.yourAnswer}
        disabled={answered}
        letters={room.mode !== "tot"}
        onPick={(answer) => {
          sounds.lock()
          live.act("quiz:answer", { step: room.step, answer })
        }}
      />
      <div className="qzWaiting" aria-live="polite">
        {answered ? (
          waitingFor.length ? (
            <>
              <span className="qzBeat">
                <Heart size={14} />
              </span>{" "}
              Locked in! Waiting for {waitingFor.map((p) => p.name).join(", ")}...
            </>
          ) : (
            "Locked in!"
          )
        ) : (
          others(room)
            .filter((p) => p.answered)
            .map((p) => `${p.name} has answered.`)
            .join(" ")
        )}
      </div>
    </div>
  )
}

// ---------- the reveal ----------

const Reveal = ({ live }) => {
  const { room } = live
  const { packs, sounds } = useQuiz()
  const r = room.reveal
  const [burst, setBurst] = useState(0)
  const [ready, setReady] = useState(false) // a moment to enjoy the reveal before Next
  const q = questionFor({ ...room, current: { item: r.item, subject: r.subject } }, packs)
  const youRight = room.mode === "trivia" ? r.answers[room.you] === r.correct : r.match
  useEffect(() => {
    setReady(false)
    const later = setTimeout(() => setReady(true), 900)
    return () => clearTimeout(later)
  }, [room.step])
  useEffect(() => {
    sounds.drumroll()
    const t = setTimeout(() => {
      if (youRight) {
        room.mode === "trivia" ? sounds.right() : sounds.match()
        setBurst((b) => b + 1)
      } else room.mode === "trivia" ? sounds.wrong() : sounds.miss()
    }, 500)
    return () => clearTimeout(t)
  }, [room.step])

  const marks = {}
  for (const [pid, a] of Object.entries(r.answers)) if (a !== null) (marks[a] ||= []).push(pid === room.you ? "You" : r.names[pid])

  let headline
  if (room.mode === "knowme") {
    const subjectName = r.subject === room.you ? "You" : r.names[r.subject]
    const guesser = Object.keys(r.answers).find((p) => p !== r.subject)
    const guesserName = guesser === room.you ? "You" : r.names[guesser]
    headline = r.truth === null ? `${subjectName} ran out of time!` : r.match ? `${reaction(true, room.step)} ${guesserName} guessed it!` : `${reaction(false, room.step)} ${subjectName} said "${q.options[r.truth]}".`
  } else if (room.mode === "tot") {
    const n = Object.keys(r.answers).length
    headline = r.match ? (n === 2 ? `You both picked ${q.options[Object.values(r.answers)[0]]}!` : `Everyone picked ${q.options[Object.values(r.answers)[0]]}!`) : "Split decision!"
  } else {
    const pts = r.points[room.you] || 0
    headline = r.answers[room.you] === r.correct ? `Correct! +${pts} points` : r.answers[room.you] === null ? "Time's up!" : "Not quite!"
  }

  return (
    <div className={`qzLive qzReveal${youRight ? " is-match" : ""}`}>
      <HeartBurst burst={burst} />
      <Progress step={room.step} total={room.total} />
      <div className="qzQuestion is-small">{q.text}</div>
      <div className={`qzHeadline${youRight ? " is-match" : ""}`}>{headline}</div>
      <Choices options={q.options} marks={marks} correct={room.mode === "trivia" ? r.correct : room.mode === "knowme" ? r.truth : null} picked={room.mode === "trivia" ? r.answers[room.you] : null} disabled letters={room.mode !== "tot"} />
      {room.mode === "trivia" && <Scoreboard room={room} />}
      <div className="qzActions">
        <Big onClick={() => live.act("quiz:next")} disabled={!ready}>
          {room.step + 1 >= room.total ? "See the results!" : "Next question"}
        </Big>
      </div>
    </div>
  )
}

const Scoreboard = ({ room }) => (
  <ol className="qzScores">
    {[...room.players]
      .sort((a, b) => b.score - a.score)
      .map((p) => (
        <li key={p.id} className={p.id === room.you ? "is-you" : ""}>
          <span>{p.id === room.you ? "You" : p.name}</span>
          <b>{p.score}</b>
        </li>
      ))}
  </ol>
)

// ---------- results ----------

const Results = ({ live }) => {
  const { room } = live
  const { packs, sounds } = useQuiz()
  const result = room.result
  const [burst, setBurst] = useState(0)
  const recorded = useRef(null)

  // remember the game here (once), and what you learned about each other
  useEffect(() => {
    const key = `${room.id}:${room.round}`
    if (recorded.current === key) return
    recorded.current = key
    const withNames = others(room).map((p) => p.name).join(", ")
    if (room.mode === "trivia") {
      const mine = result.standings.find((s) => s.id === room.you)
      const won = result.winners.includes(room.you)
      recordGame({ mode: "trivia", with: withNames, score: mine?.score, total: result.total, percent: result.total ? Math.round(((mine?.correct || 0) / result.total) * 100) : 0, won, live: true, triviaPerfect: mine && mine.correct === result.total && result.total > 0 })
      if (won) (sounds.fanfare(), setBurst(1))
      return
    }
    if (room.mode === "knowme") {
      const facts = room.log.filter((s) => s && s.truth !== null).map((s) => ({ subject: s.names[s.subject], qid: s.item, answer: s.truth }))
      addFacts(facts)
      const mine = result.players[room.you]
      const perfect = !room.note && mine && mine.of > 0 && mine.guessed === mine.of
      recordGame({ mode: "knowme", with: withNames, percent: result.percent, won: !room.note && result.percent >= 50, live: true, perfect })
    } else recordGame({ mode: "tot", with: withNames, percent: result.percent, won: !room.note && result.percent >= 50, live: true })
    if (result.percent >= 50) {
      sounds.fanfare()
      setBurst(1)
    }
  }, [room.id, room.round])

  let card
  if (room.mode === "trivia") {
    const winners = result.winners.map((id) => (id === room.you ? "You" : nameIn(room, id)))
    card = (
      <ResultCard burst={burst} title={winners.length ? `${winners.join(" & ")} ${winners.length > 1 || winners[0] === "You" ? "win" : "wins"}!` : "Game over!"}>
        <ol className="qzPodium">
          {result.standings.map((s, i) => (
            <li key={s.id} className={`qzPlace${i + 1}${s.id === room.you ? " is-you" : ""}`}>
              <span className="qzPlaceNo">{i + 1}</span>
              <span className="qzPlaceName">{s.id === room.you ? "You" : s.name}</span>
              <span className="qzPlaceScore">
                {s.score} pts <small>({s.correct}/{result.total})</small>
              </span>
            </li>
          ))}
        </ol>
      </ResultCard>
    )
  } else if (room.mode === "knowme") {
    card = (
      <ResultCard burst={burst} title="Soulmate level" percent={result.percent} line={soulmateLine(result.percent)}>
        <ul className="qzBreakdown">
          {Object.entries(result.players).map(([id, p]) => (
            <li key={id}>
              <b>{id === room.you ? "You" : p.name}</b> guessed {p.guessed} of {p.of} of {id === room.you ? "their" : "your"} answers
            </li>
          ))}
        </ul>
      </ResultCard>
    )
  } else {
    card = (
      <ResultCard burst={burst} title="In sync" percent={result.percent} line={`You matched on ${result.matches} of ${result.total}! ${result.percent >= 70 ? "Great minds think alike." : result.percent >= 40 ? "Just enough in common, just enough to argue about." : "Opposites attract!"}`} />
    )
  }

  return (
    <Screen title={LIVE_MODES[room.mode].name} mode={LIVE_MODES[room.mode].icon} onBack={live.leave} className="qzDone">
      {room.note && <Notice kind="is-warn">{room.note}</Notice>}
      {card}
      {room.mode !== "trivia" && room.log.length > 0 && <Recap room={room} packs={packs} />}
      <div className="qzActions">
        {room.host ? <Big onClick={() => live.act("quiz:again")}>Play again</Big> : <Notice>{room.hostName ? `${room.hostName} can start another round.` : ""}</Notice>}
        <Big kind="is-alt" onClick={live.leave}>
          Back to the menu
        </Big>
      </div>
    </Screen>
  )
}

const Recap = ({ room, packs }) => (
  <details className="qzRecap">
    <summary>See every answer</summary>
    <ul>
      {room.log.filter(Boolean).map((s) => {
        const q = questionFor({ ...room, current: { item: s.item, subject: s.subject } }, packs)
        return (
          <li key={s.step} className={s.match ? "is-match" : ""}>
            <span className="qzRecapQ">{q.text}</span>
            {Object.entries(s.answers).map(([pid, a]) => (
              <span key={pid} className="qzRecapA">
                {pid === room.you ? "You" : s.names[pid]}: <b>{a === null ? "(no answer)" : q.options[a]}</b>
              </span>
            ))}
            {s.match && <Heart size={14} />}
          </li>
        )
      })}
    </ul>
  </details>
)

// ---------- deep talk ----------

const LEVEL_NAMES = { 1: "Light", 2: "Deeper", 3: "Deepest" }

export const DeepCard = ({ card, favorite, onFavorite, flipKey }) => (
  <div className={`qzDeepCard qzLevel${card.level}`} key={flipKey}>
    <div className="qzDeepLevel">{LEVEL_NAMES[card.level]}</div>
    <p className="qzDeepText">{card.text}</p>
    <button type="button" className={`qzFav${favorite ? " is-on" : ""}`} onClick={onFavorite} aria-pressed={favorite} aria-label={favorite ? "Remove from favorites" : "Add to favorites"}>
      <Heart size={22} color={favorite ? "#ff4f8b" : "#fff"} stroke={favorite ? "#a3123f" : "#a3123f"} />
    </button>
  </div>
)

const DeepLive = ({ live }) => {
  const { room } = live
  const { packs, sounds } = useQuiz()
  const data = useQuizData()
  const card = packs.deep.find((c) => c.id === room.card.id)
  useEffect(() => {
    sounds.flip()
    seeDeepCard(card.id)
  }, [card.id])
  return (
    <Screen title="Deep Talk Cards" mode="deep" onBack={live.leave} className="qzDeep">
      {room.note && <Notice kind="is-warn">{room.note}</Notice>}
      <div className="qzLevels" role="tablist">
        {[1, 2, 3].map((l) => (
          <button key={l} type="button" role="tab" aria-selected={card.level === l} className={card.level === l ? "is-on" : ""} onClick={() => live.act("quiz:level", { level: l })}>
            {LEVEL_NAMES[l]}
          </button>
        ))}
      </div>
      <DeepCard card={card} flipKey={card.id} favorite={data.favorites.includes(card.id)} onFavorite={() => toggleFavorite(card.id)} />
      <p className="qzHint">
        Card {room.card.drawn}. Everyone sees the same card: take turns answering out loud (or in the chat).
      </p>
      <div className="qzActions">
        <Big onClick={() => live.act("quiz:next")}>Next card</Big>
        {room.host && (
          <Big kind="is-alt" onClick={() => live.act("quiz:again")}>
            Change game
          </Big>
        )}
      </div>
    </Screen>
  )
}

// ---------- shows: How Well Do You Know Me, This or That ----------

const SHOW_MODES = ["knowme", "tot"]

// Waiting for the other contestant (an invitation is out), then the host starts the show
const ShowLobby = ({ live }) => {
  const { room } = live
  const { sounds } = useQuiz()
  const [picking, setPicking] = useState(false)
  const info = LIVE_MODES[room.mode]
  const enough = room.players.length >= room.min
  const full = room.players.length >= room.max
  const me = room.players.find((p) => p.id === room.you)
  const others = room.players.filter((p) => p.id !== room.you)
  const pack = packsFor(room.mode).find((p) => p.id === room.options.pack)
  const length = LENGTHS[room.mode].find((l) => l.count === room.options.count)
  useEffect(() => {
    if (enough) sounds.pop()
  }, [enough])

  if (picking) {
    return (
      <Screen title="Invite someone" mode={info.icon} onBack={() => setPicking(false)}>
        <PersonPicker
          kind="live"
          onPick={async (target) => {
            const r = await live.invite(target)
            if (r.ok) setPicking(false)
          }}
          onCancel={() => setPicking(false)}
        />
        {live.error && <Notice kind="is-error">{live.error}</Notice>}
      </Screen>
    )
  }

  const line = enough
    ? room.host
      ? "Everybody's here! Hit the big button when you're ready."
      : `${room.hostName} is about to start the show. Get comfy!`
    : room.invited.length
      ? `I sent ${room.invited.join(" and ")} an invitation. It pops up on their screen!`
      : "Who's playing with you tonight? Invite someone!"
  return (
    <Screen title={info.name} mode={info.icon} onBack={live.leave} className="qzShowLobby">
      <Host line={line} size="big" />
      <div className="qzVs">
        <div className="qzVsSeat is-you">
          <span className="qzPlateAvatar">
            <Heart size={22} />
          </span>
          <b>{me?.name}</b>
          <small>you{room.host ? ", host" : ""}</small>
        </div>
        <span className="qzVsWord">{room.mode === "knowme" ? "vs" : "&"}</span>
        {others.length ? (
          others.map((p) => (
            <div key={p.id} className="qzVsSeat is-in" data-joined={p.name}>
              <span className="qzPlateAvatar">{p.name.slice(0, 1).toUpperCase()}</span>
              <b>{p.name}</b>
              <small>{p.away ? "away" : "ready!"}</small>
            </div>
          ))
        ) : (
          <div className="qzVsSeat is-empty">
            <span className="qzPlateAvatar">?</span>
            <b>{room.invited[0] || "Empty seat"}</b>
            <small>{room.invited.length ? "invited, waiting..." : "nobody yet"}</small>
          </div>
        )}
      </div>
      <p className="qzChips">
        <span>{pack?.name || "Grab Bag"}</span>
        <span>
          {length?.name || "Classic"} ({room.mode === "knowme" ? `${room.options.count} each` : `${room.options.count} picks`})
        </span>
        <span>{room.options.clock ? "Ticking clock" : "No clock"}</span>
      </p>
      {live.error && <Notice kind="is-error">{live.error}</Notice>}
      <div className="qzActions">
        {room.host && (
          <Big onClick={() => live.act("quiz:start")} disabled={!enough} data-action="start-show">
            {enough ? "Start the show!" : "Waiting for your partner..."}
          </Big>
        )}
        {!full && (
          <Big kind="is-alt" onClick={() => setPicking(true)}>
            {room.invited.length ? "Invite someone else" : "Invite someone"}
          </Big>
        )}
        <Big kind="is-alt" onClick={live.leave}>
          Cancel
        </Big>
      </div>
    </Screen>
  )
}

// A live show: round cards, questions, bets and reveals, all timed by the server
const LiveShow = ({ live }) => {
  const { room } = live
  const { packs, home } = useQuiz()
  const recorded = useRef(null)
  const [unlocked, setUnlocked] = useState(null)
  const offset = useMemo(() => room.now - Date.now(), [room])
  const local = (t) => (t ? t - offset : null)
  const order = room.order || room.players.map((p) => ({ id: p.id, name: p.name }))
  const names = order.map((o) => o.name)
  const seat = (id) => order.findIndex((o) => o.id === id)
  const you = (id, name) => (id === room.you ? "You" : name)
  // the new points show once the reveal opens (not during the drum roll)
  const [openStep, setOpenStep] = useState(-1)
  const hiding = room.phase === "reveal" && openStep !== room.step
  const players = order.map((o) => {
    const p = room.players.find((x) => x.id === o.id)
    const hide = hiding ? room.reveal?.gained?.[o.id] || 0 : 0
    return { name: you(o.id, o.name), points: (p?.score ?? 0) - hide, streak: hide ? 0 : p?.streak ?? 0, you: o.id === room.you }
  })
  const mode = room.mode

  // remember a finished show here (once), and what you learned about each other
  useEffect(() => {
    if (room.phase !== "done" || !room.result) return
    const key = `${room.id}:${room.round}`
    if (recorded.current === key) return
    recorded.current = key
    const r = room.result
    const facts = mode === "knowme" ? room.log.filter((s) => s && s.truth !== null && s.truth !== undefined).map((s) => ({ subject: s.names[s.subject], qid: s.item, answer: s.truth })) : []
    const mine = r.players?.[room.you]
    setUnlocked(
      recordShow({
        mode,
        how: "live",
        with: others(room).map((p) => p.name).join(", "),
        summary: { tier: r.tier, headline: r.headline, percent: r.percent },
        points: mine?.points ?? null,
        won: !room.note && (mode === "tot" ? r.percent >= 55 : r.winner === room.you),
        perfect: !room.note && mode === "knowme" && mine && mine.of > 0 && mine.guessed === mine.of,
        facts,
      })
    )
  }, [room.phase, room.id, room.round])

  if (room.phase === "done") {
    const r = room.result
    const recap = room.log.filter(Boolean).map((s) => {
      const q = showQuestion(mode, packs, s.item, { name: s.subject ? you(s.subject, s.names[s.subject]) : "" })
      const text = (a) => (a === null || a === undefined ? "(no answer)" : q.options[a])
      return {
        text: q.text,
        match: s.match,
        answers:
          mode === "knowme"
            ? [
                { label: `${you(s.subject, s.names[s.subject])} said`, text: text(s.answers[s.subject]) },
                { label: `${you(s.guesser, s.names[s.guesser])} guessed`, text: text(s.answers[s.guesser]) },
              ]
            : Object.entries(s.answers).map(([pid, a]) => ({ label: you(pid, s.names[pid]), text: text(a) })),
      }
    })
    const list = order.map((o) => ({ name: o.name, points: r.players?.[o.id]?.points ?? 0, best: mode === "tot" ? r.best : r.players?.[o.id]?.best ?? 0, you: o.id === room.you, winner: r.winner === o.id }))
    return (
      <Screen title={LIVE_MODES[mode].name} mode={LIVE_MODES[mode].icon} onBack={live.leave} className="qzShow is-done">
        <ShowResults
          mode={mode}
          summary={{ tier: r.tier, headline: r.headline, percent: r.percent }}
          players={list}
          recap={recap}
          note={room.note}
          unlocked={unlocked}
          onAgain={room.host && !room.note ? () => live.act("quiz:again") : null}
          againLabel="Rematch!"
          onHome={() => (live.leave(), home())}
          extra={!room.host && !room.note ? <p className="qzHint">{room.hostName} can start a rematch.</p> : null}
        />
      </Screen>
    )
  }

  const cur = room.current
  const step = cur ? { round: cur.round, mult: cur.mult, base: cur.base, bet: cur.bet, timer: cur.timer } : { round: room.roundCard?.round, mult: 1 }
  const mySeat = seat(room.you)
  let body
  if (room.phase === "round") {
    body = <RoundCard mode={mode} round={room.roundCard.round} names={names} you={mySeat >= 0 ? mySeat : null} until={local(room.roundCard.until)} onSkip={() => live.act("quiz:next")} n={room.step} />
  } else if (room.phase === "bet") {
    const rows = order.map((o, k) => {
      const p = room.players.find((x) => x.id === o.id)
      const isMe = o.id === room.you
      const other = order[1 - k]
      return { name: o.name, you: isMe, points: p?.score ?? 0, bet: isMe ? room.yourBet : null, hidden: !isMe, decided: !!p?.answered, onText: other ? `on guessing ${other.id === room.you ? "your" : `${other.name}'s`} answer` : "" }
    })
    body = (
      <BetView
        rows={rows.sort((a, b) => (b.you ? 1 : 0) - (a.you ? 1 : 0))}
        onBet={(k, id) => live.act("quiz:bet", { bet: id })}
        deadline={local(room.deadline)}
        seconds={20}
        waiting={room.yourBet ? "Bet placed! Waiting for the other bet..." : null}
      />
    )
  } else if (room.phase === "question") {
    const aboutYou = mode === "knowme" && cur.subject === room.you
    const subjectName = cur.subject ? names[seat(cur.subject)] : ""
    const q = showQuestion(mode, packs, cur.item, { aboutYou, name: subjectName })
    const role = mode === "tot" ? { kind: "pick", other: others(room).map((p) => p.name).join(" & ") } : aboutYou ? { kind: "self", other: others(room)[0]?.name } : { kind: "guess", name: subjectName }
    const waitingFor = room.players.filter((p) => !p.answered && p.id !== room.you)
    const myBet = room.bets?.[room.you]
    body = (
      <QuestionView
        key={room.step}
        step={{ ...step, betText: cur.bet && !aboutYou && myBet ? betWords(myBet, room.players.find((p) => p.id === room.you)?.score ?? 0) : null }}
        role={role}
        text={q.text}
        options={q.options}
        picked={room.yourAnswer}
        onPick={(answer) => live.act("quiz:answer", { step: room.step, answer })}
        deadline={local(room.deadline)}
        seconds={cur.timer}
        waiting={waitingFor.length ? `Locked in! Waiting for ${waitingFor.map((p) => p.name).join(", ")}...` : "Locked in!"}
      />
    )
  } else if (room.phase === "reveal") {
    const r = room.reveal
    const q = showQuestion(mode, packs, r.item, { name: r.subject ? you(r.subject, r.names[r.subject]) : "" })
    const cards =
      mode === "knowme"
        ? [
            { label: `${you(r.subject, r.names[r.subject])} said`, answer: r.answers[r.subject] },
            { label: `${you(r.guesser, r.names[r.guesser])} guessed`, answer: r.answers[r.guesser] },
          ]
        : order.map((o) => ({ label: `${you(o.id, o.name)} picked`, answer: r.answers[o.id] ?? null }))
    const gained = order.map((o) => r.gained?.[o.id] || 0)
    const g = mode === "knowme" ? seat(r.guesser) : 0
    body = (
      <RevealView
        mode={mode}
        step={{ round: r.round, mult: r.mult, bet: !!r.bet }}
        n={room.step}
        text={q.text}
        options={q.options}
        cards={cards}
        match={r.match}
        showAt={local(r.showAt)}
        onOpen={setOpenStep}
        onFire={r.onFire}
        streak={r.streak}
        guesserName={mode === "knowme" ? you(r.guesser, r.names[r.guesser]) : "You two"}
        timedOut={mode === "knowme" && (r.answers[r.subject] === null || r.answers[r.guesser] === null)}
        betWon={!!r.bet && r.match}
        gainedLine={gainedWords(mode, gained, order.map((o) => you(o.id, o.name)), g)}
        nextLabel={room.step + 1 >= room.total ? "See the results!" : "Next question"}
        onNext={() => live.act("quiz:next")}
      />
    )
  }
  return (
    <Screen title={LIVE_MODES[mode].name} mode={LIVE_MODES[mode].icon} onBack={live.leave} className={`qzShow is-${room.phase}`}>
      <ScoreBar mode={mode} players={players} step={room.step} total={room.total} highlight={mode === "knowme" && cur?.subject ? seat(cur.subject) : null} />
      <div className="qzShowBody" key={`${room.phase}:${room.step}`}>
        {body}
      </div>
      {live.error && !/Not yet/.test(live.error) && <Notice kind="is-error">{live.error}</Notice>}
      {mySeat < 0 && <Notice>You're watching this show.</Notice>}
    </Screen>
  )
}

// ---------- the room ----------

export const LiveRoom = ({ live }) => {
  const { room } = live
  const { packs } = useQuiz()
  const offset = room ? room.now - Date.now() : 0
  const offsetRef = useRef(0)
  if (room) offsetRef.current = offset
  if (!packs) return <Loading />
  let body
  if (SHOW_MODES.includes(room.mode)) body = room.phase === "lobby" ? <ShowLobby live={live} /> : <LiveShow live={live} />
  else if (room.phase === "lobby") body = <Lobby live={live} />
  else if (room.phase === "card") body = <DeepLive live={live} />
  else if (room.phase === "done") body = <Results live={live} />
  else
    body = (
      <Screen title={LIVE_MODES[room.mode].name} mode={LIVE_MODES[room.mode].icon} onBack={live.leave}>
        {room.phase === "question" ? <Question live={live} offset={offsetRef.current} /> : <Reveal live={live} />}
        {live.error && <Notice kind="is-error">{live.error}</Notice>}
      </Screen>
    )
  return (
    <div className="qzRoom">
      {body}
      {room.phase !== "lobby" && room.players.length > 1 && (
        <div className="qzReactions" aria-label="Reactions">
          {REACTIONS.map((r) => (
            <button key={r.kind} type="button" title={r.label} aria-label={r.label} onClick={() => live.act("quiz:react", { kind: r.kind })}>
              {r.kind === "heart" ? <Heart size={18} /> : r.glyph}
            </button>
          ))}
        </div>
      )}
      <div className="qzFloaters" aria-hidden="true">
        {live.floaters.map((f) => (
          <span key={f.id} className="qzFloater" style={{ left: `${f.x}%` }}>
            {f.kind === "heart" ? <Heart size={26} /> : REACTIONS.find((r) => r.kind === f.kind)?.glyph}
            <small>{f.from}</small>
          </span>
        ))}
      </div>
    </div>
  )
}

export { HeartMeter }
