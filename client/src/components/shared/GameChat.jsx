/*
 * Game chat: a small 98 Messenger-style chat beside any game (server: server/gamechat).
 *
 * Adding it to a game takes three lines:
 *
 *   import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"   // 1. import
 *   const chatItem = useGameChatMenuItem("town")                           // 2. a menu item:
 *   ...menus: { label: "Options", items: [..., chatItem] }                 //    put it in Options (or Game)
 *   <GameChat game="town" title="Town" />                                  // 3. anywhere inside the app's root
 *
 * That's a lobby: one room per game (lobby:<game>) for everyone playing it right now. For a
 * network match pass its room, and only that match's players can read or post:
 *
 *   <GameChat game="tetris" title="Tetris" room={`match:${matchId}`} />
 *
 * (the server must know the match: server/net/games.js tracks it, `playersOf(matchId)`).
 * A game without a menu bar can use the item as a checkbox: { label, checked, onClick }.
 *
 * GameChat renders nothing inside the game itself: it puts a speech-bubble button (with an
 * unread count) in the window's title bar, and opens the chat as a drawer docked beside the
 * window on a desktop (or inside it, shrinking the game, when there's no room beside it),
 * or on a phone as a bottom sheet that slides up over the game (shrinking the game would
 * squeeze its on-screen controls together). While the chat is closed, a new message shows
 * for a few seconds as a one-line ticker at the top of the game; tapping it opens the chat. The chat window itself loads on first open (GameChatPanel.jsx).
 * Players can turn chat off for one game (the menu item), for every game, set the swear
 * filter, and mute people (all in the chat's Options, kept in localStorage "98ish.gamechat").
 */
import React, { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { useNet } from "../applets/network/NetContext"
import { getSettings, masterGain } from "../../utils/settings"
import { getAudioContext, masterOutput } from "../../utils/audio"
import { progress } from "../../utils/achievements"
import "./gamechat/GameChat.css"

const Panel = lazy(() => import("./gamechat/GameChatPanel"))

// ---------- preferences ----------

const KEY = "98ish.gamechat"
const DEFAULTS = { enabled: true, games: {}, filter: "standard", muted: [], open: {} }
const read = () => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }
  } catch {
    return { ...DEFAULTS }
  }
}
let prefs = null
const listeners = new Set()
const current = () => (prefs ||= read())
const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const setChatPrefs = (patch) => {
  prefs = { ...current(), ...(typeof patch === "function" ? patch(current()) : patch) }
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // remembered for this visit only
  }
  listeners.forEach((fn) => fn())
}
export const useChatPrefs = () => useSyncExternalStore(subscribe, current, current)
export const chatOn = (p, game) => p.enabled && p.games[game] !== false

// "Game Chat" for a game's Options menu: turns chat on or off in this game
export const useGameChatMenuItem = (game) => {
  const p = useChatPrefs()
  const on = chatOn(p, game)
  return {
    label: "Game Chat",
    checked: on,
    onClick: () => setChatPrefs((q) => ({ enabled: on ? q.enabled : true, games: { ...q.games, [game]: !on } })),
  }
}

// ---------- the new-message chime ----------

// (on the page's shared AudioContext, through the taskbar volume)
const chime = () => {
  if (!getSettings().systemSounds || !masterGain()) return
  try {
    const audio = getAudioContext()
    if (!audio) return
    if (audio.state !== "running") audio.resume().catch(() => {})
    const t = audio.currentTime
    for (const [i, freq] of [880, 1318.5].entries()) {
      const osc = audio.createOscillator()
      const g = audio.createGain()
      osc.type = "sine"
      osc.frequency.value = freq
      g.gain.setValueAtTime(0.0001, t + i * 0.09)
      g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.09 + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.25)
      osc.connect(g).connect(masterOutput(audio))
      osc.start(t + i * 0.09)
      osc.stop(t + i * 0.09 + 0.3)
    }
  } catch {
    // sound is a nicety
  }
}

// An original speech bubble with three dots
export const BubbleIcon = () => (
  <svg className="gchatBubble" viewBox="0 0 14 12" width="14" height="12" aria-hidden="true" shapeRendering="crispEdges">
    <path d="M2 0h10v1h1v1h1v6h-1v1h-1v1H6l-3 2v-2H2V9H1V8H0V2h1V1h1z" fill="#000" />
    <path d="M2 1h10v1h1v6h-1v1H5l-1 1V9H2V8H1V2h1z" fill="#fff" />
    <path d="M3 4h2v2H3zM6 4h2v2H6zM9 4h2v2H9z" fill="#000080" />
  </svg>
)

const DRAWER_W = 220
const stop = (e) => e.stopPropagation()
const MAX_MESSAGES = 120

// Where the game's window is in the page: its frame, the box that moves it, the title
// bar's buttons, and the game's root (the frame's child holding this chat)
const findLayout = (anchor) => {
  const win = anchor?.closest(".window")
  if (!win) return null
  let root = anchor
  while (root && root.parentElement !== win) root = root.parentElement
  return {
    win,
    root,
    host: win.parentElement,
    controls: win.querySelector(":scope > .title-bar .title-bar-controls"),
    mobile: !!win.parentElement?.classList.contains("mobileWindow"),
  }
}

// Beside the window if there's room (right, else left), otherwise inside it
const dockFor = (layout) => {
  if (layout.mobile) return "sheet"
  const box = layout.host.getBoundingClientRect()
  const vw = document.documentElement.clientWidth
  if (box.width >= vw - 4) return "inside"
  if (box.right + DRAWER_W <= vw) return "right"
  if (box.left - DRAWER_W >= 0) return "left"
  return "inside"
}

const ChatHost = ({ game, room, mode, title, net }) => {
  const socket = net.socket
  const p = useChatPrefs()
  const anchor = useRef(null)
  const [layout, setLayout] = useState(null)
  const [open, setOpenState] = useState(() => !!current().open[game])
  const [dock, setDock] = useState(null)
  const [messages, setMessages] = useState([])
  const [count, setCount] = useState(0)
  const [unread, setUnread] = useState(0)
  const [joined, setJoined] = useState(false)
  const [error, setError] = useState(null)
  const [hidden, setHidden] = useState(() => new Set())
  const [ticker, setTicker] = useState(null) // the latest message, while the chat is closed
  const openRef = useRef(open)
  const meRef = useRef(null)
  const lastChime = useRef(0)
  openRef.current = open
  meRef.current = net.me?.id

  const setOpen = (value) => {
    setOpenState(value)
    if (value) setUnread(0)
    setChatPrefs((q) => ({ open: { ...q.open, [game]: value } }))
  }

  useLayoutEffect(() => setLayout(findLayout(anchor.current)), [])

  // ---- the room ----
  useEffect(() => {
    if (!socket || net.status !== "online") return
    let live = true
    const add = (message) => {
      if (message.room !== room) return
      setMessages((list) => [...list.slice(-(MAX_MESSAGES - 1)), message])
      const mine = message.fromId && message.fromId === meRef.current
      if (message.system || mine || current().muted.includes(message.from)) return
      if (!openRef.current) {
        setUnread((n) => n + 1)
        setTicker(message)
      }
      if ((!openRef.current || !document.hasFocus()) && Date.now() - lastChime.current > 1500) {
        lastChime.current = Date.now()
        chime()
      }
    }
    const onCount = (c) => c.room === room && setCount(c.count)
    socket.on("gchat:msg", add)
    socket.on("gchat:count", onCount)
    socket.emit("gchat:join", { room }, (result) => {
      if (!live) return
      if (!result?.ok) return setError(result?.error || "Chat isn't available right now.")
      setError(null)
      setJoined(true)
      setMessages(result.history)
      setCount(result.count)
    })
    return () => {
      live = false
      socket.off("gchat:msg", add)
      socket.off("gchat:count", onCount)
      socket.emit("gchat:leave", { room })
      setJoined(false)
    }
  }, [socket, net.status, room])

  // ---- docking ----
  useEffect(() => {
    if (!open || !layout) return setDock(null)
    let frame = 0
    const place = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setDock(dockFor(layout)))
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(layout.host)
    window.addEventListener("resize", place)
    window.addEventListener("pointerup", place)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener("resize", place)
      window.removeEventListener("pointerup", place)
    }
  }, [open, layout])

  // the ticker fades after a few seconds (and goes when the chat opens)
  useEffect(() => {
    if (!ticker) return
    const t = setTimeout(() => setTicker(null), 4500)
    return () => clearTimeout(t)
  }, [ticker])
  useEffect(() => {
    if (open) setTicker(null)
  }, [open])

  // inside the window: the game gives up some room (a phone sheet slides over it instead)
  useLayoutEffect(() => {
    if (!layout || dock !== "inside") return
    layout.win.dataset.gchatHost = dock
    layout.root.dataset.gchat = dock
    return () => {
      delete layout.win.dataset.gchatHost
      delete layout.root.dataset.gchat
    }
  }, [layout, dock])

  const send = (payload) =>
    new Promise((resolve) => {
      if (!socket?.connected) return resolve({ ok: false, error: "You aren't connected to the network." })
      socket.timeout(10_000).emit("gchat:send", { room, ...payload }, (timeout, result) => {
        const answer = timeout ? { ok: false, error: "The chat didn't answer. Try again." } : result
        if (answer?.ok) progress("sociable", game, 3)
        resolve(answer || { ok: false, error: "No answer." })
      })
    })

  const toggle = layout?.controls
    ? createPortal(
        <button
          type="button"
          className={open ? "gchatToggle is-open" : "gchatToggle"}
          aria-label={unread ? `Game chat, ${unread} unread` : "Game chat"}
          title="Game chat"
          aria-pressed={open}
          // don't take focus from the game (its keys keep working)
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen(!open)}
        >
          <BubbleIcon />
          {unread > 0 && !open && <span className="gchatUnread">{unread > 9 ? "9+" : unread}</span>}
        </button>,
        layout.controls
      )
    : null

  const target = !dock || !layout ? null : dock === "right" || dock === "left" ? layout.host : layout.win
  const panel =
    open && target
      ? createPortal(
          <div
            className={`gchatDock gchatDock--${dock}`}
            style={dock === "right" || dock === "left" ? { width: DRAWER_W } : undefined}
            // a press on the drawer brings its window forward, like a press inside it
            onPointerDownCapture={dock === "right" || dock === "left" ? () => layout.win.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })) : undefined}
            // typing here is chat, not game keys (the portal's events bubble to the game)
            onKeyDown={stop}
            onKeyUp={stop}
            onKeyPress={stop}
          >
            <Suspense fallback={<div className="gchatLoading">Loading chat...</div>}>
              <Panel
                game={game}
                room={room}
                title={title}
                mode={mode}
                messages={messages.filter((m) => !hidden.has(m.id))}
                count={count}
                me={net.me}
                joined={joined}
                error={error}
                prefs={p}
                dock={dock}
                onSend={send}
                onHide={(id) => setHidden((s) => new Set(s).add(id))}
                onClose={() => setOpen(false)}
              />
            </Suspense>
          </div>,
          target
        )
      : null

  const tickerEl =
    ticker && !open && layout?.win
      ? createPortal(
          <button type="button" className="gchatTicker" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(true)} title="Open the chat">
            <b>{ticker.from}:</b> {ticker.text}
          </button>,
          layout.win
        )
      : null

  return (
    <>
      <span ref={anchor} className="gchatAnchor" hidden />
      {toggle}
      {panel}
      {tickerEl}
    </>
  )
}

const GameChat = ({ game, room, mode, title }) => {
  const p = useChatPrefs()
  const net = useNet()
  if (!chatOn(p, game) || !net?.socket) return null
  const name = room || `lobby:${game}`
  return <ChatHost key={name} game={game} room={name} mode={mode || (name.startsWith("match:") ? "match" : "lobby")} title={title || game} net={net} />
}

export default GameChat
