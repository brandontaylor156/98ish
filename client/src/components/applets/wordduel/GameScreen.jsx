import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import Board, { FLIP_MS, MiniBoard } from "./Board"
import Keyboard from "./Keyboard"
import Confetti from "./Confetti"
import { keyStates } from "./logic"
import { FORMATS, PRESETS } from "./settings"

// One game of Word Duel on screen, from the rules' view (rules.js view()): the same for a
// solo game (local.js) and an online room (the server sends the view). Your boards, the
// row you're typing, the keyboard, everyone else's progress in a strip on top, clocks,
// the end of each round and the final results.
//   view: the rules' view for you; act(action) -> Promise<{ ok, error }>;
//   names: seat names (online: the room's, which follow computer players taking over);
//   serverNow(): the server's clock (online); footer: the buttons under the final results;
//   extra: more for the final results (Share); sounds: audio.js

const fmtClock = (ms) => {
  const t = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`
}
const fmtTime = (ms) => (ms === null || ms === undefined ? "" : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : fmtClock(ms))

const useNow = (ms, on = true) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms, on])
  return now
}

const useSize = (ref) => {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return size
}

// the biggest tiles that fit `n` boards of `rows` x `len` into w x h
const layoutBoards = (w, h, n, len, rows) => {
  let best = { cols: 1, tile: 12 }
  const gapB = n > 1 ? 12 : 0
  for (let cols = 1; cols <= n; cols++) {
    const r = Math.ceil(n / cols)
    if (cols > 1 && n % cols && r > 1) continue
    const tw = (w - (cols - 1) * gapB - 4) / cols / (len + (len - 1) * 0.1)
    const th = (h - (r - 1) * gapB - (n > 1 ? r * 16 : 0) - 4) / r / (rows + (rows - 1) * 0.1)
    const t = Math.min(tw, th, 62)
    if (t > best.tile) best = { cols, tile: t }
  }
  return { cols: best.cols, tile: Math.floor(Math.max(12, best.tile)) }
}

const Countdown = ({ until, now, label, warn = 10 }) => {
  if (!until) return null
  const left = until - now
  return (
    <span className={`wdClock${left <= warn * 1000 ? " is-warn" : ""}`} data-clock={label}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <circle cx="8" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 9V5.5M6 1.5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {label && <span className="wdClockLabel">{label}</span>}
      {fmtClock(left)}
    </span>
  )
}

const define = (word) => `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`

const WordLink = ({ word }) =>
  word ? (
    <a className="wdWord" href={define(word)} target="_blank" rel="noopener noreferrer" title={`Look up "${word}" (opens Wiktionary)`}>
      {word.toUpperCase()}
    </a>
  ) : (
    <span className="wdWord">?</span>
  )

const GameScreen = ({ view, act, names, serverNow = () => Date.now(), sounds, contrast = false, mobile = false, footer = null, extra = null, words = null, onSolved, title = null, onLeave = null }) => {
  const rootRef = useRef(null)
  const areaRef = useRef(null)
  const area = useSize(areaRef)
  const [typed, setTyped] = useState("")
  const [toast, setToast] = useState(null)
  const [shake, setShake] = useState(0)
  const [pending, setPending] = useState(false)
  const [pickWord, setPickWord] = useState("")
  const toastTimer = useRef(null)
  const prevRef = useRef(null)
  const tickRef = useRef(null)

  const s = view.settings
  const len = s.length
  const mine = view.mine >= 0 ? view.sets[view.mine] : null
  const shared = s.format === "turns" || s.format === "coop"
  const voting = s.format === "coop" && s.coopMode === "vote"
  useNow(250, view.phase !== "over") // clocks
  const now = serverNow()
  const nameOf = (seat) => names?.[seat] || view.names[seat] || `Player ${seat + 1}`
  const teamName = (t) => (view.teams[t] ? view.teams[t].seats.map(nameOf).join(" & ") : "?")
  const myTeam = view.teams.findIndex((t) => t.seats.includes(view.you))
  const myTurn = !mine || mine.turnSeat === null || mine.turnSeat === view.you
  const canType = view.phase === "play" && !!mine && !mine.done && myTurn
  const rushKey = mine?.rush ? mine.rush.solved + mine.rush.failed : 0

  const say = (text, ms = 1600) => {
    setToast(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  // a new round or a new rush word: start typing fresh
  useEffect(() => setTyped(""), [view.round, rushKey])

  // keep the keyboard focus on the game (not when someone is typing in another window)
  useEffect(() => {
    const el = rootRef.current
    const active = document.activeElement
    const other = active?.closest?.(".window")
    if (el && (!other || other.contains(el))) el.focus({ preventScroll: true })
  }, [view.phase])

  const submit = async () => {
    if (pending) return
    if (typed.length < len) {
      setShake((n) => n + 1)
      sounds?.bad()
      return say("Not enough letters")
    }
    setPending(true)
    const result = await act({ type: "guess", word: typed })
    setPending(false)
    if (!result.ok) {
      setShake((n) => n + 1)
      sounds?.bad()
      say(result.error || "Not allowed")
      return
    }
    setTyped("")
    if (voting) say("Suggested! Waiting for votes...")
  }

  const onKey = (key) => {
    if (view.phase === "pick") return
    if (!canType) {
      if (view.phase === "play" && mine && !mine.done && !myTurn) say(`It's ${nameOf(mine.turnSeat)}'s turn`)
      return
    }
    if (key === "Enter") return submit()
    if (key === "Backspace") {
      if (typed) sounds?.erase()
      return setTyped((t) => t.slice(0, -1))
    }
    if (/^[a-z]$/.test(key) && typed.length < len) {
      sounds?.key()
      setTyped((t) => (t.length < len ? t + key : t))
    }
  }

  const onKeyDown = (e) => {
    if (e.target !== rootRef.current && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key
    if (k === "Enter" || k === "Backspace" || /^[a-zA-Z]$/.test(k)) {
      e.preventDefault()
      onKey(k.length === 1 ? k.toLowerCase() : k)
    }
  }

  // ---------- sounds for what changed ----------
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = view
    if (!prev || !sounds) return
    const pm = prev.mine >= 0 ? prev.sets[prev.mine] : null
    if (view.phase === "play" && (prev.phase !== "play" || prev.round !== view.round)) sounds.roundStart()
    if (mine && pm && prev.round === view.round) {
      const sameWord = (pm.rush ? pm.rush.solved + pm.rush.failed : 0) === rushKey
      if (sameWord && mine.words > pm.words) {
        const board = mine.boards.find((b, i) => pm.boards[i]?.solvedAt === null) || mine.boards[0]
        const last = board.rows[board.rows.length - 1]
        if (last?.colors) sounds.flip(last.colors, FLIP_MS)
      }
      if (!sameWord && mine.rush) {
        // the rush word just ended: the last row flipped, then on to the next word
        if (mine.rush.last?.solved) sounds.win(0)
        else sounds.lose(0)
      }
      if (mine.solved && !pm.solved) {
        sounds.win((len * FLIP_MS) / 1000)
        onSolved?.(mine)
      } else if (mine.done && !mine.solved && !pm.done && view.phase === "play") sounds.lose((len * FLIP_MS) / 1000)
    }
    const solvedCount = (v) => v.sets.filter((x, i) => i !== v.mine && x.solved).length
    if (prev.round === view.round && solvedCount(view) > solvedCount(prev)) sounds.ping()
    if (myTeam >= 0 && prev.teams[myTeam]?.alive && !view.teams[myTeam]?.alive) sounds.out()
  }, [view])

  // the last seconds tick
  const guessLeft = mine?.deadline ? mine.deadline - now : null
  const roundLeft = view.deadline ? view.deadline - now : null
  const urgent = [guessLeft, roundLeft].filter((x) => x !== null && x > 0).sort((a, b) => a - b)[0]
  useEffect(() => {
    if (urgent === undefined || view.phase !== "play") return
    const sec = Math.ceil(urgent / 1000)
    if (sec <= 5 && sec !== tickRef.current) {
      tickRef.current = sec
      sounds?.tick()
    }
  }, [urgent === undefined ? null : Math.ceil(urgent / 1000)])

  // ---------- layout ----------
  const boardCount = mine ? mine.boards.length : 0
  const rowsShown = mine ? (mine.max ? mine.max : Math.max(6, mine.words + 1)) : 6
  const L = layoutBoards(area.w, area.h, Math.max(1, boardCount), len, rowsShown)

  const keyStatesFor = () => {
    if (!mine) return [{}]
    if (mine.boards.length === 1) return [keyStates(mine.boards[0].rows)]
    return mine.boards.map((b) => (b.solvedAt !== null ? {} : keyStates(b.rows)))
  }

  const others = view.sets.map((set, i) => ({ set, i })).filter(({ i }) => i !== view.mine)
  const out = view.teams.map((t, i) => ({ t, i })).filter(({ t }) => !t.alive)
  const myAlive = myTeam < 0 || view.teams[myTeam].alive
  const last = view.history[view.history.length - 1]
  const youWon = view.final?.winners?.includes(view.you)

  // ---------- pieces ----------
  const header = (
    <div className="wdTopBar">
      <span className="wdMode">
        {title || PRESETS[s.preset]?.label || FORMATS[s.format]?.label}
        {s.hard && <span className="wdBadge">HARD</span>}
      </span>
      {(view.rounds > 1 || s.format === "royale") && (
        <span className="wdRound" data-round={view.round}>
          Round {view.round}
          {view.rounds > 1 ? ` of ${view.rounds}` : ""}
        </span>
      )}
      <span className="wdTopRight">
        {view.phase === "play" && <Countdown until={view.deadline} now={now} label={s.format === "rush" ? "Rush" : "Round"} warn={s.format === "rush" ? 15 : 10} />}
        {view.phase === "play" && mine && !mine.done && <Countdown until={mine.deadline} now={now} label="Guess" warn={5} />}
        {view.phase === "pick" && <Countdown until={view.pick?.deadline} now={now} label="Pick" />}
        {onLeave && view.phase !== "over" && (
          <button type="button" className="wdSmallBtn wdLeave" onClick={onLeave} title="Leave this game">
            Leave
          </button>
        )}
      </span>
    </div>
  )

  const scoreChips =
    view.teams.length > 1 && (view.rounds > 1 || s.format === "rush" || s.format === "royale") ? (
      <div className="wdScores">
        {view.teams.map((t, i) => (
          <span key={i} className={`wdScore${i === myTeam ? " is-you" : ""}${t.alive ? "" : " is-out"}`} data-team={i}>
            <b>{teamName(i)}</b>
            <span>{s.series === "wins" && s.format !== "royale" ? `${t.wins} won` : s.format === "royale" ? (t.alive ? "in" : "out") : `${t.points} pt${t.points === 1 ? "" : "s"}`}</span>
          </span>
        ))}
      </div>
    ) : null

  const statusOf = (set) => {
    if (set.rush) return `★ ${set.rush.solved}`
    if (set.solved) return `✓ ${set.words}`
    if (set.done) return "✗"
    return set.max ? `${set.words}/${set.max}` : `${set.words}`
  }

  const strip =
    mine && !shared && (others.length > 0 || out.length > 0) ? (
      <div className="wdStrip" aria-label="Other players">
        {others.map(({ set, i }) => (
          <div key={i} className={`wdOpp${set.solved ? " is-solved" : set.done ? " is-done" : ""}`} data-set={i}>
            <div className="wdOppHead">
              <b>{set.team !== null ? teamName(set.team) : "Everyone"}</b>
              <span className="wdOppStatus">{statusOf(set)}</span>
            </div>
            {set.boards[0].rows.length || s.show !== "none" ? (
              <div className="wdOppBoards">
                {set.boards.slice(0, 4).map((b, k) => (
                  <MiniBoard key={k} rows={b.rows} length={len} max={set.max ? Math.min(set.max, 8) : Math.min(8, Math.max(set.words, 3))} size={set.boards.length > 1 ? 5 : mobile ? 7 : 9} letters={s.show === "full" || view.phase !== "play"} solved={b.solvedAt !== null} />
                ))}
              </div>
            ) : (
              <div className="wdOppHidden">{set.words} guess{set.words === 1 ? "" : "es"}</div>
            )}
          </div>
        ))}
        {out.map(({ i }) => (
          <div key={`out${i}`} className="wdOpp is-out" data-out={i}>
            <div className="wdOppHead">
              <b>{teamName(i)}</b>
              <span className="wdOppStatus">OUT</span>
            </div>
          </div>
        ))}
      </div>
    ) : null

  // turn order on a shared board
  const turnBar =
    shared && mine ? (
      <div className="wdTurns">
        {mine.seats.map((seat) => (
          <span key={seat} className={`wdTurn${mine.turnSeat === seat ? " is-now" : ""}${seat === view.you ? " is-you" : ""}`}>
            {nameOf(seat)}
            {mine.turnSeat === seat && <small>{seat === view.you ? "your turn" : "thinking..."}</small>}
          </span>
        ))}
      </div>
    ) : null

  let banner = null
  if (view.phase === "play") {
    if (!mine) banner = view.setter === view.you && view.secret ? `You picked ${view.secret.toUpperCase()}. Watch them try!` : myAlive ? "You're watching this game." : "You're out! Watching the rest."
    else if (mine.done) banner = mine.solved ? `Solved in ${mine.words}!${others.some(({ set }) => !set.done) ? " Waiting for the others..." : ""}` : `Out of guesses.${others.some(({ set }) => !set.done) ? " Waiting for the others..." : ""}`
    else if (mine.turnSeat !== null) banner = mine.turnSeat === view.you ? "Your turn!" : `${nameOf(mine.turnSeat)}'s turn...`
    else if (voting) banner = "Type a word to suggest it. The most votes gets played."
    else if (mine.rush) banner = mine.rush.last ? `${mine.rush.last.solved ? "Got it" : "Missed"}: ${mine.rush.last.answer?.toUpperCase()} · ${mine.rush.solved} solved` : "Solve as many as you can!"
    else if (mine.boards[0].left !== undefined) banner = `${mine.boards[0].left} word${mine.boards[0].left === 1 ? "" : "s"} still possible`
    else if (view.secret && s.format === "sabotage") banner = `You gave ${others.map(({ set }) => (set.team !== null ? teamName(set.team) : "")).join(", ")} the word ${view.secret.toUpperCase()}.`
  }

  const votes =
    voting && mine?.votes?.length && view.phase === "play" ? (
      <div className="wdVotes" aria-label="Suggestions">
        {Object.entries(
          mine.votes.reduce((m, v) => {
            ;(m[v.word] ||= []).push(v.seat)
            return m
          }, {})
        ).map(([word, seats]) => (
          <div key={word} className="wdVote" data-vote={word}>
            <span className="wdVoteWord">{word.toUpperCase()}</span>
            <small>{seats.map(nameOf).join(", ")}</small>
            {!seats.includes(view.you) && (
              <button type="button" className="wdSmallBtn" onClick={() => act({ type: "guess", word }).then((r) => !r.ok && say(r.error))}>
                Vote
              </button>
            )}
          </div>
        ))}
      </div>
    ) : null

  // ---------- the picking phase ----------
  const pickPanel =
    view.phase === "pick" && view.pick ? (
      <div className="wdPick">
        {view.pick.you && !view.pick.yours ? (
          <form
            className="wdPickForm"
            onSubmit={async (e) => {
              e.preventDefault()
              const r = await act({ type: "pick", word: pickWord })
              if (!r.ok) say(r.error, 2500)
            }}
          >
            <h3>{view.pick.target === null || view.pick.target === undefined ? "You pick the secret word" : `Pick a word for ${teamName(view.pick.target)}`}</h3>
            <p>{s.format === "sabotage" ? `A common ${len}-letter word they'll have to guess. Make it tricky!` : `Everyone else tries to guess it. ${len} letters.`}</p>
            <input value={pickWord} onChange={(e) => setPickWord(e.target.value.toLowerCase().replace(/[^a-z]/g, "").slice(0, len))} maxLength={len} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={"?".repeat(len)} aria-label="Secret word" data-pick-input />
            <div className="wdRowBtns">
              <button type="submit" className="wdPrimary" disabled={pickWord.length !== len}>
                Pick
              </button>
              {words && (
                <button type="button" onClick={() => setPickWord(words.answers[Math.floor(Math.random() * words.answers.length)])}>
                  Random
                </button>
              )}
            </div>
          </form>
        ) : (
          <div className="wdPickWait">
            <div className="wdHourglass" aria-hidden="true" />
            {view.pick.yours && <p>You picked <b>{view.pick.yours.toUpperCase()}</b>.</p>}
            <p>Waiting for {view.pick.waiting.map(nameOf).join(", ") || "everyone"} to pick a word...</p>
          </div>
        )}
      </div>
    ) : null

  // ---------- between rounds and at the end ----------
  const roundPanel =
    view.phase === "roundOver" && last ? (
      <div className="wdRoundOver" role="status" data-round-over={last.round}>
        <RoundSummary view={view} last={last} teamName={teamName} myTeam={myTeam} />
        <p className="wdMuted">Next round in {Math.max(0, Math.ceil(((view.nextAt || now) - now) / 1000))}s...</p>
      </div>
    ) : null

  const finalPanel =
    view.phase === "over" && view.final ? (
      <div className="wdFinal" role="status" data-final>
        <FinalSummary view={view} teamName={teamName} myTeam={myTeam} nameOf={nameOf} />
        {extra}
        {footer}
      </div>
    ) : null

  // ---------- the boards ----------
  let boardsArea
  if (view.phase === "pick") boardsArea = pickPanel
  else if (mine) {
    boardsArea = (
      <div className="wdBoards" style={{ gridTemplateColumns: `repeat(${L.cols}, auto)` }}>
        {mine.boards.map((b, k) => (
          <Board
            key={`${view.round}:${rushKey}:${k}`}
            rows={b.rows}
            length={len}
            max={mine.max}
            typed={canType || (view.phase === "play" && !mine.done) ? typed : null}
            solvedAt={b.solvedAt}
            shake={shake}
            tile={L.tile}
            active={canType}
            label={mine.boards.length > 1 ? (b.solvedAt !== null ? `✓ in ${b.solvedAt + 1}` : `Board ${k + 1}`) : null}
            testId={`board-${k}`}
          />
        ))}
      </div>
    )
  } else {
    // watching: everyone's boards
    const n = view.sets.length
    const perSet = Math.max(1, ...view.sets.map((set) => set.boards.length))
    const cols = Math.max(1, Math.min(n, area.w > area.h * 1.2 ? 4 : 2))
    const rows = Math.max(6, ...view.sets.map((set) => set.max || set.words + 1))
    const tile = Math.max(9, Math.min(44, Math.floor((area.w - 20) / cols / perSet / (len + 1.2)), Math.floor((area.h - 24) / Math.ceil(n / cols) / (rows + 2))))
    boardsArea = (
      <div className="wdWatch">
        {view.sets.map((set, i) => (
          <div key={i} className="wdWatchSet">
            <b>
              {set.team !== null ? teamName(set.team) : "Everyone"} <span className="wdOppStatus">{statusOf(set)}</span>
            </b>
            <div className="wdWatchBoards">
              {set.boards.map((b, k) => (
                <Board key={`${view.round}:${k}`} rows={b.rows} length={len} max={set.max} solvedAt={b.solvedAt} tile={tile} active={false} />
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  const bottom = finalPanel || roundPanel || (!mine && view.phase === "play" ? null : (
    <>
      {votes}
      <Keyboard states={keyStatesFor()} onKey={onKey} disabled={!canType} enterLabel={voting ? "SUGGEST" : "ENTER"} />
    </>
  ))

  return (
    <div
      className={`wdGame${contrast ? " wd-contrast" : ""}${mobile ? " is-mobile" : ""}`}
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (!/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(e.target.tagName)) rootRef.current?.focus({ preventScroll: true })
      }}
      data-phase={view.phase}
      data-format={s.format}
    >
      {header}
      {scoreChips}
      {strip}
      {turnBar}
      {banner && <div className={`wdBanner${mine?.turnSeat === view.you && mine?.turnSeat !== null ? " is-turn" : ""}`}>{banner}</div>}
      <div className="wdArea" ref={areaRef}>
        {boardsArea}
        {toast && (
          <div className="wdToast" role="alert">
            {toast}
          </div>
        )}
      </div>
      {bottom && <div className="wdBottom">{bottom}</div>}
      {view.phase === "over" && (youWon || (view.final?.reason === "solved" && view.teams.length === 1)) && <Confetti />}
    </div>
  )
}

// "The word was CRANE. Alice took the round."
const RoundSummary = ({ view, last, teamName, myTeam }) => {
  const words = last.answers.map((list) => list.filter(Boolean))
  const same = words.every((w) => w.join() === words[0].join())
  const won = last.winners.includes(myTeam)
  return (
    <div className="wdSummaryBox">
      <div className="wdAnswer">
        {same ? (
          <>
            {words[0].length > 1 ? "The words were " : "The word was "}
            {words[0].map((w, i) => (
              <React.Fragment key={i}>
                {i > 0 && " "}
                <WordLink word={w} />
              </React.Fragment>
            ))}
          </>
        ) : (
          view.sets.map((set, i) => (
            <div key={i}>
              {set.team !== null ? teamName(set.team) : "Everyone"}: <WordLink word={words[i]?.[0]} />
            </div>
          ))
        )}
      </div>
      <p className={won ? "wdWin" : ""}>
        {view.settings.format === "royale"
          ? last.out.length
            ? `${last.out.map(teamName).join(", ")} ${last.out.length === 1 ? "is" : "are"} out!${last.out.includes(myTeam) ? " That's you." : ""}`
            : "Nobody's out this round."
          : last.winners.length
            ? view.teams.length === 1
              ? "Solved!"
              : `${last.winners.map(teamName).join(" and ")} ${last.winners.length > 1 ? "take" : "takes"} the round${won ? " (that's you!)" : ""}.`
            : "Nobody solved it."}
      </p>
    </div>
  )
}

const REASONS = {
  stumped: "Nobody got the word.",
  survived: "You survived every round!",
  eliminated: "Knocked out.",
  "last standing": "Last one standing.",
  series: "Won the series.",
  rush: "Most words solved.",
  points: "Most points.",
  solved: "Solved!",
}

const FinalSummary = ({ view, teamName, myTeam, nameOf }) => {
  const f = view.final
  const s = view.settings
  const winners = f.winners || []
  const youWon = winners.includes(view.you)
  const solo = view.teams.length === 1 && view.setter === null
  let headline
  if (solo) headline = youWon ? (s.format === "rush" ? "Time!" : s.format === "royale" ? "You survived!" : "Solved!") : f.reason === "stumped" && view.setter !== null ? "Nobody got it!" : "So close!"
  else if (!winners.length) headline = view.teams.every((t) => t.points === 0) ? "Nobody got it!" : "It's a tie!"
  else if (youWon) headline = winners.length > 1 && view.teams.length > 1 ? "Your team wins!" : "You win!"
  else headline = `${[...new Set(winners)].map(nameOf).join(" & ")} ${winners.length > 1 ? "win" : "wins"}!`
  if (view.setter !== null && f.reason === "stumped") headline = view.you === view.setter ? "You stumped them!" : `${nameOf(view.setter)} stumped everyone!`
  const rank = view.teams.map((t, i) => ({ ...t, i })).sort((a, b) => (s.format === "royale" ? b.alive - a.alive : 0) || (s.series === "wins" ? b.wins - a.wins : 0) || b.points - a.points)
  const allWords = view.history.flatMap((h) => h.answers.flat()).filter(Boolean)
  const mineSet = view.mine >= 0 ? view.sets[view.mine] : null
  return (
    <div className="wdSummaryBox">
      <h3 className={youWon ? "wdWin" : ""} data-headline>
        {headline}
      </h3>
      {solo && s.format === "rush" && mineSet?.rush && (
        <p>
          You solved <b>{mineSet.rush.solved}</b> word{mineSet.rush.solved === 1 ? "" : "s"}
          {mineSet.rush.failed ? ` (missed ${mineSet.rush.failed})` : ""}.
        </p>
      )}
      {!solo && winners.length > 0 && <p className="wdMuted">{REASONS[f.reason] || ""}</p>}
      {!solo && (
        <table className="wdTable">
          <tbody>
            {rank.map((t) => (
              <tr key={t.i} className={t.i === myTeam ? "is-you" : ""}>
                <td>{teamName(t.i)}</td>
                {s.series === "wins" && s.format !== "royale" && <td>{t.wins} won</td>}
                <td>{s.format === "royale" ? (t.alive ? "winner" : "out") : `${t.points} pt${t.points === 1 ? "" : "s"}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {allWords.length > 0 && (
        <p className="wdWords">
          {allWords.length > 1 ? "Words: " : "The word: "}
          {[...new Set(allWords)].slice(-16).map((w, i) => (
            <React.Fragment key={w}>
              {i > 0 && " "}
              <WordLink word={w} />
            </React.Fragment>
          ))}
        </p>
      )}
      {mineSet && solo && !mineSet.rush && mineSet.timeMs !== null && mineSet.solved && <p className="wdMuted">Time: {fmtTime(mineSet.timeMs)}</p>}
    </div>
  )
}

export default GameScreen
