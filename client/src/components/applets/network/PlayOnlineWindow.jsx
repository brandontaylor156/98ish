import React, { useId, useState } from "react"
import { GAME_INFO, useNet } from "./NetContext"
import { ConnectionPanel, OnlinePeople } from "../../shared/online/PlayOnline"
import { GlobeIcon } from "../../shared/online/PlayOnlineButton"
import { useServerStatus } from "../../shared/online/useOnlineRoom"
import "../../shared/online/Online.css"

// "Play Online..." for the network games that are played by invitation (Reversi, Chess,
// Battleship, Minesweeper Race): who's online right now, each with an Invite button. Their
// invitation pops up on their screen; when they accept, the game opens for both of you.

const LEVELS = [
  ["beginner", "Beginner", "9 x 9, 10 mines"],
  ["intermediate", "Intermediate", "16 x 16, 40 mines"],
  ["expert", "Expert", "30 x 16, 99 mines"],
]

const BLURBS = {
  race: "You both get the same minefield. First to clear it wins; step on a mine and you lose.",
  reversi: "Black or white is picked at random. Black moves first.",
  chess: "White or black is picked at random. You can offer a draw or resign at any time.",
  battleship: "You each place your fleet, then take turns firing. Sink theirs first to win.",
  checkers: "Black or red is picked at random. Black moves first.",
}

const PlayOnlineWindow = ({ game, onClose }) => {
  const net = useNet()
  const server = useServerStatus()
  const [level, setLevel] = useState("beginner")
  const id = useId()
  const info = GAME_INFO[game]
  if (!info) return null

  return (
    <div className="netApp olWindow" data-online-game={game}>
      <div className="olHome">
        <div className="olHeader">
          <img src={info.icon} width="32" height="32" alt="" />
          <div>
            <h2>Play {info.name} Online</h2>
            <p>Invite someone who's online right now. They get an invitation on their screen, and when they say yes the game opens for both of you.</p>
          </div>
          <GlobeIcon size={24} />
        </div>

        {BLURBS[game] && <p className="olMuted">{BLURBS[game]}</p>}

        {game === "race" && (
          <fieldset className="olFieldset">
            <legend>Minefield</legend>
            <div className="olLevels" role="radiogroup">
              {LEVELS.map(([value, label, about]) => (
                <span key={value}>
                  <input id={`${id}-${value}`} type="radio" name={`${id}-level`} checked={level === value} onChange={() => setLevel(value)} />
                  <label htmlFor={`${id}-${value}`}>
                    {label} <small>({about})</small>
                  </label>
                </span>
              ))}
            </div>
          </fieldset>
        )}

        {!server.online ? (
          <ConnectionPanel server={server} />
        ) : (
          <fieldset className="olFieldset">
            <legend>Who's online now</legend>
            <p className="olStatus">
              <span className="olLed" aria-hidden="true" />
              <span>
                You are <b>{net.me?.name || "a guest"}</b>. No sign-on needed.
              </span>
            </p>
            <OnlinePeople
              onInvite={(c) => net.invite({ id: c.id }, game, game === "race" ? { level } : {})}
              emptyText="Nobody else is online right now. Send a friend the link to 98ish: when they open it, they show up here. (Or open 98ish in another window to try it yourself.)"
            />
          </fieldset>
        )}

        <p className="olMuted">Tip: you can also right-click anyone in Network Neighborhood and choose Play.</p>
        <div className="olFooter">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default PlayOnlineWindow
