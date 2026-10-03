import React, { useEffect, useRef } from "react"
import { useNet } from "./NetContext"
import NetworkNeighborhood from "./NetworkNeighborhood"
import ComputerFolder from "./ComputerFolder"
import { GameInvite, IncomingFile, NetNotice, Waiting, WinPopup } from "./NetDialogs"
import Checkers from "./games/Checkers"
import MinesweeperRace from "./games/MinesweeperRace"
import Hearts from "./games/Hearts"
import { lazyApp } from "../../OS-specific/LazyApp"
import { ConnectionPanel } from "../../shared/online/PlayOnline"
import { useServerStatus } from "../../shared/online/useOnlineRoom"
import "./Network.css"

// The board games (and their computer players) load when first opened
const Reversi = lazyApp(() => import("./games/Reversi"))
const Chess = lazyApp(() => import("./games/Chess"))
const Battleship = lazyApp(() => import("./games/Battleship"))
// Checkers from the Start menu: online rooms (Quick Match, codes, the computer)
const CheckersOnline = lazyApp(() => import("./games/CheckersOnline"))
const PlayOnlineWindow = lazyApp(() => import("./PlayOnlineWindow"))

// Hearts from the Start menu: open a new table (its own window), then go away
const HeartsLauncher = ({ onClose }) => {
  const net = useNet()
  const server = useServerStatus()
  const started = useRef(false)
  useEffect(() => {
    if (started.current || net.status !== "online") return
    started.current = true
    net.createTable().then((result) => {
      if (!result.ok) net.notice("Hearts", result.error, "warn")
      onClose()
    })
  }, [net.status])
  return (
    <div className="netApp">
      {server.online ? <p className="netWaitText">Setting up a table...</p> : <ConnectionPanel server={server} onBack={onClose} />}
    </div>
  )
}

// Every Network Neighborhood window, by its app
const NetWindow = ({ window: w, dispatch, onClose, fitWindow }) => {
  switch (w.app) {
    case "network":
      return <NetworkNeighborhood onClose={onClose} />
    case "net-computer":
      return <ComputerFolder computerId={w.computerId} computerName={w.computerName} />
    case "net-file":
      return <IncomingFile offer={w.offer} onClose={onClose} dispatch={dispatch} />
    case "net-invite":
      return <GameInvite invite={w.invite} onClose={onClose} />
    case "net-waiting":
      return <Waiting inviteId={w.inviteId} text={w.text} onClose={onClose} />
    case "net-notice":
      return <NetNotice text={w.text} icon={w.noticeIcon} onClose={onClose} />
    case "net-popup":
      return <WinPopup onClose={onClose} />
    case "net-checkers":
      return w.matchId ? <Checkers matchId={w.matchId} onClose={onClose} /> : <CheckersOnline onClose={onClose} />
    case "net-online":
      return <PlayOnlineWindow game={w.game} onClose={onClose} />
    case "net-race":
      return <MinesweeperRace matchId={w.matchId} fitWindow={fitWindow} onClose={onClose} />
    case "net-hearts":
      return w.matchId ? <Hearts matchId={w.matchId} onClose={onClose} /> : <HeartsLauncher onClose={onClose} />
    // a network match, or (opened from the Start menu) a game against the computer
    case "net-reversi":
      return <Reversi matchId={w.matchId} onClose={onClose} />
    case "net-chess":
      return <Chess matchId={w.matchId} onClose={onClose} />
    case "net-battleship":
      return <Battleship matchId={w.matchId} onClose={onClose} />
    default:
      return null
  }
}

export const isNetWindow = (w) => w.app === "network" || !!w.app?.startsWith("net-")

export default NetWindow
