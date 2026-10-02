import React, { useEffect, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import { notepadWindow } from "../../../utils/programs"
import { fs } from "../../../utils/fs"
import { GAME_INFO, formatSize, saveReceivedFile, useNet } from "./NetContext"
import { ComposeDialog } from "./ComputerFolder"
import { SendFileIcon } from "./icons"

// The small windows the network pops up: an incoming file, a game invitation, waiting for
// an answer, a notice, and WinPopup.

const useCountdown = (until) => {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [])
  return Math.max(0, Math.ceil((until - now) / 1000))
}

const MessageIconBox = ({ kind = "info" }) => (
  <svg className="netBoxIcon" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
    {kind === "warn" ? (
      <>
        <path d="M16 2L31 29H1z" fill="#ffff00" stroke="#000" />
        <path d="M14.5 10h3l-.6 11h-1.8zM14.5 23h3v3h-3z" fill="#000" />
      </>
    ) : (
      <>
        <circle cx="16" cy="16" r="14" fill="#fff" stroke="#000" />
        <path d="M14 13h4v12h-4zM14 7h4v4h-4z" fill="#0000c0" />
      </>
    )}
  </svg>
)

export const NetNotice = ({ text, icon, onClose }) => (
  <div className="netBox">
    <div className="netBoxBody">
      <MessageIconBox kind={icon} />
      <p>{text}</p>
    </div>
    <div className="netBoxButtons">
      <button type="button" onClick={onClose} autoFocus>
        OK
      </button>
    </div>
  </div>
)

export const IncomingFile = ({ offer, onClose, dispatch }) => {
  const net = useNet()
  const [state, setState] = useState({ kind: "ask" }) // ask | busy | saved | error
  const left = useCountdown(offer.expiresAt)

  const answer = async (accept) => {
    setState({ kind: "busy" })
    const result = await net.replyFile(offer, accept)
    if (!accept) return onClose()
    if (!result.ok) return setState({ kind: "error", text: result.error })
    try {
      const file = saveReceivedFile(result.file)
      setState({ kind: "saved", file, path: fs.displayPath(file) })
    } catch (error) {
      setState({ kind: "error", text: `The file couldn't be saved: ${error.message}` })
    }
  }

  if (state.kind === "saved") {
    return (
      <div className="netBox">
        <div className="netBoxBody">
          <SendFileIcon />
          <p>
            <b>{offer.name}</b> was saved to
            <br />
            <span className="netPath">{state.path}</span>
          </p>
        </div>
        <div className="netBoxButtons">
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "open_window", payload: notepadWindow(state.file) })
              onClose()
            }}
          >
            Open
          </button>
          <button type="button" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    )
  }

  if (state.kind === "error") return <NetNotice text={state.text} icon="warn" onClose={onClose} />

  return (
    <div className="netBox">
      <div className="netBoxBody">
        <SendFileIcon />
        <p>
          Incoming file from <b>{offer.from}</b>:
          <br />
          <b>{offer.name}</b> ({formatSize(offer.size)})
          <br />
          <small>Accepted files go in C:\Documents\Received Files.</small>
        </p>
      </div>
      <div className="netBoxButtons">
        <button type="button" disabled={state.kind === "busy"} onClick={() => answer(true)}>
          Accept
        </button>
        <button type="button" disabled={state.kind === "busy"} onClick={() => answer(false)}>
          Decline
        </button>
        <span className="netCountdown">{left}s</span>
      </div>
    </div>
  )
}

export const GameInvite = ({ invite, onClose }) => {
  const net = useNet()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const left = useCountdown(invite.expiresAt)
  const info = GAME_INFO[invite.game]
  const level = invite.options?.level

  const answer = async (accept) => {
    setBusy(true)
    const result = await net.replyInvite(invite, accept)
    if (!accept || result.ok) return onClose()
    setBusy(false)
    setError(result.error)
  }

  if (error) return <NetNotice text={error} icon="warn" onClose={onClose} />

  return (
    <div className="netBox">
      <div className="netBoxBody">
        <img src={info?.icon} width="32" height="32" alt="" />
        <p>
          <b>{invite.from}</b> invites you to play <b>{invite.gameName}</b>
          {level ? ` (${level[0].toUpperCase()}${level.slice(1)})` : ""}.
          {invite.game === "hearts" && (
            <>
              <br />
              <small>Empty seats are played by the computer.</small>
            </>
          )}
        </p>
      </div>
      <div className="netBoxButtons">
        <button type="button" disabled={busy} onClick={() => answer(true)}>
          Accept
        </button>
        <button type="button" disabled={busy} onClick={() => answer(false)}>
          Decline
        </button>
        <span className="netCountdown">{left}s</span>
      </div>
    </div>
  )
}

export const Waiting = ({ inviteId, text, onClose }) => {
  const net = useNet()
  return (
    <div className="netBox">
      <div className="netBoxBody">
        <div className="netHourglass" aria-hidden="true" />
        <p>{text}</p>
      </div>
      <div className="netBoxButtons">
        <button
          type="button"
          onClick={() => {
            net.cancelInvite(inviteId)
            onClose()
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

const stamp = (time) => new Date(time).toLocaleString([], { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })

// WinPopup: messages from other computers, one at a time, like Windows for Workgroups
export const WinPopup = ({ onClose }) => {
  const net = useNet()
  const [index, setIndex] = useState(null) // null = the newest
  const [dialog, setDialog] = useState(null)
  const messages = net.popups
  const current = index === null ? messages.length - 1 : Math.min(index, messages.length - 1)
  const message = messages[current]
  const others = net.computers.filter((c) => !c.me)

  const discard = () => {
    net.discardPopup?.(current)
    setIndex(null)
  }

  const menus = [
    {
      label: "Messages",
      items: [
        { label: "Send...", onClick: () => setDialog({ kind: "pick" }) },
        { label: "Reply...", disabled: !message, onClick: () => setDialog({ kind: "compose", to: { target: { id: message.fromId }, name: message.from } }) },
        "-",
        { label: "Discard", disabled: !message, onClick: discard },
        { label: "Clear All", disabled: !messages.length, onClick: () => (net.clearPopups(), setIndex(null)) },
        { label: "Previous", disabled: current <= 0, onClick: () => setIndex(current - 1) },
        { label: "Next", disabled: current >= messages.length - 1, onClick: () => setIndex(current + 1) },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    { label: "Help", items: [{ label: "About WinPopup", onClick: () => setDialog({ kind: "about" }) }] },
  ]

  return (
    <div className="netApp netPopup">
      <MenuBar menus={menus} />
      <div className="netPopupTools">
        <button type="button" onClick={() => setDialog({ kind: "pick" })} title="Send">
          Send
        </button>
        <button type="button" disabled={!message} onClick={() => setDialog({ kind: "compose", to: { target: { id: message.fromId }, name: message.from } })}>
          Reply
        </button>
        <button type="button" disabled={!message} onClick={discard}>
          Discard
        </button>
        <span className="netPopupSep" />
        <button type="button" disabled={current <= 0} onClick={() => setIndex(current - 1)} aria-label="Previous message">
          &#9664;
        </button>
        <button type="button" disabled={current >= messages.length - 1} onClick={() => setIndex(current + 1)} aria-label="Next message">
          &#9654;
        </button>
      </div>
      {message ? (
        <>
          <p className="netPopupHead">
            Message from <b>{message.from}</b> to <b>{message.to}</b> on {stamp(message.time)}
          </p>
          <div className="netPopupText">{message.text}</div>
        </>
      ) : (
        <div className="netPopupText netPopupText--empty">No messages. Choose Send to send a message to another computer on the network.</div>
      )}
      <div className="status-bar">
        <p className="status-bar-field">{messages.length ? `Current message: ${current + 1}` : "No messages"}</p>
        <p className="status-bar-field">Total number of messages: {messages.length}</p>
      </div>

      {dialog?.kind === "pick" && (
        <Dialog
          title="Send Message"
          okLabel="Next >"
          okDisabled={!dialog.id}
          onOk={() => {
            const c = others.find((x) => x.id === dialog.id)
            setDialog(c ? { kind: "compose", to: { target: { id: c.id }, name: c.name } } : null)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">Send a message to:</p>
          {others.length ? (
            <select value={dialog.id || ""} onChange={(e) => setDialog({ ...dialog, id: e.target.value })} aria-label="Computer">
              <option value="">(choose a computer)</option>
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="dialogText">There are no other computers on the network.</p>
          )}
        </Dialog>
      )}
      {dialog?.kind === "compose" && (
        <ComposeDialog to={dialog.to} onSent={() => setDialog({ kind: "sent", name: dialog.to.name })} onCancel={() => setDialog(null)} />
      )}
      {dialog?.kind === "sent" && (
        <Dialog title="WinPopup" onOk={() => setDialog(null)}>
          <p className="dialogText">Message sent to {dialog.name}.</p>
        </Dialog>
      )}
      {dialog?.kind === "about" && (
        <Dialog title="About WinPopup" onOk={() => setDialog(null)}>
          <p className="dialogText">WinPopup for 98ish. Send short messages to any computer in Network Neighborhood, no sign on needed.</p>
        </Dialog>
      )}
    </div>
  )
}
