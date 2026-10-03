import React, { useState } from "react"
import MenuBar from "../../../shared/MenuBar"
import Dialog from "../../../shared/Dialog"
import GameChat, { useGameChatMenuItem } from "../../../shared/GameChat"
import PlayOnline, { useOnlineRoom } from "../../../shared/online"
import { CheckersBoard } from "./Checkers"
import "./BoardGames.css"

// Checkers from the Start menu: Play Online front and center (Quick Match, a room with a
// code, an invitation, or the computer) on the online room system (server/arcade/games/
// checkers.js). The board is the same one network matches use (Checkers.jsx).

const ICON = "/assets/program_icons/checkers.svg"

// The room's view in the shape the board expects (the same as a network match's)
const boardView = (room, v) => {
  const watching = room.you === null
  const them = watching ? 1 : 1 - room.you
  const r = room.result
  return {
    ...v,
    you: v.you || v.colors[0],
    spectator: watching,
    round: room.round,
    names: { [v.colors[0]]: room.seats[0]?.name || "?", [v.colors[1]]: room.seats[1]?.name || "?" },
    drawOffer: v.drawOffer === "someone" ? null : v.drawOffer,
    result: r && { youWon: !watching && r.winners.includes(room.you), draw: r.draw, reason: r.reason },
    rematch: { you: room.rematch.includes(room.you), them: room.rematch.includes(them) },
    away: !!room.seats[them]?.away,
    left: !!room.seats[them]?.left,
  }
}

const CheckersOnline = ({ onClose }) => {
  const online = useOnlineRoom("checkers")
  const chatItem = useGameChatMenuItem("checkers")
  const [rules, setRules] = useState(false)
  const { room } = online
  const playing = room && (room.phase === "playing" || room.phase === "over") && online.view

  const chat = <GameChat game="checkers" title="Checkers" room={online.chatRoom} />

  if (playing) {
    const act = {
      move: (path) => online.act({ type: "move", path }),
      draw: (answer) => online.act({ type: "draw", answer }),
      resign: () => online.act({ type: "resign" }),
      rematch: () => online.rematch(),
    }
    return (
      <>
        {chat}
        <CheckersBoard
          view={boardView(room, online.view)}
          act={act}
          onClose={onClose}
          onDone={online.leave}
          doneLabel="Leave"
          chatRoom={null}
          gameMenu={[{ label: "Leave Game", onClick: online.leave }, "-"]}
        />
      </>
    )
  }

  const menus = [
    {
      label: "Game",
      items: [
        { label: "Play Online...", onClick: () => online.leave() },
        { label: "Play the Computer", disabled: !online.connected || !!room, onClick: () => online.playComputer({}) },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    { label: "Options", items: [chatItem] },
    { label: "Help", items: [{ label: "Rules...", onClick: () => setRules(true) }] },
  ]

  return (
    <div className="netApp ckRoot ckOnline">
      <MenuBar menus={menus} />
      {chat}
      <PlayOnline
        online={online}
        title="Checkers"
        icon={ICON}
        blurb="Play checkers against people anywhere, or against the computer. Share the code with a friend."
        computer
      />
      {rules && (
        <Dialog title="Checkers Rules" onOk={() => setRules(false)}>
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

export default CheckersOnline
