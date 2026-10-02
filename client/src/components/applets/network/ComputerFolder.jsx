import React, { useEffect, useId, useRef, useState } from "react"
import Dialog from "../../shared/Dialog"
import { fs } from "../../../utils/fs"
import { useFsVersion } from "../../../hooks/useFs"
import { useOpenGesture } from "../../../hooks/useMediaQuery"
import { iconFor } from "../fileExplorer/FileExplorer"
import { DRAG_TYPE } from "../../../utils/fsActions"
import { GAME_INFO, canSend, describe, fileBytes, formatSize, maxBytesFor, sizeLimitText, useNet } from "./NetContext"
import { ComputerIcon, GameIcon, MessageIcon, SendFileIcon } from "./icons"

// \\GUEST-1A2B: a computer's shared folder. Send it a file or a message, or invite it to
// a game.

const LEVELS = [
  ["beginner", "Beginner", "9 x 9, 10 mines"],
  ["intermediate", "Intermediate", "16 x 16, 40 mines"],
  ["expert", "Expert", "16 x 30, 99 mines"],
]
const tooBig = (item) => fileBytes(item) > maxBytesFor(item.type)

// Why a file can't be sent, or null if it can
export const sendProblem = (item) => {
  if (!item) return "That file is no longer there."
  if (!canSend(item)) return `"${item.name}" can't be sent. You can send documents, pictures and sounds.`
  if (tooBig(item)) return `"${item.name}" is ${formatSize(fileBytes(item))}. That kind of file can be at most ${sizeLimitText(item.type)}.`
  return null
}

// Something dragged out of My Computer (DRAG_TYPE, its path) dropped on a computer:
// targetProps(id) goes on each drop target, `over` is the one being hovered
export const useFileDrop = (onDrop, find) => {
  const [over, setOver] = useState(null)
  const depth = useRef(0)
  const accepts = (e) => e.dataTransfer?.types?.includes(DRAG_TYPE)
  return {
    over,
    targetProps: (id) => ({
      onDragEnter: (e) => {
        if (!accepts(e) || !find(id)) return
        e.preventDefault()
        depth.current++
        setOver(id)
      },
      onDragOver: (e) => {
        if (!accepts(e) || !find(id)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
      },
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1)
        if (!depth.current) setOver((o) => (o === id ? null : o))
      },
      onDrop: (e) => {
        depth.current = 0
        setOver(null)
        const from = accepts(e) && e.dataTransfer.getData(DRAG_TYPE)
        const computer = from && find(id)
        if (!computer) return
        e.preventDefault()
        e.stopPropagation()
        onDrop(computer, from)
      },
    }),
  }
}

// Invitations, shared by Network Neighborhood and a computer's folder. `show` puts up a
// dialog: { kind: "race", computer } to pick a level, or { kind: "alert", ... }
export const useGameInvites = (show) => {
  const net = useNet()
  const send = async (computer, game, options) => {
    show(null)
    const result = await net.invite({ id: computer.id }, game, options)
    if (!result.ok) show({ kind: "alert", title: GAME_INFO[game].name, text: result.error })
  }
  return {
    send,
    invite: (computer, game) => (game === "race" ? show({ kind: "race", computer }) : send(computer, game)),
  }
}

export const RaceLevelDialog = ({ onPick, onCancel }) => {
  const [level, setLevel] = useState("beginner")
  const id = useId()
  return (
    <Dialog title="Minesweeper Race" okLabel="Invite" onOk={() => onPick(level)} onCancel={onCancel}>
      <p className="dialogText">You'll both get the same minefield. First to clear it wins; step on a mine and you lose.</p>
      <fieldset className="netLevels">
        <legend>Field</legend>
        {LEVELS.map(([value, label, about]) => (
          <div key={value} className="field-row">
            <input id={`${id}-${value}`} type="radio" name={`${id}-level`} checked={level === value} onChange={() => setLevel(value)} />
            <label htmlFor={`${id}-${value}`}>
              {label} <small>({about})</small>
            </label>
          </div>
        ))}
      </fieldset>
    </Dialog>
  )
}

// A 98-style "choose a file" box over the C: drive (documents, pictures and sounds)
export const FilePicker = ({ title = "Send File", okLabel = "Send", onPick, onCancel }) => {
  useFsVersion()
  const openGesture = useOpenGesture()
  const [path, setPath] = useState(["C:", "Documents"])
  const [selected, setSelected] = useState(null)
  const dir = fs.resolve(path)
  const items = dir?.isDirectory
    ? [...dir.content].filter((i) => i.isDirectory || canSend(i)).sort((a, b) => (a.isDirectory !== b.isDirectory ? (a.isDirectory ? -1 : 1) : a.name.localeCompare(b.name)))
    : []
  const file = selected && items.includes(selected) && !selected.isDirectory ? selected : null
  const size = file ? fileBytes(file) : 0
  const big = !!file && tooBig(file)

  const enter = (item) => {
    if (item.isDirectory) {
      setPath([...path, item.name])
      setSelected(null)
    } else if (!tooBig(item)) onPick(item)
  }

  return (
    <Dialog title={title} okLabel={okLabel} okDisabled={!file || big} onOk={() => file && onPick(file)} onCancel={onCancel}>
      <div className="netPicker">
        <div className="netPickerBar">
          <span>Look in:</span>
          <span className="netPickerPath">{path.join("\\")}</span>
          <button type="button" disabled={path.length <= 1} onClick={() => (setPath(path.slice(0, -1)), setSelected(null))} aria-label="Up one level" title="Up one level">
            <img src="/assets/directory_up_small.png" alt="" />
          </button>
        </div>
        <div className="netPickerList" role="listbox" aria-label="Files">
          {items.length === 0 && <p className="netPickerEmpty">Nothing here can be sent.</p>}
          {items.map((item) => (
            <button
              type="button"
              key={item.name}
              role="option"
              aria-selected={selected === item}
              className={selected === item ? "netPickerItem is-selected" : "netPickerItem"}
              onClick={() => setSelected(item)}
              {...openGesture(() => enter(item))}
            >
              <img src={iconFor(item)} alt="" />
              <span>{item.name}</span>
              {item.isDirectory && <span className="netPickerOpen" onClick={(e) => (e.stopPropagation(), enter(item))}>&rsaquo;</span>}
            </button>
          ))}
        </div>
        <p className={big ? "netPickerInfo is-error" : "netPickerInfo"}>
          {file ? (big ? sendProblem(file) : `"${file.name}", ${formatSize(size)}`) : "Pick a document, picture or sound to send."}
        </p>
      </div>
    </Dialog>
  )
}

export const ComposeDialog = ({ to, initial = "", onSent, onCancel }) => {
  const net = useNet()
  const [text, setText] = useState(initial)
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const send = async () => {
    setSending(true)
    const result = await net.sendPopup(to.target, text)
    setSending(false)
    if (result.ok) onSent?.(result)
    else setError(result.error)
  }
  return (
    <Dialog title="Send Message" okLabel="Send" okDisabled={!text.trim() || sending} onOk={send} onCancel={onCancel}>
      <div className="netCompose">
        <p>
          To: <b>{to.name}</b>
        </p>
        <textarea value={text} maxLength={500} rows={5} onChange={(e) => (setText(e.target.value), setError(null))} aria-label="Message" />
        <p className={error ? "netComposeInfo is-error" : "netComposeInfo"}>{error || `${500 - text.length} characters left`}</p>
      </div>
    </Dialog>
  )
}

const STATUS_TEXT = { waiting: "Waiting for an answer...", accepted: "Accepted", declined: "Declined", expired: "No answer", gone: "Left the network", canceled: "Canceled" }

const ComputerFolder = ({ computerId, computerName }) => {
  const net = useNet()
  const openGesture = useOpenGesture()
  const [dialog, setDialog] = useState(null)
  const [selected, setSelected] = useState(null)
  const games = useGameInvites(setDialog)
  const computer = net.computers.find((c) => c.id === computerId)
  const name = computer?.name || computerName
  const intent = net.intents[computerId]
  const transfers = Object.entries(net.sentFiles).filter(([, f]) => f.toId === computerId)

  const sendMessage = () => (net.canIm(computer) ? net.openIm(computer) : setDialog({ kind: "message" }))

  // Opened from a right-click on Network Neighborhood: "Send File..." / "Send Message..."
  useEffect(() => {
    if (!intent || !computer) return
    net.clearIntent(computerId)
    if (intent.kind === "file") setDialog({ kind: "file" })
    if (intent.kind === "message") sendMessage()
    if (intent.kind === "send") sendPath(intent.path)
  }, [intent, !!computer])

  const sendFile = async (file) => {
    setDialog({ kind: "alert", title: "Send File", text: `Sending "${file.name}" to ${name}...`, busy: true })
    const result = await net.sendFile(computer, file)
    setDialog(
      result.ok
        ? { kind: "alert", title: "Send File", text: `"${file.name}" is on its way. ${result.to} has 2 minutes to accept it.` }
        : { kind: "alert", title: "Send File", text: result.error }
    )
  }

  // a file from My Computer, dropped here or on this computer's icon
  const sendPath = (path) => {
    const item = fs.resolve(path)
    const problem = sendProblem(item)
    if (problem) return setDialog({ kind: "alert", title: "Send File", text: problem })
    sendFile(item)
  }
  const drop = useFileDrop((_, path) => sendPath(path), () => (computer && !computer.me ? computer : null))

  if (!computer) {
    return (
      <div className="netApp netFolder">
        <div className="netGone">
          <ComputerIcon size={32} />
          <p>
            <b>\\{computerName}</b> is not accessible. The computer may have left the network or hidden itself.
          </p>
        </div>
      </div>
    )
  }

  const actions = [
    { id: "file", label: "Send a File", icon: <SendFileIcon />, run: () => setDialog({ kind: "file" }) },
    { id: "message", label: net.canIm(computer) ? "Instant Message" : "Send a Message", icon: <MessageIcon />, run: sendMessage },
    ...Object.entries(GAME_INFO).map(([game, info]) => ({
      id: game,
      label: info.name,
      icon: <GameIcon src={info.icon} />,
      run: () => games.invite(computer, game),
    })),
  ]

  return (
    <div className="netApp netFolder">
      <div className="netFolderHead">
        <ComputerIcon device={computer.device} me={computer.me} user={computer.user} size={48} />
        <div>
          <h2>{name}</h2>
          <p>{describe(computer)}</p>
        </div>
      </div>

      {computer.me ? (
        <div className="nnView">
          <p className="nnEmpty">This is your computer. Other people see it as <b>{name}</b>{net.visible ? "." : ", but it's hidden right now."}</p>
        </div>
      ) : (
        <div
          className={drop.over ? "nnView netActions is-dropTarget" : "nnView netActions"}
          onClick={(e) => !e.target.closest("[data-action]") && setSelected(null)}
          {...drop.targetProps(computerId)}
        >
          {actions.map((a) => (
            <button
              type="button"
              key={a.id}
              data-action={a.id}
              className={selected === a.id ? "nnItem is-selected" : "nnItem"}
              onClick={() => setSelected(a.id)}
              {...openGesture(a.run)}
            >
              {a.icon}
              <span className="nnName">{a.label}</span>
            </button>
          ))}
        </div>
      )}

      {transfers.length > 0 && (
        <div className="netTransfers">
          <b>Files sent to {name}</b>
          <ul>
            {transfers.slice(-4).map(([id, f]) => (
              <li key={id}>
                <span className="netTransferName">{f.name}</span>
                <span>{STATUS_TEXT[f.status]}</span>
                {f.status === "waiting" && (
                  <button type="button" onClick={() => net.cancelFile(id)}>
                    Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="status-bar">
        <p className="status-bar-field">{computer.me ? "My computer" : `${actions.length} object(s)`}</p>
        <p className="status-bar-field">{computer.busy ? "Playing a game" : "Available"}</p>
      </div>

      {dialog?.kind === "file" && <FilePicker title={`Send File to ${name}`} onPick={sendFile} onCancel={() => setDialog(null)} />}
      {dialog?.kind === "message" && (
        <ComposeDialog
          to={{ target: { id: computer.id }, name }}
          onSent={() => setDialog({ kind: "alert", title: "Send Message", text: `Your message was sent to ${name}.` })}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "race" && <RaceLevelDialog onPick={(level) => games.send(computer, "race", { level })} onCancel={() => setDialog(null)} />}
      {dialog?.kind === "alert" && (
        <Dialog title={dialog.title} onOk={dialog.busy ? undefined : () => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
    </div>
  )
}

export default ComputerFolder
