import React, { useId, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import ContextMenu from "../../shared/ContextMenu"
import { useOpenGesture } from "../../../hooks/useMediaQuery"
import { useLongPress } from "../../../hooks/useLongPress"
import { describe, useNet } from "./NetContext"
import { useFileDrop } from "./ComputerFolder"
import { ComputerIcon, EntireNetworkIcon } from "./icons"
import { RaceLevelDialog, useGameInvites } from "./ComputerFolder"
import { helpItem } from "../../../utils/help"

// Network Neighborhood: every computer on the 98ish network right now, like the Windows 98
// folder of the same name. Open one to send it a file, a message, or a game invitation.

const sortComputers = (list) =>
  [...list].sort((a, b) => (a.me !== b.me ? (a.me ? -1 : 1) : a.user !== b.user ? (a.user ? -1 : 1) : a.name.localeCompare(b.name)))


const NetworkNeighborhood = ({ onClose }) => {
  const net = useNet()
  const openGesture = useOpenGesture()
  const [selected, setSelected] = useState(null)
  const [view, setView] = useState("icons")
  const [menu, setMenu] = useState(null)
  const [dialog, setDialog] = useState(null)
  const games = useGameInvites((d) => setDialog(d))
  const privacyId = useId()

  const computers = sortComputers(net.computers)
  const selectedComputer = computers.find((c) => c.id === selected) || null
  const others = computers.filter((c) => !c.me)

  const open = (computer) => net.openComputer(computer)

  // a file dragged from My Computer onto a computer is sent to it
  const drop = useFileDrop((computer, item) => net.openComputer(computer, { kind: "send", path: item }), (id) => computers.find((c) => c.id === id && !c.me))

  const itemMenu = (c) => [
    { label: "Open", bold: true, onClick: () => open(c) },
    "-",
    { label: "Send File...", disabled: c.me, onClick: () => net.openComputer(c, "file") },
    { label: "Send Message...", disabled: c.me, onClick: () => (net.canIm(c) ? net.openIm(c) : net.openComputer(c, "message")) },
    {
      label: "Play",
      disabled: c.me,
      items: [
        { label: "Checkers", onClick: () => games.invite(c, "checkers") },
        { label: "Minesweeper Race...", onClick: () => games.invite(c, "race") },
        { label: "Hearts", onClick: () => games.invite(c, "hearts") },
        { label: "Reversi", onClick: () => games.invite(c, "reversi") },
        { label: "Chess", onClick: () => games.invite(c, "chess") },
        { label: "Battleship", onClick: () => games.invite(c, "battleship") },
        { label: "Tetris Battle", onClick: () => games.invite(c, "tetris") },
        { label: "Doodle Together", onClick: () => games.invite(c, "doodle") },
        { label: "Quiz Show", onClick: () => games.invite(c, "quiz") },
        { label: "Sunny Acres Co-op", onClick: () => games.invite(c, "town") },
      ],
    },
    "-",
    { label: "Properties", onClick: () => setDialog({ kind: "properties", computer: c }) },
  ]

  const showMenu = (x, y, computer) => {
    setSelected(computer.id)
    setMenu({ x, y, items: itemMenu(computer) })
  }

  const longPress = useLongPress((x, y, { target }) => {
    const el = target.closest?.("[data-computer]")
    const computer = el && computers.find((c) => c.id === el.dataset.computer)
    if (computer) showMenu(x, y, computer)
  })

  const menus = [
    {
      label: "File",
      items: [
        { label: "Open", disabled: !selectedComputer, onClick: () => open(selectedComputer) },
        { label: "Send File...", disabled: !selectedComputer || selectedComputer.me, onClick: () => net.openComputer(selectedComputer, "file") },
        { label: "Send Message...", disabled: !selectedComputer || selectedComputer.me, onClick: () => net.openComputer(selectedComputer, "message") },
        "-",
        { label: "WinPopup", onClick: () => net.openWinPopup() },
        "-",
        { label: "Properties", disabled: !selectedComputer, onClick: () => setDialog({ kind: "properties", computer: selectedComputer }) },
        "-",
        { label: "Close", onClick: () => onClose?.() },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Large Icons", checked: view === "icons", onClick: () => setView("icons") },
        { label: "Details", checked: view === "details", onClick: () => setView("details") },
        "-",
        { label: "Show My Computer on the Network", checked: net.visible, onClick: () => net.setVisible(!net.visible) },
        "-",
        { label: "Refresh", onClick: () => net.refresh() },
      ],
    },
    {
      label: "Help",
      items: [helpItem({ program: "Network Neighborhood" }), "-", { label: "About Network Neighborhood", onClick: () => setDialog({ kind: "about" }) }],
    },
  ]

  return (
    <div className="netApp nnRoot" onContextMenu={(e) => e.preventDefault()}>
      <MenuBar menus={menus} />
      <div className="nnAddress">
        <span>Address</span>
        <div className="nnAddressBox">
          <EntireNetworkIcon size={16} />
          Network Neighborhood
        </div>
      </div>

      <div
        className={view === "details" ? "nnView nnView--details" : "nnView"}
        onClick={(e) => !e.target.closest("[data-computer]") && setSelected(null)}
        {...longPress}
      >
        {net.status !== "online" && (
          <div className="nnEmpty">
            {net.status === "connecting" ? "Looking for computers on the network..." : "The network is not available right now. 98ish will keep trying to reconnect."}
          </div>
        )}
        {net.status === "online" &&
          computers.map((c) => (
            <button
              type="button"
              key={c.id}
              data-computer={c.id}
              className={["nnItem", selected === c.id && "is-selected", c.hidden && "is-hidden", drop.over === c.id && "is-dropTarget"].filter(Boolean).join(" ")}
              onClick={() => setSelected(c.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                showMenu(e.clientX, e.clientY, c)
              }}
              {...openGesture(() => open(c))}
              {...drop.targetProps(c.id)}
              title={describe(c)}
            >
              <ComputerIcon device={c.device} me={c.me} user={c.user} size={view === "details" ? 16 : 32} />
              <span className={c.name.includes("-") ? "nnName nnName--nowrap" : "nnName"}>{c.name}</span>
              {view === "details" && <span className="nnComment">{describe(c)}</span>}
              {view === "icons" && c.me && <span className="nnTag">(you)</span>}
              {view === "icons" && !c.me && c.busy && <span className="nnTag">(playing)</span>}
            </button>
          ))}
        {net.status === "online" && others.length === 0 && (
          <div className="nnEmpty nnEmpty--hint">
            Nobody else is here right now. Open 98ish in another window, or share it with a friend, and their computer will show up here.
          </div>
        )}
      </div>

      <div className="nnPrivacy">
        <input id={privacyId} type="checkbox" checked={net.visible} onChange={(e) => net.setVisible(e.target.checked)} />
        <label htmlFor={privacyId}>Show my computer on the network</label>
      </div>

      <div className="status-bar">
        <p className="status-bar-field">
          {net.status === "online" ? `${others.length} other computer${others.length === 1 ? "" : "s"}` : net.status === "connecting" ? "Connecting..." : "Offline"}
        </p>
        <p className="status-bar-field">{net.me ? `You are ${net.me.name}${net.visible ? "" : " (hidden)"}` : " "}</p>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}

      {dialog?.kind === "properties" && (
        <Dialog title={`${dialog.computer.name} Properties`} onOk={() => setDialog(null)}>
          <div className="nnProps">
            <ComputerIcon device={dialog.computer.device} me={dialog.computer.me} user={dialog.computer.user} />
            <div>
              <b>{dialog.computer.name}</b>
              <p>{describe(dialog.computer)}</p>
              <p>On the network since {new Date(dialog.computer.since).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
            </div>
          </div>
        </Dialog>
      )}

      {dialog?.kind === "about" && (
        <Dialog title="About Network Neighborhood" onOk={() => setDialog(null)}>
          <p className="dialogText">
            Every 98ish desktop open right now is a computer on this network. People signed on to 98 Messenger show up under
            their screen name; everyone else is a GUEST computer.
            <br />
            <br />
            Open a computer to send it a document, a picture or a sound (or drag one there from My Computer), a WinPopup
            message, or a game of Checkers, Minesweeper Race, Hearts, Reversi, Chess or Battleship.
            Uncheck <b>Show my computer on the network</b> to hide.
          </p>
        </Dialog>
      )}

      {dialog?.kind === "race" && <RaceLevelDialog onPick={(level) => games.send(dialog.computer, "race", { level })} onCancel={() => setDialog(null)} />}

      {dialog?.kind === "alert" && (
        <Dialog title={dialog.title} onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
    </div>
  )
}

export default NetworkNeighborhood
