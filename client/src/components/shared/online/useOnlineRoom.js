import { useEffect, useRef, useState } from "react"
import { useNet } from "../../applets/network/NetContext"
import { programs } from "../../../utils/programs"

// The browser side of the online room system (server/arcade/rooms.js). See index.js for
// the guide. useOnlineRoom(gameId) keeps this window's room and talks to the server over
// the shared Network Neighborhood connection; useServerStatus() says whether that
// connection is up, still waking (the free server sleeps), or down.

const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000"
const WAKE_MS = 90_000 // a sleeping server takes 30-50 seconds to wake up; give it 90

// The program (utils/programs.js) that plays an online game: its entry has `online: "<id>"`
export const onlineProgram = (gameId) => programs.find((p) => p.online === gameId) || null

// ---------- join links and invitations that arrive before the game's window ----------

let pendingJoin = null // { game, code } | { game, roomId }
export const setPendingJoin = (join) => {
  pendingJoin = join
  window.dispatchEvent(new CustomEvent("98ish:online-join", { detail: join }))
}
const takePendingJoin = (game) => {
  if (pendingJoin?.game !== game) return null
  const join = pendingJoin
  pendingJoin = null
  return join
}

// "https://98ish.../?join=K7QX" opens the game and joins the room
export const joinLink = (code) => {
  const url = new URL(window.location.href)
  url.search = `?join=${encodeURIComponent(code)}`
  url.hash = ""
  return url.toString()
}

// ---------- is the server there? ----------

let wakeStart = Date.now()
let seenOnline = false
let poked = false
// a plain request helps a sleeping server wake up (socket.io keeps retrying on its own)
const poke = () => {
  if (poked) return
  poked = true
  fetch(SERVER_URL, { mode: "no-cors", cache: "no-store" }).catch(() => {})
}

// -> { state, online, text, retry }
//    state: online | connecting | waking | reconnecting | no-internet | offline
export const useServerStatus = () => {
  const net = useNet()
  const [now, setNow] = useState(() => Date.now())
  const status = net?.status || "offline"
  if (status === "online") seenOnline = true
  useEffect(() => {
    if (status === "online") return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [status])
  const browserOffline = typeof navigator !== "undefined" && navigator.onLine === false
  const waited = now - wakeStart
  let state = "online"
  if (!net) state = "offline"
  else if (status !== "online") {
    if (browserOffline) state = "no-internet"
    else if (seenOnline) state = "reconnecting"
    else if (waited < 4000) state = "connecting"
    else if (waited < WAKE_MS) state = "waking"
    else state = "offline"
  }
  if (state === "waking") poke()
  const text = {
    online: "Connected to the game server.",
    connecting: "Connecting to the game server...",
    waking: "Waking up the game server... When nobody has played for a while it takes up to a minute. Hang tight!",
    reconnecting: "Lost the connection to the game server. Reconnecting...",
    "no-internet": "You're not connected to the internet. Check your connection, then try again.",
    offline: "Can't reach the game server right now. Check your internet connection and try again in a minute.",
  }[state]
  const retry = () => {
    wakeStart = Date.now()
    poked = false
    setNow(Date.now())
    if (net?.socket && !net.socket.connected) net.socket.connect()
  }
  return { state, online: state === "online", text, retry, seconds: Math.floor(waited / 1000) }
}

// ---------- the room ----------

export const useOnlineRoom = (gameId) => {
  const net = useNet()
  const server = useServerStatus()
  const socket = net?.socket
  const [room, setRoomState] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null) // "The host removed you from the room."
  const [busy, setBusy] = useState(null) // which button is waiting: quick | create | join | computer | ...
  const roomRef = useRef(null)
  const offset = useRef(0) // server clock - our clock
  const listeners = useRef({ snap: new Set(), input: new Set(), relay: new Set() })

  const setRoom = (next) => {
    roomRef.current = next
    setRoomState(next)
  }

  const request = (event, payload) => (net ? net.request(event, payload) : Promise.resolve({ ok: false, error: "You aren't connected to the network." }))

  const call = async (event, payload, key = event) => {
    setError(null)
    setNotice(null)
    setBusy(key)
    const result = await request(event, payload)
    setBusy(null)
    if (!result.ok) setError(result.error)
    return result
  }

  const join = (where, key = "join") => call("room:join", where, key)

  // the server's word on our room, and relayed messages
  useEffect(() => {
    if (!socket) return
    const handlers = {
      "room:state": (view) => {
        if (view.game !== gameId) return
        const current = roomRef.current
        if (current && current.id === view.id && view.rev < current.rev) return // out of order
        offset.current = view.now - Date.now()
        setRoom(view)
      },
      "room:gone": ({ roomId, reason }) => {
        if (roomRef.current?.id !== roomId) return
        setRoom(null)
        if (reason) setNotice(reason)
      },
      // an accepted invitation let us in: take the seat
      "room:invited": ({ roomId, game }) => {
        if (game === gameId && roomRef.current?.id !== roomId) join({ roomId })
      },
      "room:snap": ({ roomId, data }) => roomId === roomRef.current?.id && listeners.current.snap.forEach((fn) => fn(data)),
      "room:input": ({ roomId, from, data }) => roomId === roomRef.current?.id && listeners.current.input.forEach((fn) => fn(data, from)),
      "room:relay": ({ roomId, from, data }) => roomId === roomRef.current?.id && listeners.current.relay.forEach((fn) => fn(data, from)),
    }
    for (const [event, fn] of Object.entries(handlers)) socket.on(event, fn)
    return () => {
      for (const [event, fn] of Object.entries(handlers)) socket.off(event, fn)
    }
  }, [socket, gameId])

  // (Re)connected: get our room back, or a pending invitation or join link
  useEffect(() => {
    if (net?.status !== "online") return
    let live = true
    request("room:hello", { game: gameId }).then((result) => {
      if (!live) return
      const pending = takePendingJoin(gameId)
      if (pending) join(pending.code ? { code: pending.code } : { roomId: pending.roomId })
      else if (result.ok && result.invited) join({ roomId: result.invited })
      else if (result.ok && !result.roomId && roomRef.current) setRoom(null) // our room closed while we were away
    })
    return () => {
      live = false
    }
  }, [net?.status, gameId])

  // a join link opened while this window was already open
  useEffect(() => {
    const onJoin = (e) => {
      if (e.detail?.game !== gameId || net?.status !== "online") return
      const pending = takePendingJoin(gameId)
      if (pending) join(pending.code ? { code: pending.code } : { roomId: pending.roomId })
    }
    window.addEventListener("98ish:online-join", onJoin)
    return () => window.removeEventListener("98ish:online-join", onJoin)
  }, [gameId, net?.status])

  // Closing the window leaves the room (a computer player takes over a game in progress)
  useEffect(
    () => () => {
      const id = roomRef.current?.id
      if (id && net) net.socket.emit("room:leave", { roomId: id })
    },
    []
  )

  // dev tests: drop the connection for a moment, read the room
  if (import.meta.env.DEV && socket) window.__online = { socket, room: () => roomRef.current }

  const roomId = () => roomRef.current?.id
  const on = (kind) => (fn) => {
    listeners.current[kind].add(fn)
    return () => listeners.current[kind].delete(fn)
  }

  const leave = async () => {
    const id = roomId()
    setRoom(null)
    setError(null)
    if (id) await request("room:leave", { roomId: id })
  }

  return {
    gameId,
    net,
    server,
    connected: server.online,
    me: net?.me || null,
    room,
    phase: room?.phase || null,
    seat: room?.you ?? null,
    isHost: !!room?.host,
    spectator: !!room?.spectator,
    view: room?.view ?? null,
    // for <GameChat room={online.chatRoom} />
    chatRoom: room ? `match:${room.id}` : undefined,
    error,
    setError,
    notice,
    clearNotice: () => setNotice(null),
    busy,
    serverNow: () => Date.now() + offset.current,

    quickMatch: (settings) => call("room:quick", { game: gameId, settings }, "quick"),
    createRoom: (settings) => call("room:create", { game: gameId, settings }, "create"),
    joinCode: (code) => join({ code }),
    joinRoom: (id) => join({ roomId: id }),
    // a private room, computer players in every other seat, and go
    playComputer: async (settings) => {
      const made = await call("room:create", { game: gameId, settings }, "computer")
      if (!made.ok) return made
      const bots = await call("room:bots", { roomId: made.roomId }, "computer")
      if (!bots.ok) return bots
      return call("room:start", { roomId: made.roomId }, "computer")
    },
    leave,
    setReady: (ready) => call("room:ready", { roomId: roomId(), ready }, "ready"),
    setSettings: (settings) => call("room:settings", { roomId: roomId(), settings }, "settings"),
    start: () => call("room:start", { roomId: roomId() }, "start"),
    kick: (seat) => call("room:kick", { roomId: roomId(), seat }, "kick"),
    fillBots: () => call("room:bots", { roomId: roomId() }, "bots"),
    rematch: () => call("room:rematch", { roomId: roomId() }, "rematch"),
    backToLobby: () => call("room:lobby", { roomId: roomId() }, "lobby"),
    // a move: -> { ok } or { ok: false, error } (shown by the game, not in `error`)
    act: (action) => request("room:act", { roomId: roomId(), action }),
    // invite someone from the network list ({ id }) or a buddy ({ screenName }) into this room
    invite: (to) => request("net:invite", { to, game: gameId, matchId: roomId() }),

    // real-time (relay) games: the host streams snapshots, guests send inputs
    sendSnap: (data) => roomId() && socket?.connected && socket.volatile.emit("room:snap", { roomId: roomId(), data }),
    sendInput: (data) => roomId() && socket?.connected && socket.volatile.emit("room:input", { roomId: roomId(), data }),
    sendRelay: (data, to) => request("room:relay", { roomId: roomId(), data, to }),
    finish: (result) => request("room:finish", { roomId: roomId(), result }),
    // subscribe: each returns an unsubscribe function. onInput's fn gets (data, fromSeat)
    onSnap: on("snap"),
    onInput: on("input"),
    onRelay: on("relay"),
  }
}
