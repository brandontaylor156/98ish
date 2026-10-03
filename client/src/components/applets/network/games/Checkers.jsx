import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import MenuBar from "../../../shared/MenuBar"
import Dialog from "../../../shared/Dialog"
import { useNet } from "../NetContext"
import GameChat, { useGameChatMenuItem } from "../../../shared/GameChat"

// Checkers against another computer. The server checks every move and sends the moves
// you may make; pick a piece, then the square(s) to move it to (each jump of a multi-jump
// in turn). The board is shared by network matches (Network Neighborhood invitations,
// below) and online rooms (CheckersOnline.jsx: Quick Match, room codes, the computer).

const rowOf = (i) => Math.floor(i / 8)
const isJump = (path) => Math.abs(rowOf(path[1]) - rowOf(path[0])) === 2
const startsWith = (path, prefix) => prefix.every((x, i) => path[i] === x)
const COLOR_NAME = { b: "Black", r: "Red" }

const REASONS = {
  captured: (w) => `${w} took every piece.`,
  blocked: (w, l) => `${l} has no moves left.`,
  resigned: (w, l) => `${l} resigned.`,
  agreed: () => "Draw agreed.",
  quiet: () => "40 moves each without a capture: it's a draw.",
}

const Crown = () => (
  <svg className="ckCrown" viewBox="0 0 20 14" aria-hidden="true">
    <path d="M1 12L2 3l5 4 3-6 3 6 5-4 1 9z" fill="#ffd700" stroke="#7a5a00" strokeWidth="1" />
  </svg>
)

// view: the server's view of the match; act: { move(path), draw(answer), resign(), rematch() }
// onDone/doneLabel: the button after the game ("Close"); gameMenu: more Game menu items;
// chatRoom: the game chat's room (null: the caller shows the chat)
export const CheckersBoard = ({ view, act, onClose, onDone = onClose, doneLabel = "Close", chatRoom, gameMenu = [] }) => {
  const chatItem = useGameChatMenuItem("checkers")
  const [path, setPath] = useState([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [size, setSize] = useState(320)
  const areaRef = useRef(null)

  // a new position from the server: start choosing afresh
  useEffect(() => setPath([]), [view?.moves, view?.round])

  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setSize(Math.max(160, Math.floor(Math.min(el.clientWidth, el.clientHeight) / 8) * 8)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [!!view])

  const you = view.you
  const them = you === "b" ? "r" : "b"
  const yourTurn = !view.result && view.turn === you
  const legal = view.legal || []
  const movable = new Set(legal.map((p) => p[0]))
  const candidates = path.length ? legal.filter((p) => startsWith(p, path)) : []
  const targets = new Set(candidates.map((p) => p[path.length]).filter((x) => x !== undefined))
  const mustJump = yourTurn && legal.length > 0 && isJump(legal[0])
  const lastSquares = new Set(view.last?.path || [])
  // black starts at the top of the board: turn it around so your pieces are at the bottom
  const order = Array.from({ length: 64 }, (_, i) => (you === "b" ? 63 - i : i))

  const send = async (move) => {
    setSending(true)
    setPath(move)
    const result = await act.move(move)
    setSending(false)
    if (!result.ok) {
      setError(result.error)
      setPath([])
    }
  }

  const choose = (square) => {
    setError(null)
    if (!yourTurn || sending) return
    if (path.length <= 1 && movable.has(square)) return setPath([square])
    if (path.length && targets.has(square)) {
      const next = [...path, square]
      const complete = candidates.find((p) => p.length === next.length && startsWith(p, next))
      return complete ? send(next) : setPath(next)
    }
    if (mustJump && view.board[square]?.toLowerCase() === you) setError("You must take a jump.")
    setPath([])
  }

  const result = view.result
  const winnerColor = result && !result.draw ? (result.youWon ? you : them) : null
  const resultText = result
    ? result.draw
      ? "It's a draw."
      : `${result.youWon ? "You win!" : `${view.names[winnerColor]} wins.`} ${REASONS[result.reason]?.(view.names[winnerColor], view.names[winnerColor === "b" ? "r" : "b"]) || ""}`
    : null

  const status = result
    ? resultText
    : view.left
      ? `${view.names[them]} left the game.`
      : view.away
        ? `${view.names[them]} lost their connection. Waiting for them to come back...`
        : yourTurn
          ? path.length > 1
            ? "Keep jumping!"
            : mustJump
              ? "Your move. You must jump!"
              : "Your move."
          : `Waiting for ${view.names[them]}...`

  const menus = [
    {
      label: "Game",
      items: [
        { label: "Offer Draw", disabled: !!result || !!view.drawOffer, onClick: () => act.draw("offer") },
        { label: "Resign...", disabled: !!result, onClick: () => setDialog("resign") },
        { label: "Rematch", disabled: !result || view.rematch.you || view.left, onClick: () => act.rematch() },
        "-",
        ...gameMenu,
        { label: "Exit", onClick: onClose },
      ],
    },
    { label: "Options", items: [chatItem] },
    { label: "Help", items: [{ label: "Rules...", onClick: () => setDialog("rules") }] },
  ]

  const Player = ({ color, name, mine }) => (
    <div className={view.turn === color && !result ? "ckPlayer is-turn" : "ckPlayer"}>
      <span className={`ckDot ckDot--${color}`} />
      <b>{name}</b>
      <span className="ckSub">
        {mine && !view.spectator ? "(you) " : ""}
        {COLOR_NAME[color]}, {view.counts[color]} {view.counts[color] === 1 ? "piece" : "pieces"}
      </span>
      {!mine && view.away && <span className="ckAway">connection lost</span>}
    </div>
  )

  return (
    <div className="netApp ckRoot">
      <MenuBar menus={menus} />
      {chatRoom !== null && <GameChat game="checkers" title="Checkers" room={chatRoom} />}
      <Player color={them} name={view.names[them]} />
      <div className="ckArea" ref={areaRef}>
        <div className="ckBoard" style={{ width: size, height: size }} role="grid" aria-label="Checkerboard">
          {order.map((square) => {
            const piece = view.board[square]
            const dark = (rowOf(square) + (square % 8)) % 2 === 1
            const classes = ["ckSquare", dark ? "is-dark" : "is-light"]
            if (lastSquares.has(square)) classes.push("is-last")
            if (path.includes(square)) classes.push("is-path")
            if (targets.has(square)) classes.push("is-target")
            if (yourTurn && movable.has(square) && !path.length) classes.push("is-movable")
            const captured = view.last?.captures?.includes(square)
            return (
              <button type="button" key={square} className={classes.join(" ")} data-square={square} onClick={() => choose(square)} disabled={!dark} aria-label={`square ${square}${piece ? ` ${COLOR_NAME[piece.toLowerCase()]}${piece === piece.toUpperCase() ? " king" : ""}` : ""}`}>
                {piece && (
                  <span className={`ckPiece ckPiece--${piece.toLowerCase()}${path[0] === square ? " is-selected" : ""}`}>
                    {piece === piece.toUpperCase() && <Crown />}
                  </span>
                )}
                {!piece && captured && <span className="ckGhost" />}
              </button>
            )
          })}
        </div>
      </div>
      <Player color={you} name={view.names[you]} mine />

      {view.drawOffer === "them" && !result && (
        <div className="ckOffer">
          <span>{view.names[them]} offers a draw.</span>
          <button type="button" onClick={() => act.draw("accept")}>
            Accept
          </button>
          <button type="button" onClick={() => act.draw("decline")}>
            Decline
          </button>
        </div>
      )}

      <div className="ckButtons">
        {!result ? (
          <>
            <button type="button" disabled={!!view.drawOffer} onClick={() => act.draw("offer")}>
              {view.drawOffer === "you" ? "Draw offered" : "Offer Draw"}
            </button>
            <button type="button" onClick={() => setDialog("resign")}>
              Resign
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={view.rematch.you || view.left} onClick={() => act.rematch()}>
              {view.rematch.you ? "Waiting..." : view.rematch.them ? "Accept Rematch" : "Rematch"}
            </button>
            <button type="button" onClick={onDone}>
              {doneLabel}
            </button>
          </>
        )}
      </div>

      <div className="status-bar">
        <p className={error ? "status-bar-field ckError" : "status-bar-field"} role="status">
          {error || status}
        </p>
      </div>

      {result && (
        <div className={result.youWon ? "ckBanner is-win" : "ckBanner"} role="status">
          {result.draw ? "Draw" : result.youWon ? "You win!" : "You lose"}
          {view.rematch.them && !view.rematch.you && <small>{view.names[them]} wants a rematch</small>}
        </div>
      )}

      {dialog === "resign" && (
        <Dialog
          title="Resign"
          okLabel="Resign"
          onOk={() => {
            act.resign()
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">Give up this game? {view.names[them]} will win.</p>
        </Dialog>
      )}
      {dialog === "rules" && (
        <Dialog title="Checkers Rules" onOk={() => setDialog(null)}>
          <p className="dialogText">
            Move diagonally forward one square. Jump an opponent's piece to capture it. If you can jump, you must, and keep
            jumping while you can. Reach the far side to become a king: kings move backward too.
            <br />
            <br />
            Take all of your opponent's pieces, or leave them with no moves, to win. Black moves first.
          </p>
        </Dialog>
      )}
    </div>
  )
}

// A network match (from a Network Neighborhood invitation)
const Checkers = ({ matchId, onClose }) => {
  const net = useNet()
  const view = net.matches[matchId]
  if (!view) {
    return (
      <div className="netApp ckRoot">
        <p className="netWaitText">This game is over.</p>
      </div>
    )
  }
  const act = {
    move: (path) => net.move(matchId, path),
    draw: (answer) => net.draw(matchId, answer),
    resign: () => net.resign(matchId),
    rematch: () => net.rematch(matchId),
  }
  return <CheckersBoard view={view} act={act} onClose={onClose} chatRoom={`match:${matchId}`} gameMenu={[{ label: "Play Online...", onClick: () => net.openPlayOnline("checkers") }, "-"]} />
}

export default Checkers
