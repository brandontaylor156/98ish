import React, { useEffect, useRef, useState } from "react"
import MenuBar from "../../../shared/MenuBar"
import GameChat, { useGameChatMenuItem } from "../../../shared/GameChat"
import { DrawOffer, GameButtons, GameOver, PlayerBar, ResignDialog, ResultBanner, RulesDialog, usePlayOnlineItem, waitingText } from "./GameParts"
import { useBoardSize, useNetGame, useSoloReversi } from "./useBoardGame"
import "./BoardGames.css"

// Reversi against another computer on the network, or against this one. Place a disc so
// it traps a line of the other color between it and one of yours: they all flip.

const COLOR_NAME = { b: "Black", w: "White" }
const other = (c) => (c === "b" ? "w" : "b")

const Disc = ({ color, size = 12 }) => <span className={`rvSwatch rvSwatch--${color}`} style={{ width: size, height: size }} />

const ReversiBoard = ({ view, act, onClose }) => {
  const chatItem = useGameChatMenuItem("reversi")
  const onlineItem = usePlayOnlineItem("reversi")
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const [dialog, setDialog] = useState(null)
  const [hints, setHints] = useState(true)
  const areaRef = useRef(null)
  const size = useBoardSize(areaRef, 8, [!!view])

  useEffect(() => setError(null), [view.moves, view.round])

  const you = view.you
  const them = other(you)
  const themName = view.names[them]
  const result = view.result
  const yourTurn = !result && view.turn === you
  const legal = new Set(view.legal || [])
  const flipped = new Set(view.last?.flips || [])

  const play = async (square) => {
    setError(null)
    if (!yourTurn || sending) return
    if (!legal.has(square)) return setError(view.board[square] ? "That square is taken." : "A move has to flip at least one disc.")
    setSending(true)
    const r = await act.move({ square })
    setSending(false)
    if (!r.ok) setError(r.error)
  }

  const score = `${view.counts[you]} to ${view.counts[them]}`
  const resultText = result
    ? result.reason === "resigned"
      ? result.youWon
        ? `${themName} resigned. You win!`
        : "You resigned."
      : result.draw
        ? `It's a draw, ${score}.`
        : result.youWon
          ? `You win, ${view.counts[you]} to ${view.counts[them]}!`
          : `${themName} wins, ${view.counts[them]} to ${view.counts[you]}.`
    : null

  const status = result
    ? resultText
    : yourTurn
      ? view.passed === them
        ? `${themName} has no move. Your turn again.`
        : "Your move."
      : view.passed === you
        ? `You have no move, so ${themName} goes again.`
        : waitingText(view, themName)

  const menus = [
    {
      label: "Game",
      items: view.solo
        ? [
            { label: "New Game (play Black)", onClick: () => act.rematch("b") },
            { label: "New Game (play White)", onClick: () => act.rematch("w") },
            onlineItem,
            "-",
            { label: "Resign...", disabled: !!result, onClick: () => setDialog("resign") },
            "-",
            { label: "Exit", onClick: onClose },
          ]
        : [
            { label: "Resign...", disabled: !!result, onClick: () => setDialog("resign") },
            { label: "Rematch", disabled: !result || view.rematch.you || view.left, onClick: () => act.rematch() },
            "-",
            { label: "Exit", onClick: onClose },
          ],
    },
    { label: "Options", items: [{ label: "Show Legal Moves", checked: hints, onClick: () => setHints(!hints) }, chatItem] },
    { label: "Help", items: [{ label: "Rules...", onClick: () => setDialog("rules") }] },
  ]

  return (
    <div className="netApp ckRoot rvRoot" data-game="reversi">
      <MenuBar menus={menus} />
      <GameChat game="reversi" title="Reversi" room={view.solo ? undefined : `match:${view.id}`} />
      <PlayerBar active={!result && view.turn === them} swatch={<Disc color={them} />} name={themName} sub={`${COLOR_NAME[them]}, ${view.counts[them]} discs`} away={view.away} thinking={view.thinking} />
      <div className="ckArea" ref={areaRef}>
        <div className="rvBoard" style={{ width: size, height: size }} role="grid" aria-label="Reversi board">
          {view.board.map((disc, square) => {
            const classes = ["rvSquare"]
            if (yourTurn && hints && legal.has(square)) classes.push("is-legal")
            if (view.last?.square === square) classes.push("is-last")
            return (
              <button
                type="button"
                key={square}
                className={classes.join(" ")}
                data-square={square}
                onClick={() => play(square)}
                aria-label={`${"abcdefgh"[square % 8]}${8 - Math.floor(square / 8)}${disc ? ` ${COLOR_NAME[disc]}` : ""}`}
              >
                {disc && <span key={`${disc}${flipped.has(square) ? view.moves : ""}`} className={`rvDisc rvDisc--${disc}${flipped.has(square) ? " is-flipped" : ""}${view.last?.square === square ? " is-new" : ""}`} />}
              </button>
            )
          })}
        </div>
      </div>
      <PlayerBar active={yourTurn} swatch={<Disc color={you} />} name={view.names[you]} you sub={`${COLOR_NAME[you]}, ${view.counts[you]} discs`} />
      <DrawOffer view={view} act={act} them={themName} />
      <GameButtons view={view} act={act} onClose={onClose} onResign={() => setDialog("resign")} />
      <div className="status-bar">
        <p className={error ? "status-bar-field ckError" : "status-bar-field"} role="status">
          {error || status}
        </p>
      </div>
      <ResultBanner view={view} them={themName} />

      {dialog === "resign" && <ResignDialog them={themName} onResign={() => (act.resign(), setDialog(null))} onCancel={() => setDialog(null)} />}
      {dialog === "rules" && (
        <RulesDialog title="Reversi Rules" onOk={() => setDialog(null)}>
          Place a disc so that one or more of your opponent's discs lie in a straight line (across, down or diagonally)
          between it and another of your discs. Every disc you trap flips to your color.
          <br />
          <br />
          If you can't make a move, your turn is skipped. When neither player can move, the one with the most discs wins.
          Black moves first.
        </RulesDialog>
      )}
    </div>
  )
}

const NetReversi = ({ matchId, onClose }) => {
  const { view, act } = useNetGame(matchId)
  if (!view) return <GameOver />
  return <ReversiBoard view={view} act={act} onClose={onClose} />
}

const SoloReversi = ({ onClose }) => {
  const { view, act } = useSoloReversi()
  return <ReversiBoard view={view} act={act} onClose={onClose} />
}

const Reversi = ({ matchId, onClose }) => (matchId ? <NetReversi matchId={matchId} onClose={onClose} /> : <SoloReversi onClose={onClose} />)

export default Reversi
