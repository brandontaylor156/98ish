import React from "react"
import Dialog from "../../../shared/Dialog"
import PlayOnlineButton from "../../../shared/online/PlayOnlineButton"
import { useNet } from "../NetContext"

// Pieces shared by Reversi, Chess and Battleship: player bars, the buttons under the board,
// the result banner and the resign box. `view.solo` games are against the computer.

export const PlayerBar = ({ active, swatch, name, you, sub, away, thinking }) => (
  <div className={active ? "ckPlayer is-turn" : "ckPlayer"}>
    {swatch}
    <b>{name}</b>
    <span className="ckSub">
      {you ? "(you) " : ""}
      {sub}
    </span>
    {thinking && <span className="bgThinking">thinking...</span>}
    {away && <span className="ckAway">connection lost</span>}
  </div>
)

// "Play Online..." for the Game menu: who's online, to invite (NetContext openPlayOnline)
export const usePlayOnlineItem = (game) => {
  const net = useNet()
  return { label: "Play Online...", onClick: () => net?.openPlayOnline(game) }
}

// Against the computer: the way to play a person instead
export const PlayOnlineSmall = ({ game }) => {
  const net = useNet()
  return <PlayOnlineButton size="small" className="bgPlayOnline" sub="Invite someone who's online now" onClick={() => net?.openPlayOnline(game)} />
}

// Draw / Resign while playing; Rematch (New Game against the computer) and Close after
export const GameButtons = ({ view, act, onClose, onResign, canDraw }) => {
  const result = view.result
  if (!result) {
    return (
      <div className="ckButtons">
        {view.solo && <PlayOnlineSmall game={view.game} />}
        {canDraw && (
          <button type="button" disabled={!!view.drawOffer} onClick={() => act.draw("offer")}>
            {view.drawOffer === "you" ? "Draw offered" : "Offer Draw"}
          </button>
        )}
        <button type="button" onClick={onResign}>
          Resign
        </button>
      </div>
    )
  }
  return (
    <div className="ckButtons">
      {view.solo && <PlayOnlineSmall game={view.game} />}
      {view.solo ? (
        <button type="button" onClick={() => act.rematch()}>
          New Game
        </button>
      ) : (
        <button type="button" disabled={view.rematch.you || view.left} onClick={() => act.rematch()}>
          {view.rematch.you ? "Waiting..." : view.rematch.them ? "Accept Rematch" : "Rematch"}
        </button>
      )}
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  )
}

export const DrawOffer = ({ view, act, them }) =>
  view.drawOffer === "them" && !view.result ? (
    <div className="ckOffer">
      <span>{them} offers a draw.</span>
      <button type="button" onClick={() => act.draw("accept")}>
        Accept
      </button>
      <button type="button" onClick={() => act.draw("decline")}>
        Decline
      </button>
    </div>
  ) : null

export const ResultBanner = ({ view, them }) =>
  view.result ? (
    <div className={view.result.youWon ? "ckBanner is-win" : "ckBanner"} role="status">
      {view.result.draw ? "Draw" : view.result.youWon ? "You win!" : "You lose"}
      {!view.solo && view.rematch.them && !view.rematch.you && <small>{them} wants a rematch</small>}
    </div>
  ) : null

export const ResignDialog = ({ them, onResign, onCancel }) => (
  <Dialog title="Resign" okLabel="Resign" onOk={onResign} onCancel={onCancel}>
    <p className="dialogText">Give up this game? {them} will win.</p>
  </Dialog>
)

export const RulesDialog = ({ title, children, onOk }) => (
  <Dialog title={title} onOk={onOk}>
    <p className="dialogText">{children}</p>
  </Dialog>
)

// "Waiting for Bob..." / "The computer is thinking..." / connection trouble
export const waitingText = (view, them) =>
  view.left ? `${them} left the game.` : view.away ? `${them} lost their connection. Waiting for them to come back...` : view.solo ? "The computer is thinking..." : `Waiting for ${them}...`

export const GameOver = () => (
  <div className="netApp ckRoot">
    <p className="netWaitText">This game is over.</p>
  </div>
)
