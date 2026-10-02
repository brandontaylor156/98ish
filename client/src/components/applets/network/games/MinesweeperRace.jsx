import React, { useEffect, useRef, useState } from "react"
import Minesweeper from "../../minesweeper/Minesweeper"
import { useNet } from "../NetContext"

// Minesweeper Race: both players sweep the same minefield (same seed, same opening). You
// see how far along the other player is; first to clear the field wins, a mine loses.

const RacerBar = ({ who, progress, safe, you }) => {
  const pct = Math.round(((progress.revealed || 0) / safe) * 100)
  const state =
    progress.status === "won" ? "Cleared!" : progress.status === "lost" ? "Boom!" : progress.status === "resigned" ? "Gave up" : progress.left ? "Left" : progress.away ? "Offline" : `${pct}%`
  return (
    <div className={`raceRacer${you ? " is-you" : ""}${progress.status === "lost" ? " is-dead" : ""}`}>
      <span className="raceName" title={who}>
        {you ? "You" : who}
      </span>
      <span className="raceTrack" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${you ? "Your" : `${who}'s`} progress`}>
        <span className="raceFill" style={{ width: `${pct}%` }} />
      </span>
      <span className="raceState">{state}</span>
    </div>
  )
}

const MinesweeperRace = ({ matchId, fitWindow, onClose }) => {
  const net = useNet()
  const view = net.matches[matchId]
  const [now, setNow] = useState(Date.now())
  const sent = useRef("")

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(timer)
  }, [])

  // a new round: report from scratch
  useEffect(() => {
    sent.current = ""
  }, [view?.round])

  if (!view) {
    return (
      <div className="netApp">
        <p className="netWaitText">This race is over.</p>
      </div>
    )
  }

  const { field } = view
  const safe = field.rows * field.cols - field.mines
  const counting = now < view.startAt
  const result = view.result

  const onProgress = (game) => {
    if (Date.now() < view.startAt || result) return
    const status = game.status === "won" ? "won" : game.status === "lost" ? "lost" : "playing"
    const key = `${game.revealed}:${game.flags}:${status}`
    if (key === sent.current) return
    sent.current = key
    net.raceProgress(matchId, { revealed: game.revealed, flags: game.flags, status, time: Date.now() - view.startAt })
  }

  const resultText = result
    ? result.youWon
      ? result.reason === "cleared"
        ? "You win! First to clear the field."
        : result.reason === "mine"
          ? `You win! ${view.them.name} hit a mine.`
          : `You win! ${view.them.name} gave up.`
      : result.reason === "cleared"
        ? `${view.them.name} cleared the field first.`
        : result.reason === "mine"
          ? "Boom! You hit a mine."
          : "You gave up."
    : null

  const panel = (
    <div className="racePanel">
      <RacerBar who={view.them.name} progress={view.them} safe={safe} />
      <RacerBar who={view.you.name} progress={view.you} safe={safe} you />
    </div>
  )

  const overlay =
    counting || result ? (
      <div className={result ? "raceOverlay is-result" : "raceOverlay"}>
        {counting ? (
          <span className="raceCount">{Math.ceil((view.startAt - now) / 1000)}</span>
        ) : (
          <div className="raceResult">
            <b>{result.youWon ? "You win!" : "You lose"}</b>
            <span>{resultText}</span>
            <div>
              <button type="button" disabled={view.rematch.you || view.them.left} onClick={() => net.rematch(matchId)}>
                {view.rematch.you ? "Waiting..." : view.rematch.them ? "Accept Rematch" : "Rematch"}
              </button>
              <button type="button" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    ) : null

  return (
    <div className="raceRoot" data-seed={view.seed} data-level={view.level} data-round={view.round}>
      <Minesweeper
        key={matchId}
        fitWindow={fitWindow}
        onClose={onClose}
        race={{
          seed: view.seed,
          round: view.round,
          field,
          startAt: view.startAt,
          frozen: counting || !!result,
          over: !!result,
          onProgress,
          onResign: () => net.resign(matchId),
          panel,
          overlay,
          chatRoom: `match:${matchId}`,
        }}
      />
    </div>
  )
}

export default MinesweeperRace
