import React, { useEffect, useRef, useState } from "react"

// Imposter's game screens. OnlineTable: one person per phone, your own view from the
// server. LocalTable: pass-and-play on one phone, with "Pass the phone to ..." screens
// before anything private (your card, a secret vote, the imposter's guess).

const OUTCOME = {
  crew: "The crew caught the imposter!",
  imposters: "The imposter got away!",
  stolen: "The imposter named the word and stole the round!",
  "none-win": "There was no imposter, and you knew it!",
  "none-lose": "There was no imposter! Someone got voted out for nothing.",
}

export const Countdown = ({ deadline, now = Date.now, onTick }) => {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!deadline) return
    const id = setInterval(() => setTick((t) => t + 1), 250)
    return () => clearInterval(id)
  }, [deadline])
  const left = deadline ? Math.max(0, Math.ceil((deadline - now()) / 1000)) : null
  useEffect(() => {
    if (left != null && left <= 5 && left > 0) onTick?.(left)
  }, [left])
  if (left == null) return null
  return (
    <span className={`ipClock${left <= 5 ? " is-low" : ""}`} role="timer" aria-label={`${left} seconds left`}>
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
    </span>
  )
}

// The secret card
export const CardFace = ({ card, partners, names }) => {
  if (!card) return <div className="ipCard is-blank">Watching</div>
  const imp = card.role === "imposter"
  return (
    <div className={`ipCard${imp ? " is-imposter" : ""}`} data-card={card.role}>
      <div className="ipCardBar">{imp ? "IMPOSTER" : "SECRET WORD"}</div>
      <div className="ipCardBody">
        {imp ? (
          <>
            <b className="ipCardBig">You're the imposter!</b>
            {card.word ? (
              <p>
                Your close word: <b data-word>{card.word}</b>
              </p>
            ) : (
              <p>Blend in. Listen to the clues and work out the word.</p>
            )}
            {card.hint && (
              <p>
                Hint: <b>{card.hint}</b>
              </p>
            )}
          </>
        ) : (
          <b className="ipCardBig" data-word>
            {card.word}
          </b>
        )}
        {card.category && <p className="ipCardCat">Category: {card.category}</p>}
        {partners?.length > 0 && <p className="ipCardCat">Fellow imposter{partners.length > 1 ? "s" : ""}: {partners.map((i) => names[i]).join(", ")}</p>}
        {!imp && <p className="ipMuted ipCardTip">Give a clue that shows you know it, without giving it away.</p>}
      </div>
    </div>
  )
}

const ClueList = ({ view, names }) => {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [view.clues.length])
  const shown = view.clues.filter((c) => c.text)
  if (!shown.length) return null
  return (
    <div className="ipClues" ref={ref} data-selectable aria-label="Clues">
      {shown.map((c, i) => (
        <div key={i} className="ipClue">
          <b>{names[c.seat]}</b>
          <span>{c.text}</span>
        </div>
      ))}
    </div>
  )
}

const Scores = ({ view, you, compact = false }) => {
  if (!view.settings.scoring) return null
  const list = view.players.filter((p) => !p.left).sort((a, b) => b.score - a.score)
  return (
    <div className={`ipScores${compact ? " is-compact" : ""}`} aria-label="Scores">
      {list.map((p) => (
        <span key={p.seat} className={p.seat === you ? "is-you" : ""}>
          {p.name} <b>{p.score}</b>
          {view.result?.points?.[p.seat] ? <i>+{view.result.points[p.seat]}</i> : null}
        </span>
      ))}
    </div>
  )
}

// Who to vote for: everyone still in (or the tied players on a revote), maybe "No one"
const VotePicker = ({ view, voter, onVote, chosen }) => {
  const s = view.settings
  const people = (view.candidates || view.players.filter((p) => !p.left && !p.out).map((p) => p.seat)).filter((i) => s.voteStyle === "group" || i !== voter)
  return (
    <div className="ipVotes" role="group" aria-label="Vote">
      {people.map((i) => (
        <button key={i} type="button" className={chosen === i ? "is-on" : ""} onClick={() => onVote(i)} data-vote={i}>
          {view.players[i].name}
          {s.voteStyle === "open" && <small>{Object.values(view.votes).filter((t) => t === i).length || ""}</small>}
        </button>
      ))}
      {s.allowSkip && !view.candidates && (
        <button type="button" className={`ipSkip${chosen === -1 ? " is-on" : ""}`} onClick={() => onVote(-1)} data-vote="-1">
          {view.imposterCount === null || s.zeroChance ? "No imposter / skip" : "Skip"}
        </button>
      )}
    </div>
  )
}

const GuessPicker = ({ view, onGuess }) => {
  const [text, setText] = useState("")
  if (view.choices) {
    return (
      <div className="ipVotes" role="group" aria-label="Guess the word">
        {view.choices.map((w) => (
          <button key={w} type="button" onClick={() => onGuess(w)} data-guess={w}>
            {w}
          </button>
        ))}
      </div>
    )
  }
  return (
    <form className="ipRow" onSubmit={(e) => (e.preventDefault(), text.trim() && onGuess(text))}>
      <input type="text" value={text} maxLength={40} onChange={(e) => setText(e.target.value)} placeholder="The secret word is..." aria-label="Your guess" autoFocus data-guess-input />
      <button type="submit" className="ipPrimary" disabled={!text.trim()}>
        Guess
      </button>
    </form>
  )
}

const ClueInput = ({ onSend }) => {
  const [text, setText] = useState("")
  return (
    <form className="ipRow" onSubmit={(e) => (e.preventDefault(), onSend(text).then((r) => r?.ok && setText("")))}>
      <input type="text" value={text} maxLength={40} onChange={(e) => setText(e.target.value)} placeholder="Your clue (one word is best)" aria-label="Your clue" autoFocus data-clue-input />
      <button type="submit" className="ipPrimary" disabled={!text.trim()} data-send-clue>
        Send
      </button>
    </form>
  )
}

export const Result = ({ view, you }) => {
  const r = view.result
  if (!r) return null
  const names = view.players.map((p) => p.name)
  const list = (seats) => seats.map((i) => names[i]).join(", ")
  return (
    <div className={`ipResult is-${r.outcome}`} data-outcome={r.outcome}>
      <b className="ipResultHead">{OUTCOME[r.outcome]}</b>
      <p>
        The word was <b data-result-word>{r.word}</b>
        {r.category && r.category !== "Custom words" ? ` (${r.category})` : ""}.
      </p>
      {r.rolesHidden ? (
        <p>The imposter's identity stays a secret{r.imposters.includes(you) ? " (it was you!)" : ""}.</p>
      ) : r.imposters.length ? (
        <p>
          Imposter{r.imposters.length > 1 ? "s" : ""}: <b>{list(r.imposters)}</b>
        </p>
      ) : null}
      {r.imposterLeft && <p>The imposter left the game.</p>}
      {!r.early && !r.imposterLeft && <p>{r.ejected.length ? `Voted out: ${list(r.ejected)}.` : "Nobody was voted out."}</p>}
      {r.guessWord && (
        <p>
          {r.early ? `${names[r.guessedBy]} guessed early: ` : "The imposter guessed "}"{r.guessWord}": {r.guessRight ? "right!" : "wrong."}
        </p>
      )}
      {view.votes && Object.keys(view.votes).length > 0 && !view.result?.early && (
        <details className="ipVoteLog">
          <summary>Who voted for whom</summary>
          {Object.entries(view.votes).map(([v, t]) => (
            <div key={v}>
              {names[v]} → {t === -1 ? "No one" : names[t]}
            </div>
          ))}
        </details>
      )}
    </div>
  )
}

const phaseTitle = (view, names) => {
  switch (view.phase) {
    case "reveal":
      return "Look at your card"
    case "clues":
      return `Clue round ${Math.min(view.clueRound, view.settings.clueRounds)} of ${view.settings.clueRounds}${view.cycle > 1 ? ` (vote ${view.cycle})` : ""}: ${names[view.speaker]}'s turn`
    case "discuss":
      return "Talk it over: who's the imposter?"
    case "vote":
      return view.candidates ? "It's a tie! Vote again between them" : "Vote: who's the imposter?"
    case "guess":
      return `Caught! ${view.guessers.map((i) => names[i]).join(", ")} can still steal it by naming the word`
    case "result":
      return `Round ${view.roundNo} is over`
    case "over":
      return "Game over"
    default:
      return ""
  }
}

const Header = ({ view, names, now }) => (
  <div className="ipHead">
    <span className="ipRound">Round {view.roundNo}</span>
    <b className="ipPhase" data-phase={view.phase}>
      {phaseTitle(view, names)}
    </b>
    <Countdown deadline={view.deadline} now={now} />
  </div>
)

// ---------- online: each player on their own phone ----------

export const OnlineTable = ({ view, act, now, footer, sounds }) => {
  const [showCard, setShowCard] = useState(false)
  const [error, setError] = useState(null)
  const names = view.players.map((p) => p.name)
  const you = view.you
  const me = you == null ? null : view.players[you]
  const inRound = me && !me.left && !me.out
  const send = async (a) => {
    setError(null)
    const r = await act(a)
    if (r && !r.ok && r.error) setError(r.error)
    return r
  }
  const lastPhase = useRef(null)
  useEffect(() => {
    if (lastPhase.current === view.phase && view.phase !== "clues") return
    lastPhase.current = view.phase
    if (view.phase === "clues" && view.speaker === you) sounds?.turn()
    if (view.phase === "result") view.result?.outcome === "crew" || view.result?.outcome === "none-win" ? sounds?.crew() : sounds?.imposter()
    if (view.phase === "vote") sounds?.vote()
  }, [view.phase, view.speaker, view.roundNo])
  useEffect(() => setShowCard(false), [view.phase])

  const s = view.settings
  let main = null
  if (view.phase === "reveal") {
    main = (
      <div className="ipStage">
        <CardFace card={view.card} partners={view.partners} names={names} />
        {view.card && (
          <button type="button" className="ipBig ipPrimary" disabled={me?.acked} onClick={() => (sounds?.flip(), send({ type: "ack" }))} data-ack>
            {me?.acked ? "Waiting for the others..." : "Got it"}
          </button>
        )}
        <p className="ipMuted">{view.players.filter((p) => !p.left && !p.acked).map((p) => p.name).join(", ") || "Everyone's ready"} still looking.</p>
      </div>
    )
  } else if (view.phase === "clues") {
    const mine = view.speaker === you
    main = (
      <div className="ipStage">
        <div className="ipOrder" aria-label="Speaking order">
          {view.order.map((i) => (
            <span key={i} className={i === view.speaker ? "is-on" : ""}>
              {names[i]}
            </span>
          ))}
        </div>
        {mine ? (
          s.clueMode === "typed" ? (
            <ClueInput onSend={(text) => send({ type: "clue", text })} />
          ) : (
            <button type="button" className="ipBig ipPrimary" onClick={() => send({ type: "clue" })} data-clue-done>
              I've said my clue
            </button>
          )
        ) : (
          <p className="ipWait">{s.clueMode === "typed" ? `${names[view.speaker]} is typing a clue...` : `Listen to ${names[view.speaker]}'s clue.`}</p>
        )}
        <ClueList view={view} names={names} />
      </div>
    )
  } else if (view.phase === "discuss") {
    main = (
      <div className="ipStage">
        <ClueList view={view} names={names} />
        {inRound && (
          <button type="button" className={`ipBig${me.ready ? "" : " ipPrimary"}`} onClick={() => send({ type: "ready" })} data-ready>
            {me.ready ? "Not ready yet" : "Ready to vote"}
          </button>
        )}
        <p className="ipMuted">
          Ready: {view.players.filter((p) => p.ready).length} of {view.players.filter((p) => !p.left && !p.out).length}
        </p>
      </div>
    )
  } else if (view.phase === "vote") {
    const chosen = view.votes[you]
    main = (
      <div className="ipStage">
        {inRound || s.voteStyle === "group" ? (
          <>
            <p className="ipMuted">{s.voteStyle === "group" ? "Agree out loud, then anyone taps the pick." : chosen !== undefined ? "Voted. Tap another name to change it." : "Tap who you think it is."}</p>
            <VotePicker view={view} voter={you} chosen={chosen} onVote={(target) => send({ type: "vote", target })} />
          </>
        ) : (
          <p className="ipWait">You're out of this round: watch the vote.</p>
        )}
        <p className="ipMuted">
          Voted: {view.players.filter((p) => p.voted).length} of {view.players.filter((p) => !p.left && !p.out).length}
        </p>
        <ClueList view={view} names={names} />
      </div>
    )
  } else if (view.phase === "guess") {
    main = (
      <div className="ipStage">
        {view.choices || view.guessers.includes(you) ? (
          <>
            <b>You were caught! Name the word to steal the win:</b>
            <GuessPicker view={view} onGuess={(word) => send({ type: "guess", word })} />
          </>
        ) : (
          <p className="ipWait">Waiting for the imposter's guess...</p>
        )}
        <ClueList view={view} names={names} />
      </div>
    )
  } else if (view.phase === "result" || view.phase === "over") {
    main = (
      <div className="ipStage">
        <Result view={view} you={you} />
        <Scores view={view} you={you} />
        {view.phase === "result" && (
          <div className="ipRow">
            <button type="button" className="ipBig ipPrimary" onClick={() => send({ type: "next" })} data-next>
              {view.gameDone ? "See final scores" : "Next round"}
            </button>
            {!view.gameDone && (
              <button type="button" onClick={() => send({ type: "end" })} data-end>
                End game
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  const canGuessNow = s.guessWhen === "anytime" && view.card?.role === "imposter" && inRound && ["clues", "discuss", "vote"].includes(view.phase)
  return (
    <div className="ipTable" data-mode="online">
      <Header view={view} names={names} now={now} />
      <div className="ipScroll">{main}</div>
      {view.phase !== "reveal" && view.phase !== "result" && view.phase !== "over" && view.card && (
        <div className="ipPeek">
          {showCard && <CardFace card={view.card} partners={view.partners} names={names} />}
          <div className="ipRow">
            <button type="button" onClick={() => setShowCard(!showCard)} data-peek>
              {showCard ? "Hide my card" : "Show my card"}
            </button>
            {canGuessNow && <GuessNow view={view} onGuess={(word) => send({ type: "guess", word })} />}
          </div>
        </div>
      )}
      {error && (
        <p className="ipError" role="alert">
          {error}
        </p>
      )}
      {footer}
    </div>
  )
}

const GuessNow = ({ view, onGuess }) => {
  const [open, setOpen] = useState(false)
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} data-guess-now>
        I know the word!
      </button>
    )
  return (
    <div className="ipGuessNow">
      <GuessPicker view={{ ...view, choices: null }} onGuess={onGuess} />
      <button type="button" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  )
}

// ---------- pass-and-play on one phone ----------

// "Pass the phone to Ann" -> Ann taps -> her private screen
const PassGate = ({ name, why, onOpen }) => (
  <div className="ipStage ipPass" data-pass={name}>
    <div className="ipPassIcon" aria-hidden="true">
      📱
    </div>
    <b className="ipBigText">Pass the phone to {name}</b>
    <p className="ipMuted">{why}</p>
    <button type="button" className="ipBig ipPrimary" onClick={onOpen} data-open>
      I'm {name}: {why === "to see their card" ? "show my card" : "go"}
    </button>
  </div>
)

export const LocalTable = ({ game, sounds, onAgain, onSetup }) => {
  const pub = game.view(null)
  const names = pub.players.map((p) => p.name)
  const [open, setOpen] = useState(null) // the seat looking at their private screen
  const [error, setError] = useState(null)
  const [guesser, setGuesser] = useState(null) // anytime guess: who's trying
  const s = pub.settings
  const act = (a, seat) => {
    const r = game.act(a, seat)
    setError(r.ok ? null : r.error)
    return Promise.resolve(r)
  }
  useEffect(() => {
    setOpen(null)
    setGuesser(null)
    if (pub.phase === "result") pub.result?.outcome === "crew" || pub.result?.outcome === "none-win" ? sounds?.crew() : sounds?.imposter()
    if (pub.phase === "vote") sounds?.vote()
  }, [pub.phase, pub.roundNo, pub.cycle, pub.candidates?.join()])

  const inRound = pub.players.filter((p) => !p.left && !p.out).map((p) => p.seat)
  let main = null

  if (guesser != null) {
    const v = game.view(guesser)
    main =
      open === guesser ? (
        <div className="ipStage">
          <b>{names[guesser]}: name the secret word. Wrong, and the crew wins the round!</b>
          <GuessPicker view={{ ...v, choices: null }} onGuess={(word) => act({ type: "guess", word }, guesser)} />
          <button type="button" onClick={() => (setGuesser(null), setOpen(null))}>
            Cancel
          </button>
        </div>
      ) : (
        <PassGate name={names[guesser]} why="to guess the word" onOpen={() => setOpen(guesser)} />
      )
  } else if (pub.phase === "reveal") {
    const next = pub.players.find((p) => !p.left && !p.acked)
    if (next) {
      const v = game.view(next.seat)
      main =
        open === next.seat ? (
          <div className="ipStage">
            <CardFace card={v.card} partners={v.partners} names={names} />
            <button type="button" className="ipBig ipPrimary" onClick={() => (setOpen(null), act({ type: "ack" }, next.seat))} data-hide>
              Hide it and pass the phone on
            </button>
          </div>
        ) : (
          <PassGate name={next.name} why="to see their card" onOpen={() => (sounds?.flip(), setOpen(next.seat))} />
        )
    }
  } else if (pub.phase === "clues") {
    main = (
      <div className="ipStage">
        <div className="ipOrder">
          {pub.order.map((i) => (
            <span key={i} className={i === pub.speaker ? "is-on" : ""}>
              {names[i]}
            </span>
          ))}
        </div>
        <b className="ipBigText">{names[pub.speaker]}, {s.clueMode === "typed" ? "type" : "say"} your clue</b>
        {s.clueMode === "typed" ? (
          <ClueInput key={`${pub.speaker}:${pub.clues.length}`} onSend={(text) => act({ type: "clue", text }, pub.speaker)} />
        ) : (
          <button type="button" className="ipBig ipPrimary" onClick={() => act({ type: "clue" }, pub.speaker)} data-clue-done>
            Done: next player
          </button>
        )}
        <ClueList view={pub} names={names} />
      </div>
    )
  } else if (pub.phase === "discuss") {
    main = (
      <div className="ipStage">
        <b className="ipBigText">Talk it over!</b>
        <p className="ipMuted">Who gave a clue that didn't quite fit?</p>
        <button
          type="button"
          className="ipBig ipPrimary"
          onClick={() => {
            const fresh = game.view(null)
            for (const p of fresh.players) if (!p.left && !p.out && !p.ready) game.act({ type: "ready" }, p.seat)
          }}
          data-vote-now
        >
          We're ready to vote
        </button>
        <ClueList view={pub} names={names} />
      </div>
    )
  } else if (pub.phase === "vote") {
    if (s.voteStyle === "group") {
      main = (
        <div className="ipStage">
          <p className="ipMuted">Agree out loud, then tap your pick.</p>
          <VotePicker view={pub} voter={null} onVote={(target) => act({ type: "vote", target }, inRound[0])} />
          <ClueList view={pub} names={names} />
        </div>
      )
    } else {
      const next = inRound.find((i) => !pub.players[i].voted)
      main =
        next == null ? null : open === next ? (
          <div className="ipStage">
            <b>{names[next]}, who's the imposter?</b>
            <VotePicker view={game.view(next)} voter={next} onVote={(target) => (setOpen(null), act({ type: "vote", target }, next))} />
          </div>
        ) : (
          <PassGate name={names[next]} why="to vote in secret" onOpen={() => setOpen(next)} />
        )
    }
  } else if (pub.phase === "guess") {
    const g = pub.guessers.find((i) => !pub.guesses.includes(i))
    const v = game.view(g)
    main =
      open === g ? (
        <div className="ipStage">
          <b>{names[g]}, name the word to steal the win:</b>
          <GuessPicker view={v} onGuess={(word) => act({ type: "guess", word }, g)} />
        </div>
      ) : (
        <PassGate name={names[g]} why="to guess the word" onOpen={() => setOpen(g)} />
      )
  } else if (pub.phase === "result") {
    main = (
      <div className="ipStage">
        <Result view={pub} you={null} />
        <Scores view={pub} you={null} />
        <div className="ipRow">
          <button type="button" className="ipBig ipPrimary" onClick={() => act({ type: "next" }, inRound[0] ?? 0)} data-next>
            {pub.gameDone ? "See final scores" : "Next round"}
          </button>
          {!pub.gameDone && (
            <button type="button" onClick={() => act({ type: "end" }, 0)} data-end>
              End game
            </button>
          )}
        </div>
      </div>
    )
  } else if (pub.phase === "over") {
    const w = pub.over?.winners || []
    main = (
      <div className="ipStage">
        <b className="ipBigText" data-final>
          {s.scoring ? (w.length === 1 ? `${names[w[0]]} wins!` : w.length ? `A tie: ${w.map((i) => names[i]).join(", ")}` : "Game over") : "Thanks for playing!"}
        </b>
        <Scores view={pub} you={null} />
        <div className="ipRow">
          <button type="button" className="ipBig ipPrimary" onClick={onAgain} data-again>
            Play again
          </button>
          <button type="button" onClick={onSetup}>
            Change players or rules
          </button>
        </div>
      </div>
    )
  }

  const anytime = s.guessWhen === "anytime" && s.imposterInfo !== "undercover" && ["clues", "discuss", "vote"].includes(pub.phase) && guesser == null && open == null
  return (
    <div className="ipTable" data-mode="local">
      <Header view={pub} names={names} now={Date.now} />
      <div className="ipScroll">{main}</div>
      {anytime && (
        <div className="ipPeek">
          <label className="ipField ipInline">
            <span>Imposter, know the word?</span>
            <select value="" onChange={(e) => e.target.value !== "" && setGuesser(Number(e.target.value))} data-guess-who>
              <option value="">Guess as...</option>
              {inRound.map((i) => (
                <option key={i} value={i}>
                  {names[i]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {error && (
        <p className="ipError" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
