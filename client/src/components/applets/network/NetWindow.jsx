import React, { useEffect, useRef } from "react"
import { useNet } from "./NetContext"
import NetworkNeighborhood from "./NetworkNeighborhood"
import ComputerFolder from "./ComputerFolder"
import { GameInvite, IncomingFile, NetNotice, Waiting, WinPopup } from "./NetDialogs"
import Checkers from "./games/Checkers"
import MinesweeperRace from "./games/MinesweeperRace"
import Hearts from "./games/Hearts"
import "./Network.css"

// Hearts from the Start menu: open a new table (its own window), then go away
const HeartsLauncher = ({ onClose }) => {
  const net = useNet()
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
      <p className="netWaitText">{net.status === "offline" ? "Hearts needs the network, which isn't available right now." : "Setting up a table..."}</p>
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
      return <Checkers matchId={w.matchId} onClose={onClose} />
    case "net-race":
      return <MinesweeperRace matchId={w.matchId} fitWindow={fitWindow} onClose={onClose} />
    case "net-hearts":
      return w.matchId ? <Hearts matchId={w.matchId} onClose={onClose} /> : <HeartsLauncher onClose={onClose} />
    default:
      return null
  }
}

export const isNetWindow = (w) => w.app === "network" || !!w.app?.startsWith("net-")

export default NetWindow
