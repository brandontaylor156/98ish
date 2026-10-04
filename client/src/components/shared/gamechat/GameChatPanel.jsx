import React, { useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import ContextMenu from "../ContextMenu"
import { BubbleIcon, setChatPrefs } from "../GameChat"

// The chat itself (loaded the first time a game's chat opens): who said what, one-tap
// messages, and a box to type in. Everything is rendered as text, never HTML.

const MAX_TEXT = 200

// One-tap messages; the server knows their text by id
const QUICK = {
  match: [
    ["gg", "Good game!"],
    ["nice", "Nice move!"],
    ["wp", "Well played!"],
    ["oops", "Oops!"],
    ["rematch", "Rematch?"],
    ["smile", ":)"],
  ],
  lobby: [
    ["hi", "Hi everyone!"],
    ["gl", "Good luck!"],
    ["gg", "Good game!"],
    ["high", "New high score!"],
    ["lol", "LOL"],
    ["smile", ":)"],
  ],
}

const FILTERS = [
  ["strict", "Strict (hide messages with swearing)"],
  ["standard", "Standard (star out swear words)"],
  ["off", "Off"],
]

// Names in colors (yours in red, like 98 Messenger), the same color for a name every time
const COLORS = ["#0000e0", "#008000", "#800080", "#805000", "#007080", "#0060c0", "#506000"]
const colorOf = (name) => COLORS[[...String(name)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length]

// ---------- smileys: little original pixel faces ----------

const FACES = {
  smile: { mouth: "M4 9h1v1h4V9h1v1H9v1H5v-1H4z" },
  sad: { mouth: "M5 9h4v1h1v1H9v-1H5v1H4v-1h1z" },
  wink: { mouth: "M4 9h1v1h4V9h1v1H9v1H5v-1H4z", wink: true },
  grin: { mouth: "M4 8h6v1H9v1H5V9H4z", fill: "#fff" },
  tongue: { mouth: "M4 9h6v1H4z", tongue: true },
  wow: { mouth: "M6 8h2v1h1v1H8v1H6v-1H5V9h1z" },
}
const SMILEY = /(:-?\)|:-?\(|;-?\)|:-?D\b|:-?[pP]\b|:-?[oO]\b|<3)/
const kindOf = (token) => {
  const t = token.replace("-", "")
  if (t === ":)") return "smile"
  if (t === ":(") return "sad"
  if (t === ";)") return "wink"
  if (t === ":D") return "grin"
  if (t === ":p" || t === ":P") return "tongue"
  if (t === "<3") return "heart"
  return "wow"
}

const Smiley = ({ kind, label }) =>
  kind === "heart" ? (
    <svg className="gchatSmiley" viewBox="0 0 14 14" role="img" aria-label={label} shapeRendering="crispEdges">
      <path d="M2 3h4v1h2V3h4v1h1v4h-1v1h-1v1h-1v1H9v1H5v-1H4v-1H3V9H2V8H1V4h1z" fill="#000" />
      <path d="M2 4h4v1h2V4h4v4h-1v1h-1v1H9v1H5v-1H4V9H3V8H2z" fill="#e00020" />
      <path d="M3 5h1v1H3z" fill="#fff" />
    </svg>
  ) : (
    <svg className="gchatSmiley" viewBox="0 0 14 14" role="img" aria-label={label} shapeRendering="crispEdges">
      <path d="M4 0h6v1h2v1h1v2h1v6h-1v2h-1v1h-2v1H4v-1H2v-1H1v-2H0V4h1V2h1V1h2z" fill="#000" />
      <path d="M4 1h6v1h2v2h1v6h-1v2h-2v1H4v-1H2v-2H1V4h1V2h2z" fill="#ffd800" />
      {FACES[kind].wink ? <path d="M4 5h2v1H4z" fill="#000" /> : <path d="M4 4h2v2H4z" fill="#000" />}
      <path d="M8 4h2v2H8z" fill="#000" />
      <path d={FACES[kind].mouth} fill="#000" />
      {FACES[kind].fill && <path d="M5 9h4v1H5z" fill="#fff" />}
      {FACES[kind].tongue && <path d="M7 10h2v2H7z" fill="#e00040" />}
    </svg>
  )

// Text with :) and friends drawn as faces; everything else is plain text
const ChatText = ({ text }) =>
  String(text)
    .split(SMILEY)
    .map((part, i) => (i % 2 === 1 ? <Smiley key={i} kind={kindOf(part)} label={part} /> : part))

const clock = (time) => new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })

const Line = ({ message, mine, filter, onName }) => {
  if (message.system) return <div className="gchatSystem">{message.text}</div>
  const filtered = message.masked && filter !== "off"
  return (
    <div className="gchatLine" title={clock(message.time)}>
      <button type="button" className="gchatName" style={{ color: mine ? "#e00000" : colorOf(message.from) }} onClick={(e) => onName(e, message)}>
        {message.from}
      </button>
      <span className="gchatColon">: </span>
      {filtered && filter === "strict" ? (
        <span className="gchatFiltered">(hidden by your chat filter)</span>
      ) : (
        <span className="gchatText">
          <ChatText text={filtered ? message.masked : message.text} />
        </span>
      )}
    </div>
  )
}

const GameChatPanel = ({ game, room, title, mode, messages, count, me, joined, error, prefs, dock, onSend, onHide, onClose }) => {
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState(null)
  const [menu, setMenu] = useState(null)
  const logRef = useRef(null)
  const stick = useRef(true)

  const muted = prefs.muted
  const shown = messages.filter((m) => m.system || !muted.includes(m.from))

  useLayoutEffect(() => {
    const el = logRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [shown.length, dock])
  // the log getting shorter (the phone keyboard coming up) keeps the newest line in view
  useLayoutEffect(() => {
    const el = logRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const send = async (payload) => {
    if (sending) return
    setSending(true)
    const result = await onSend(payload)
    setSending(false)
    if (!result.ok) return setNotice(result.error)
    setNotice(null)
    if (payload.text !== undefined) setText("")
    stick.current = true
  }

  const mute = (name, on) => setChatPrefs((q) => ({ muted: on ? [...new Set([...q.muted, name])].slice(-200) : q.muted.filter((n) => n !== name) }))

  const nameMenu = (event, message) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const mine = message.fromId === me?.id
    setMenu({
      x: rect.left,
      y: rect.bottom,
      items: [
        { label: mine ? "That's you!" : `Mute ${message.from}`, disabled: mine, onClick: () => mute(message.from, true) },
        { label: "Hide this message", onClick: () => onHide(message.id) },
      ],
    })
  }

  const optionsMenu = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setMenu({
      x: rect.left,
      y: rect.bottom,
      items: [
        { label: "Chat in This Game", checked: true, onClick: () => setChatPrefs((q) => ({ games: { ...q.games, [game]: false } })) },
        { label: "Chat in All Games", checked: prefs.enabled, onClick: () => setChatPrefs({ enabled: false }) },
        "-",
        { label: "Swear Filter", items: FILTERS.map(([id, label]) => ({ label, checked: prefs.filter === id, onClick: () => setChatPrefs({ filter: id }) })) },
        {
          label: "Muted Players",
          disabled: !muted.length,
          items: muted.length ? muted.map((name) => ({ label: `Unmute ${name}`, onClick: () => mute(name, false) })) : [{ label: "(none)", disabled: true }],
        },
      ],
    })
  }

  const status = error ? error : !joined ? "Connecting..." : mode === "lobby" ? `${count} ${count === 1 ? "player" : "players"} here` : "Match chat"

  return (
    <div className={`gchatPanel gchatPanel--${dock}`} data-room={room} role="complementary" aria-label={`${title} chat`}>
      <div className="gchatHead">
        <BubbleIcon />
        <span className="gchatTitle">{title} Chat</span>
        <button type="button" className="gchatHeadBtn" onClick={optionsMenu} aria-label="Chat options" title="Options">
          &#8942;
        </button>
        <button type="button" className="gchatHeadBtn" onClick={onClose} aria-label="Close chat" title="Close">
          {dock === "sheet" ? "▼︎" : "×"}
        </button>
      </div>

      <div
        className="gchatLog"
        ref={logRef}
        role="log"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
      >
        {!shown.length && <div className="gchatSystem">{mode === "lobby" ? "Say hi to everyone playing!" : "Say hi to your opponent!"}</div>}
        {shown.map((message) => (
          <Line key={message.id} message={message} mine={!!me && message.fromId === me.id} filter={prefs.filter} onName={nameMenu} />
        ))}
      </div>

      <div className="gchatQuick" aria-label="Quick chat">
        {QUICK[mode].map(([id, label]) => (
          <button type="button" key={id} disabled={!joined || sending} onClick={() => send({ quick: id })} title={`Say "${label}"`}>
            {id === "smile" ? <Smiley kind="smile" label=":)" /> : label}
          </button>
        ))}
      </div>

      {notice && (
        <div className="gchatNotice" role="alert">
          {notice}
        </div>
      )}

      <form
        className="gchatForm"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) send({ text })
        }}
      >
        <input
          type="text"
          value={text}
          maxLength={MAX_TEXT}
          placeholder={joined ? "Say something..." : "Connecting..."}
          aria-label="Chat message"
          disabled={!joined}
          onChange={(e) => setText(e.target.value)}
          enterKeyHint="send"
          autoComplete="off"
        />
        <button type="submit" disabled={!joined || sending || !text.trim()}>
          Send
        </button>
      </form>

      {/* on the page itself: a moved window's transform would shift a fixed menu */}
      <div className="status-bar gchatStatus">
        <p className="status-bar-field gchatCount">{status}</p>
      </div>

      {menu && createPortal(<ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />, document.body)}
    </div>
  )
}

export default GameChatPanel
