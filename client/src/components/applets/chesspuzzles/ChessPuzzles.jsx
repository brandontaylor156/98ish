import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import MoreOptions from "../../shared/MoreOptions"
import { helpItem } from "../../../utils/help"
import PuzzleBoard from "./PuzzleBoard"
import * as P from "./puzzleCore"
import "../network/games/BoardGames.css"
import "./ChessPuzzles.css"

// Chess Puzzles, the way the Lichess / Chess.com trainers work: the opponent's move plays,
// then you find the best reply. Rated puzzles near your puzzle rating (it rises and falls),
// Puzzle Streak (one mistake ends it, harder each time), Puzzle Rush (3 or 5 minutes, or
// survival; three strikes), the Daily Puzzle, themes, hints and your history. 4,000+
// puzzles from the Lichess puzzle database (CC0), bundled and loaded in rating bands.

const KEY = "98ish.chesspuzzles"
const SHARDS = [() => import("./puzzles/band0.js"), () => import("./puzzles/band1.js"), () => import("./puzzles/band2.js"), () => import("./puzzles/band3.js"), () => import("./puzzles/band4.js")]
const RUSH = { 3: { label: "Puzzle Rush: 3 minutes", ms: 180_000 }, 5: { label: "Puzzle Rush: 5 minutes", ms: 300_000 }, survival: { label: "Puzzle Rush: Survival", ms: 0 } }
const MODE_LABEL = { rated: "Puzzles", streak: "Puzzle Streak", rush: "Puzzle Rush", daily: "Daily Puzzle", replay: "Replay" }

const blank = () => ({ ...P.START_RATING, played: 0, wins: 0, history: [], seen: [], streakBest: 0, rush: { 3: 0, 5: 0, survival: 0 }, daily: null, theme: "", flip: false })
const load = () => {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "{}")
    return { ...blank(), ...d, rush: { ...blank().rush, ...(d.rush || {}) } }
  } catch {
    return blank()
  }
}
const save = (d) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(d))
  } catch {
    // private window: lasts for this visit
  }
  return d
}
const today = () => new Date().toDateString()
const colorName = (c) => (c === "w" ? "White" : "Black")

// The bundled puzzles, loaded band by band (the band for your rating first)
const usePuzzles = (rating) => {
  const [all, setAll] = useState([])
  const [loaded, setLoaded] = useState(0)
  useEffect(() => {
    let live = true
    const first = P.bandFor(rating)
    const order = [first, ...SHARDS.map((_, i) => i).filter((i) => i !== first)]
    ;(async () => {
      for (const i of order) {
        const mod = await SHARDS[i]()
        if (!live) return
        const list = P.parseShard(mod.default)
        setAll((a) => [...a, ...list])
        setLoaded((n) => n + 1)
      }
    })().catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return { all, ready: loaded > 0, complete: loaded === SHARDS.length }
}

const HowTo = ({ onClose }) => (
  <Dialog title="How Chess Puzzles Work" onOk={onClose} onCancel={onClose}>
    <div className="cpHow">
      <p>Each puzzle starts with your opponent's move. Then find the best move: tap a piece and its square, or drag it. Keep going until the puzzle is solved; the computer answers each right move.</p>
      <ul>
        <li>
          <b>Puzzles</b>: rated. Solve it without a mistake and your rating goes up; a wrong move costs points. A hint means a solve doesn't raise your rating.
        </li>
        <li>
          <b>Puzzle Streak</b>: they get harder each time. One mistake ends the streak (you may skip one puzzle).
        </li>
        <li>
          <b>Puzzle Rush</b>: as many as you can in 3 or 5 minutes, or with no clock in Survival. Three wrong moves and it's over.
        </li>
        <li>
          <b>Daily Puzzle</b>: the same puzzle for everyone today.
        </li>
      </ul>
      <p className="cpMuted">Any move that checkmates counts. Puzzles come from the Lichess puzzle database (lichess.org, released into the public domain, CC0).</p>
    </div>
  </Dialog>
)

const HistoryDialog = ({ history, onReplay, onClose }) => (
  <Dialog title="Puzzle History" onOk={onClose} onCancel={onClose}>
    <div className="cpHistory" data-selectable>
      {history.length === 0 ? (
        <p>No puzzles yet.</p>
      ) : (
        <table>
          <tbody>
            {[...history].reverse().map((h, i) => (
              <tr key={i} className={h.win ? "is-win" : "is-loss"}>
                <td>{h.win ? "✔" : "✘"}</td>
                <td>{h.rating}</td>
                <td>{MODE_LABEL[h.mode] || h.mode}</td>
                <td>{h.delta ? (h.delta > 0 ? `+${h.delta}` : h.delta) : h.hint ? "hint" : ""}</td>
                <td>
                  <button type="button" onClick={() => onReplay(h.id)}>
                    Replay
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  </Dialog>
)

const ChessPuzzles = ({ mobile = false, onClose }) => {
  const [data, setData] = useState(load)
  const update = (fn) => setData((d) => save(fn(d)))
  const { all, ready, complete } = usePuzzles(data.rating)
  const [mode, setMode] = useState("rated")
  const [st, setSt] = useState(null) // the puzzle being played (puzzleCore state)
  const [result, setResult] = useState(null) // { win, delta } once decided
  const [hintLevel, setHintLevel] = useState(0)
  const [wrong, setWrong] = useState(null) // a wrong move's position, shown briefly
  const [slide, setSlide] = useState(null)
  const [message, setMessage] = useState(null)
  const [streak, setStreak] = useState({ n: 0, skipped: false, over: false })
  const [rush, setRush] = useState(null) // { kind, score, strikes, endsAt, over }
  const [dialog, setDialog] = useState(null)
  const [, tick] = useState(0)
  const [size, setSize] = useState(320)
  const areaRef = useRef(null)
  const sessionSeen = useRef(new Set())
  const timers = useRef([])
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms))
  const clearLater = () => (timers.current.forEach(clearTimeout), (timers.current = []))
  useEffect(() => clearLater, [])

  // the board fills the space it has, in whole pixels per square
  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const measure = () => setSize(Math.max(160, Math.floor(Math.min(el.clientWidth - 22, el.clientHeight - 22) / 8) * 8))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const begin = (p, nextMode = mode) => {
    clearLater()
    if (!p) return setMessage("No puzzles match. Try another theme.")
    sessionSeen.current.add(p.id)
    setSt(P.startPuzzle(p))
    setResult(null)
    setHintLevel(0)
    setWrong(null)
    setSlide(null)
    setMessage(null)
    setMode(nextMode)
  }

  const pickRated = (d = data) => P.choosePuzzle(all, { target: d.rating, theme: d.theme || null, exclude: new Set([...d.seen, ...sessionSeen.current]) })
  const pickStreak = (n) => P.choosePuzzle(all, { target: P.streakTarget(n), exclude: sessionSeen.current, above: true })
  const pickRush = (k) => P.choosePuzzle(all, { target: P.rushTarget(k), exclude: sessionSeen.current, above: true })

  // first puzzle once the first band is in
  useEffect(() => {
    if (ready && !st) begin(pickRated())
  }, [ready])

  // the opponent's moves play themselves, with a slide
  useEffect(() => {
    if (!st) return
    if (st.status === "setup" || st.status === "reply") {
      later(
        () =>
          setSt((s) => {
            if (s !== st) return s
            const next = s.status === "setup" ? P.playSetup(s) : P.playReply(s)
            setSlide({ ...next.game.last, key: `${s.puzzle.id}:${next.ply}` })
            return next
          }),
        st.status === "setup" ? 550 : 380
      )
    } else if (st.status === "showing") {
      later(() => {
        setSt((s) => {
          if (s !== st) return s
          const next = P.stepSolution(s)
          setSlide({ ...next.game.last, key: `${s.puzzle.id}:${next.ply}` })
          return next
        })
      }, 650)
    }
  }, [st])

  // Puzzle Rush clock
  useEffect(() => {
    if (!rush || rush.over || !rush.endsAt) return
    const id = setInterval(() => {
      tick((t) => t + 1)
      if (Date.now() >= rush.endsAt) endRush()
    }, 250)
    return () => clearInterval(id)
  }, [rush?.endsAt, rush?.over])

  const record = (entry) =>
    update((d) => ({
      ...d,
      history: [...d.history, { at: Date.now(), ...entry }].slice(-150),
      seen: [...d.seen, entry.id].slice(-2500),
    }))

  // the rated result (first mistake, or a clean solve)
  const settleRated = (win) => {
    if (result) return
    const p = st.puzzle
    if (mode === "rated") {
      if (win && hintLevel > 0) {
        setResult({ win: true, delta: 0 })
        record({ id: p.id, rating: p.rating, win: true, mode, hint: true, delta: 0 })
        update((d) => ({ ...d, played: d.played + 1, wins: d.wins + 1 }))
        return
      }
      const next = P.rate(data, p.rating, win)
      setResult({ win, delta: next.delta })
      record({ id: p.id, rating: p.rating, win, mode, delta: next.delta })
      update((d) => ({ ...d, rating: next.rating, rd: next.rd, played: d.played + 1, wins: d.wins + (win ? 1 : 0) }))
    } else {
      setResult({ win, delta: 0 })
      record({ id: p.id, rating: p.rating, win, mode })
      if (mode === "daily") update((d) => ({ ...d, daily: { date: today(), id: p.id, win } }))
    }
  }

  const endRush = () => {
    setRush((r) => {
      if (!r || r.over) return r
      update((d) => ({ ...d, rush: { ...d.rush, [r.kind]: Math.max(d.rush[r.kind] || 0, r.score) } }))
      return { ...r, over: true }
    })
  }

  const onMove = (move) => {
    if (!st || st.status !== "play") return
    const r = P.tryMove(st, move)
    if (!r.ok) return
    if (!r.correct) {
      setWrong(r.wrong)
      later(() => setWrong(null), 650)
      if (mode === "rush") {
        const strikes = rush.strikes + 1
        setRush((x) => ({ ...x, strikes }))
        setMessage("Wrong!")
        record({ id: st.puzzle.id, rating: st.puzzle.rating, win: false, mode })
        if (strikes >= 3) later(endRush, 700)
        else later(() => begin(pickRush(rush.score + strikes), "rush"), 700)
        setSt({ ...r.state, status: "done" })
        return
      }
      if (mode === "streak") {
        setStreak((s) => ({ ...s, over: true }))
        update((d) => ({ ...d, streakBest: Math.max(d.streakBest, streak.n) }))
        record({ id: st.puzzle.id, rating: st.puzzle.rating, win: false, mode })
        setResult({ win: false, delta: 0 })
        setSt({ ...r.state, status: "done" })
        setMessage(`Streak over: ${streak.n} solved.`)
        return
      }
      setSt(r.state)
      if (mode !== "replay") settleRated(false)
      setMessage("That's not it. Try another move, or see the solution.")
      return
    }
    setSlide(null)
    setSt(r.state)
    if (r.state.status === "solved") {
      if (mode === "rush") {
        setRush((x) => ({ ...x, score: x.score + 1 }))
        setMessage("Solved!")
        record({ id: st.puzzle.id, rating: st.puzzle.rating, win: true, mode })
        later(() => begin(pickRush(rush.score + 1 + rush.strikes), "rush"), 350)
      } else if (mode === "streak") {
        const n = streak.n + 1
        setStreak((s) => ({ ...s, n }))
        update((d) => ({ ...d, streakBest: Math.max(d.streakBest, n) }))
        record({ id: st.puzzle.id, rating: st.puzzle.rating, win: true, mode })
        setMessage(`Solved! Streak: ${n}`)
        later(() => begin(pickStreak(n), "streak"), 700)
      } else {
        if (!st.failed && mode !== "replay") settleRated(true)
        setMessage(st.failed ? "Solved, after a slip." : "Solved!")
      }
    } else setMessage("Best move! Keep going.")
  }

  const startStreak = () => {
    sessionSeen.current = new Set()
    setRush(null)
    setStreak({ n: 0, skipped: false, over: false })
    begin(pickStreak(0), "streak")
  }
  const startRush = (kind) => {
    sessionSeen.current = new Set()
    setStreak({ n: 0, skipped: false, over: false })
    setRush({ kind, score: 0, strikes: 0, endsAt: RUSH[kind].ms ? Date.now() + RUSH[kind].ms : null, over: false })
    begin(pickRush(0), "rush")
  }
  const startRated = (d = data) => {
    setRush(null)
    begin(pickRated(d), "rated")
  }
  const startDaily = () => {
    setRush(null)
    begin(P.dailyPuzzle(all), "daily")
  }
  const replay = (id) => {
    setDialog(null)
    setRush(null)
    begin(all.find((p) => p.id === id), "replay")
  }
  const showSolution = () => {
    if (!st) return
    if (mode === "rated" || mode === "daily") settleRated(false)
    clearLater()
    setWrong(null)
    setSt({ ...P.retry(st), status: "showing" })
    setMessage("The solution:")
  }
  const retry = () => {
    clearLater()
    setWrong(null)
    setSlide(null)
    setSt(P.retry(st))
    setMessage("Try again.")
  }
  const showHint = () => setHintLevel((h) => Math.min(2, h + 1))
  const skip = () => {
    setStreak((s) => ({ ...s, skipped: true }))
    record({ id: st.puzzle.id, rating: st.puzzle.rating, win: false, mode, skipped: true })
    begin(pickStreak(streak.n), "streak")
  }

  const setTheme = (theme) => {
    const d = { ...data, theme }
    update(() => d)
    if (mode === "rated" || mode === "replay") startRated(d)
  }

  const yourTurn = st?.status === "play" && !wrong && !(rush?.over) && !(mode === "streak" && streak.over)
  const done = st && (st.status === "solved" || st.status === "shown" || st.status === "done")
  const hint = yourTurn && hintLevel ? P.hint(st, hintLevel) : null
  const provisional = data.rd > 110

  // the line above the board
  let info
  if (mode === "rush" && rush) {
    const left = rush.endsAt ? Math.max(0, Math.ceil((rush.endsAt - Date.now()) / 1000)) : null
    info = (
      <>
        <b>{RUSH[rush.kind].label}</b>
        <span className="cpScore" data-rush-score>
          {rush.score}
        </span>
        <span className="cpStrikes" aria-label={`${rush.strikes} of 3 strikes`}>
          {[0, 1, 2].map((i) => (
            <i key={i} className={i < rush.strikes ? "is-on" : ""}>
              ✘
            </i>
          ))}
        </span>
        {left != null && <span className={`cpClock${left <= 10 ? " is-low" : ""}`}>{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>}
      </>
    )
  } else if (mode === "streak") {
    info = (
      <>
        <b>Puzzle Streak</b>
        <span className="cpScore" data-streak>
          {streak.n}
        </span>
        <span className="cpMuted">best {data.streakBest}</span>
      </>
    )
  } else {
    info = (
      <>
        <b>{mode === "rated" ? (data.theme ? P.themeLabel(data.theme) : "Puzzles") : MODE_LABEL[mode]}</b>
        <span className="cpRating" data-rating title={provisional ? "Provisional: it settles after a few more puzzles" : "Your puzzle rating"}>
          Rating {data.rating}
          {provisional ? "?" : ""}
          {result?.delta ? <i className={result.delta > 0 ? "is-up" : "is-down"}>{result.delta > 0 ? ` +${result.delta}` : ` ${result.delta}`}</i> : null}
        </span>
      </>
    )
  }

  const status = !st
    ? ready
      ? message || "Loading..."
      : "Loading puzzles..."
    : message ||
      (st.status === "setup" || st.status === "reply"
        ? "Your opponent is moving..."
        : st.status === "play"
          ? `Your turn: find the best move for ${colorName(st.you)}.`
          : "")

  // the main action: what most people want next
  let primary = null
  let secondary = []
  if (rush?.over && mode === "rush") {
    primary = { label: "Play again", onClick: () => startRush(rush.kind), data: "again" }
    secondary = [{ label: "Back to puzzles", onClick: () => startRated() }]
  } else if (mode === "streak" && streak.over) {
    primary = { label: "New streak", onClick: startStreak, data: "again" }
    secondary = [{ label: "Back to puzzles", onClick: () => startRated() }]
  } else if (done) {
    primary = { label: "Next puzzle", onClick: () => startRated(), data: "next" }
    if (st.failed && st.status === "solved") secondary = [{ label: "Retry", onClick: retry }]
  } else if (st?.failed && mode !== "rush" && mode !== "streak") {
    primary = { label: "View solution", onClick: showSolution, data: "solution" }
    secondary = [
      { label: "Retry", onClick: retry },
      { label: "Skip", onClick: () => startRated() },
    ]
  } else if (st && mode !== "rush") {
    primary = { label: hintLevel >= 2 ? "Hint shown" : hintLevel ? "Show the square" : "Hint", onClick: showHint, disabled: !yourTurn || hintLevel >= 2, data: "hint" }
    if (mode === "streak" && !streak.skipped) secondary = [{ label: "Skip (once)", onClick: skip }]
    else if (mode !== "streak") secondary = [{ label: "View solution", onClick: showSolution }]
  }

  const menus = [
    {
      label: "Game",
      items: [
        { label: "Next Puzzle", onClick: () => startRated() },
        { label: "Puzzle Streak", onClick: startStreak },
        { label: RUSH[3].label, onClick: () => startRush(3) },
        { label: RUSH[5].label, onClick: () => startRush(5) },
        { label: RUSH.survival.label, onClick: () => startRush("survival") },
        { label: "Daily Puzzle", onClick: startDaily },
        "-",
        { label: "History...", onClick: () => setDialog("history") },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    { label: "View", items: [{ label: "Flip Board", checked: data.flip, onClick: () => update((d) => ({ ...d, flip: !d.flip })) }] },
    { label: "Help", items: [helpItem({ program: "Chess Puzzles" }), "-", { label: "How Puzzles Work...", onClick: () => setDialog("howto") }] },
  ]

  // dev builds: tests read the puzzle being played
  if (import.meta.env.DEV) window.__chesspuzzles = { st, mode, data, result, streak, rush }

  const dailyDone = data.daily?.date === today()
  const accuracy = data.played ? Math.round((data.wins / data.played) * 100) : 0

  return (
    <div className={`netApp cpRoot${mobile ? " is-mobile" : ""}`} data-mode={mode}>
      <MenuBar menus={menus} />
      <div className="cpInfo">{info}</div>
      <div className="cpArea" ref={areaRef}>
        {st ? (
          <PuzzleBoard game={st.game} you={st.you} flipped={data.flip} interactive={yourTurn} onMove={onMove} hint={hint} wrong={wrong} slide={slide} size={size} />
        ) : (
          <p className="cpLoading">Loading puzzles...</p>
        )}
        {rush?.over && mode === "rush" && (
          <div className="cpOver" role="dialog" aria-label="Rush over">
            <b>Time's up!</b>
            <span className="cpBigNum" data-final-score>
              {rush.score}
            </span>
            <span>Best: {data.rush[rush.kind]}</span>
          </div>
        )}
      </div>
      <p className={`cpStatus${st?.failed && !done ? " is-bad" : ""}${st?.status === "solved" ? " is-good" : ""}`} role="status" data-status>
        {st?.status === "play" && <span className={`cpTurn cpTurn--${st.you}`} aria-hidden="true" />}
        {status}
      </p>
      <div className="cpButtons">
        {primary && (
          <button type="button" className="cpPrimary" onClick={primary.onClick} disabled={primary.disabled} data-action={primary.data}>
            {primary.label}
          </button>
        )}
        {secondary.map((b) => (
          <button type="button" key={b.label} onClick={b.onClick}>
            {b.label}
          </button>
        ))}
      </div>
      <MoreOptions id="chesspuzzles.options" className="cpMore" summary={`${data.played} solved or tried · ${accuracy}% clean · streak best ${data.streakBest}${data.theme ? ` · ${P.themeLabel(data.theme)}` : ""}`}>
        <div className="cpModes" role="group" aria-label="Modes">
          <button type="button" className={mode === "rated" ? "is-on" : ""} onClick={() => startRated()} data-mode-btn="rated">
            Rated
          </button>
          <button type="button" className={mode === "streak" ? "is-on" : ""} onClick={startStreak} data-mode-btn="streak">
            Streak
          </button>
          <button type="button" className={mode === "rush" && rush?.kind === 3 ? "is-on" : ""} onClick={() => startRush(3)} data-mode-btn="rush3">
            Rush 3 min
          </button>
          <button type="button" className={mode === "rush" && rush?.kind === 5 ? "is-on" : ""} onClick={() => startRush(5)} data-mode-btn="rush5">
            Rush 5 min
          </button>
          <button type="button" className={mode === "rush" && rush?.kind === "survival" ? "is-on" : ""} onClick={() => startRush("survival")} data-mode-btn="survival">
            Survival
          </button>
          <button type="button" className={mode === "daily" ? "is-on" : ""} onClick={startDaily} data-mode-btn="daily">
            Daily{dailyDone ? (data.daily.win ? " ✔" : " ✘") : ""}
          </button>
        </div>
        <div className="cpRow">
          <label className="cpField">
            Theme
            <select value={data.theme} onChange={(e) => setTheme(e.target.value)} data-theme-select>
              <option value="">All themes (healthy mix)</option>
              {P.THEMES.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => setDialog("history")}>
            History
          </button>
          <button type="button" onClick={() => setDialog("reset")}>
            Reset rating
          </button>
        </div>
        {st && done && (
          <p className="cpMuted" data-selectable>
            Puzzle {st.puzzle.id} · rated {st.puzzle.rating} · {st.puzzle.themes.map(P.themeLabel).join(", ")}
          </p>
        )}
        <p className="cpMuted">
          Best rush: {data.rush[3]} (3 min) · {data.rush[5]} (5 min) · {data.rush.survival} (survival). {complete ? `${all.length} puzzles` : "Loading more puzzles..."} from the Lichess puzzle database (CC0).
        </p>
      </MoreOptions>
      {dialog === "howto" && <HowTo onClose={() => setDialog(null)} />}
      {dialog === "history" && <HistoryDialog history={data.history} onReplay={replay} onClose={() => setDialog(null)} />}
      {dialog === "reset" && (
        <Dialog
          title="Reset Puzzle Rating"
          onOk={() => {
            update((d) => ({ ...d, ...P.START_RATING, played: 0, wins: 0, history: [], seen: [] }))
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
          okLabel="Reset"
        >
          <p>Start over at 1500 and clear your puzzle history? Your best streak and rush scores stay.</p>
        </Dialog>
      )}
    </div>
  )
}

export default ChessPuzzles
