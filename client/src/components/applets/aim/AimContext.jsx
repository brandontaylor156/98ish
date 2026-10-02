import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react"
import { playSound } from "./sounds"
import "./Aim.css"

// One 98 Messenger session shared by every Messenger window: the Buddy List ("98 Messenger"),
// Instant Message windows, chat rooms, Buddy Info and chat invitations.

export const BUDDY_LIST = "98 Messenger"
export const AIM_ICON = "/assets/program_icons/aim2-48.png"
export const BOT_NAME = "SmarterChild"
export const LOBBY = "98ish Lobby"
export const FONTS = ["Times New Roman", "Arial", "Comic Sans MS", "Courier New", "Verdana"]
export const SIZES = [10, 12, 14, 18, 24]

export const keyOf = (screenName) => String(screenName || "").replace(/\s+/g, "").toLowerCase()

const IDLE_AFTER_MS = 10 * 60_000
const DOOR_ICON_MS = 10_000 // buddies who just signed on/off show a door this long
const MAX_MESSAGES = 300
const PREFS_KEY = "98ish.aim.prefs"

const DEFAULT_PREFS = {
  sound: true,
  lastScreenName: "",
  style: { font: "Arial", size: 12, color: "#000000", bold: false, italic: false, underline: false },
}

const loadPrefs = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY))
    return { ...DEFAULT_PREFS, ...saved, style: { ...DEFAULT_PREFS.style, ...saved?.style } }
  } catch {
    return DEFAULT_PREFS
  }
}

const savePrefs = (prefs) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Private mode etc.: prefs last for this visit only
  }
}

const initialState = {
  status: "signedOff", // signedOff | signingOn | online
  connected: true,
  error: null,
  me: null,
  presence: {}, // key -> { screenName, online, away, idleSince, warning, signOnAt, bot, change, changeAt }
  convos: {}, // key -> { screenName, messages, typing }
  rooms: {}, // key -> { name, members, messages }
}

const append = (list, item) => [...list, item].slice(-MAX_MESSAGES)

const reducer = (state, action) => {
  switch (action.type) {
    case "signingOn":
      return { ...state, status: "signingOn", error: null }
    case "signOnFailed":
      return { ...state, status: "signedOff", error: action.error }
    case "signedOn": {
      const presence = {}
      for (const p of action.online) presence[keyOf(p.screenName)] = { ...p, change: null }
      return { ...initialState, status: "online", me: { ...action.me, away: null }, presence }
    }
    case "resumed": {
      const presence = {}
      for (const p of action.online) presence[keyOf(p.screenName)] = { ...p, change: null }
      return { ...state, connected: true, me: { ...state.me, ...action.me, away: state.me?.away ?? null }, presence }
    }
    case "signedOff":
      return { ...initialState, error: action.error || null }
    case "connection":
      return { ...state, connected: action.connected }
    case "me":
      return { ...state, me: { ...state.me, ...action.patch } }
    case "presence": {
      const key = keyOf(action.presence.screenName)
      const prev = state.presence[key]
      const wasOnline = !!prev?.online
      const change = action.presence.online === wasOnline ? prev?.change : action.presence.online ? "on" : "off"
      return {
        ...state,
        presence: {
          ...state.presence,
          [key]: { ...prev, ...action.presence, change, changeAt: change !== prev?.change ? Date.now() : prev?.changeAt },
        },
      }
    }
    case "settleDoor": {
      const p = state.presence[action.key]
      if (!p?.change || Date.now() - p.changeAt < DOOR_ICON_MS) return state
      return { ...state, presence: { ...state.presence, [action.key]: { ...p, change: null } } }
    }
    case "message": {
      const key = keyOf(action.screenName)
      const convo = state.convos[key] || { screenName: action.screenName, messages: [], typing: "none" }
      return {
        ...state,
        convos: {
          ...state.convos,
          [key]: {
            ...convo,
            screenName: action.message.mine || action.message.system ? convo.screenName : action.screenName,
            messages: append(convo.messages, action.message),
            typing: action.message.mine || action.message.system ? convo.typing : "none",
          },
        },
      }
    }
    case "typing": {
      const key = keyOf(action.screenName)
      const convo = state.convos[key] || { screenName: action.screenName, messages: [], typing: "none" }
      return { ...state, convos: { ...state.convos, [key]: { ...convo, typing: action.state } } }
    }
    case "room": {
      const key = keyOf(action.room)
      const room = state.rooms[key] || { name: action.room, members: [], messages: [] }
      const next = { ...room, name: action.room }
      if (action.members) next.members = action.members
      if (action.message) next.messages = append(room.messages, action.message)
      return { ...state, rooms: { ...state.rooms, [key]: next } }
    }
    case "roomLeft": {
      const rooms = { ...state.rooms }
      delete rooms[keyOf(action.room)]
      return { ...state, rooms }
    }
    default:
      return state
  }
}

const AimContext = createContext(null)
export const useAim = () => useContext(AimContext)

export const AimProvider = ({ socket, windows, dispatch: dispatchWindow, onOpenVideo, children }) => {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [prefs, setPrefsState] = useState(loadPrefs)

  // Socket handlers are registered once and read the latest values through refs
  const stateRef = useRef(state)
  const prefsRef = useRef(prefs)
  const windowsRef = useRef(windows)
  const tokenRef = useRef(null)
  const pendingWindows = useRef(new Set())
  stateRef.current = state
  prefsRef.current = prefs
  windowsRef.current = windows

  useEffect(() => pendingWindows.current.clear(), [windows])

  const sound = (name) => prefsRef.current.sound && playSound(name)

  const setPrefs = (patch) =>
    setPrefsState((current) => {
      const next = { ...current, ...patch, style: { ...current.style, ...patch.style } }
      savePrefs(next)
      return next
    })

  // ---- windows ----

  // Floating windows cascade to the right of the Buddy List instead of on top of it
  const cascadeX = () => 280 + (windowsRef.current.filter((w) => !w.closed && w.app?.startsWith("aim-")).length % 6) * 24

  // Open a window, or bring forward the one already showing the same thing (`id`)
  const openWindow = (id, payload, { focus = true } = {}) => {
    const x = cascadeX()
    const index = windowsRef.current.findIndex((w) => !w.closed && w.aimId === id)
    if (index >= 0) {
      if (focus) dispatchWindow({ type: "focus_window", payload: { index } })
      return
    }
    if (pendingWindows.current.has(id)) return
    pendingWindows.current.add(id)
    dispatchWindow({
      type: "open_window",
      payload: {
        minimized: false,
        maximized: false,
        active: true,
        closed: false,
        positionY: 40,
        icon_url: AIM_ICON,
        initialX: x,
        aimId: id,
        ...payload,
      },
    })
  }

  const closeWindows = (predicate) =>
    windowsRef.current.forEach((w, index) => {
      if (!w.closed && predicate(w)) dispatchWindow({ type: "close_window", payload: { name: w.name, index } })
    })

  const displayName = (screenName) => stateRef.current.presence[keyOf(screenName)]?.screenName || screenName

  // focus: false for windows popped open by an incoming IM (don't grab the cursor)
  const openIm = (screenName, { focus = true } = {}) => {
    const name = displayName(screenName)
    openWindow(
      `im:${keyOf(name)}`,
      { name: `${name} - Instant Message`, app: "aim-im", buddy: name, width: 430, height: 400, focusInput: focus },
      { focus }
    )
  }

  const openInfo = (screenName) => {
    const name = displayName(screenName)
    openWindow(`info:${keyOf(name)}`, { name: `Buddy Info: ${name}`, app: "aim-info", buddy: name, width: 340, height: 380 })
  }

  const openRoomWindow = (room) =>
    openWindow(`chat:${keyOf(room)}`, { name: `Chat: ${room}`, app: "aim-chat", room, width: 540, height: 420 })

  // ---- session ----

  const finishSignOff = (error) => {
    tokenRef.current = null
    closeWindows((w) => w.app?.startsWith("aim-"))
    dispatch({ type: "signedOff", error })
  }

  const signOn = (screenName, password, register) =>
    new Promise((resolve) => {
      dispatch({ type: "signingOn" })
      socket.timeout(15_000).emit("aim:signOn", { screenName, password, register }, (timeout, result) => {
        if (timeout || !result?.ok) {
          const error = timeout ? "Could not connect to the 98 Messenger service. Please try again." : result.error
          dispatch({ type: "signOnFailed", error })
          return resolve(false)
        }
        tokenRef.current = result.token
        setPrefs({ lastScreenName: result.me.screenName })
        dispatch({ type: "signedOn", me: result.me, online: result.online })
        sound("doorOpen")
        resolve(true)
      })
    })

  const signOff = () => {
    if (stateRef.current.status === "online") {
      socket.emit("aim:signOff")
      sound("doorClose")
    }
    finishSignOff(null)
  }

  // Closing the Buddy List signs you off, like the real thing
  useEffect(() => {
    if (state.status === "online" && !windows.some((w) => !w.closed && w.name === BUDDY_LIST)) signOff()
  }, [windows, state.status])

  // Closing a chat room's window leaves the room
  useEffect(() => {
    for (const room of Object.values(state.rooms)) {
      const open = windows.some((w) => !w.closed && w.app === "aim-chat" && keyOf(w.room) === keyOf(room.name))
      if (!open) leaveRoom(room.name)
    }
  }, [windows])

  // ---- server events ----

  useEffect(() => {
    const inBuddyList = (screenName) =>
      stateRef.current.me?.groups.some((g) => g.buddies.some((b) => keyOf(b) === keyOf(screenName)))

    const time = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })

    const handlers = {
      "aim:presence": (presence) => {
        const key = keyOf(presence.screenName)
        const wasOnline = !!stateRef.current.presence[key]?.online
        dispatch({ type: "presence", presence })
        if (presence.online === wasOnline) return
        if (inBuddyList(presence.screenName)) sound(presence.online ? "doorOpen" : "doorClose")
        if (stateRef.current.convos[key]) {
          dispatch({
            type: "message",
            screenName: presence.screenName,
            message: { system: true, text: `${presence.screenName} signed ${presence.online ? "on" : "off"} at ${time()}.`, time: Date.now() },
          })
        }
        setTimeout(() => dispatch({ type: "settleDoor", key }), DOOR_ICON_MS + 50)
      },
      "aim:im": (message) => {
        dispatch({ type: "message", screenName: message.from, message })
        sound("imReceive")
        openIm(message.from, { focus: false })
      },
      "aim:typing": ({ from, state: typing }) => dispatch({ type: "typing", screenName: from, state: typing }),
      "aim:warned": ({ by, warning }) => {
        dispatch({ type: "me", patch: { warning } })
        openWindow(`notice:${Date.now()}`, {
          name: "98 Messenger Warning",
          app: "aim-notice",
          text: `You have been warned by ${by || "an anonymous user"}. Your new warning level is ${warning}%.`,
          width: 320,
          height: 170,
        })
      },
      "aim:kicked": ({ reason }) => finishSignOff(reason),
      "aim:chat": (message) => dispatch({ type: "room", room: message.room, message }),
      "aim:chatMembers": ({ room, members }) => dispatch({ type: "room", room, members }),
      "aim:chatInvite": (invite) => {
        sound("imReceive")
        openWindow(`invite:${keyOf(invite.room)}:${keyOf(invite.from)}`, {
          name: "Buddy Chat Invitation",
          app: "aim-invite",
          invite,
          width: 340,
          height: 230,
        })
      },
      connect: () => {
        dispatch({ type: "connection", connected: true })
        if (stateRef.current.status !== "online" || !tokenRef.current) return
        socket.emit("aim:resume", { token: tokenRef.current }, (result) => {
          if (result?.ok) dispatch({ type: "resumed", me: result.me, online: result.online })
          else finishSignOff("Your connection to the 98 Messenger service was lost. Please sign on again.")
        })
      },
      disconnect: () => dispatch({ type: "connection", connected: false }),
    }

    for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler)
    return () => {
      for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler)
    }
  }, [socket])

  // ---- idle: no input for 10 minutes ----

  useEffect(() => {
    if (state.status !== "online") return
    let last = Date.now()
    let idle = false
    const active = () => {
      last = Date.now()
      if (idle) {
        idle = false
        socket.emit("aim:setIdle", { idle: false })
      }
    }
    const events = ["pointerdown", "keydown", "pointermove"]
    events.forEach((e) => window.addEventListener(e, active, { passive: true }))
    const timer = setInterval(() => {
      if (!idle && Date.now() - last > IDLE_AFTER_MS) {
        idle = true
        socket.emit("aim:setIdle", { idle: true })
      }
    }, 30_000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, active))
      clearInterval(timer)
    }
  }, [state.status, socket])

  // ---- actions ----

  const request = (event, payload) =>
    new Promise((resolve) =>
      socket.timeout(15_000).emit(event, payload, (timeout, result) =>
        resolve(timeout ? { ok: false, error: "The 98 Messenger service did not respond." } : result)
      )
    )

  const sendIm = async (screenName, text) => {
    const style = prefsRef.current.style
    const message = { from: stateRef.current.me.screenName, text, style, time: Date.now(), mine: true }
    dispatch({ type: "message", screenName, message })
    sound("imSend")
    const result = await request("aim:im", { to: screenName, text, style })
    if (!result.ok) {
      dispatch({ type: "message", screenName, message: { system: true, error: true, text: result.error, time: Date.now() } })
    }
    return result
  }

  const setAway = async (message) => {
    const result = await request("aim:setAway", { message: message || "" })
    if (result.ok) dispatch({ type: "me", patch: { away: message || null } })
    return result
  }

  const setProfile = async (profile) => {
    const result = await request("aim:setProfile", { profile })
    if (result.ok) dispatch({ type: "me", patch: { profile: result.profile } })
    return result
  }

  const saveGroups = async (groups) => {
    const previous = stateRef.current.me.groups
    dispatch({ type: "me", patch: { groups } })
    const result = await request("aim:saveGroups", { groups })
    dispatch({ type: "me", patch: { groups: result.ok ? result.groups : previous } })
    return result
  }

  const block = async (screenName, blocked) => {
    const result = await request("aim:block", { screenName, blocked })
    if (result.ok) dispatch({ type: "me", patch: { blocked: result.blocked } })
    return result
  }

  const joinRoom = async (room) => {
    const result = await request("aim:chatJoin", { room })
    if (result.ok) {
      dispatch({ type: "room", room: result.room, members: result.members })
      openRoomWindow(result.room)
    }
    return result
  }

  const leaveRoom = (room) => {
    socket.emit("aim:chatLeave", { room })
    dispatch({ type: "roomLeft", room })
  }

  const say = (room, text) => request("aim:chatSay", { room, text, style: prefsRef.current.style })

  // YouTube '98's Share button: post the video to the 98ish Lobby chat room
  const shareVideo = async (url) => {
    if (stateRef.current.status !== "online") return { ok: false, error: "Sign on to 98 Messenger to share videos." }
    const joined = await joinRoom(LOBBY)
    if (!joined.ok) return joined
    return say(LOBBY, url)
  }

  const value = {
    ...state,
    prefs,
    setPrefs,
    signOn,
    signOff,
    sendIm,
    typing: (screenName, typing) => socket.emit("aim:typing", { to: screenName, state: typing }),
    setAway,
    setProfile,
    saveGroups,
    block,
    warn: (screenName, anonymous) => request("aim:warn", { to: screenName, anonymous }),
    getInfo: (screenName) => request("aim:getInfo", { screenName }),
    joinRoom,
    leaveRoom,
    say,
    invite: (room, to, message) => request("aim:chatInvite", { room, to, message }),
    shareVideo,
    openIm,
    openInfo,
    openVideo: onOpenVideo,
  }

  return <AimContext.Provider value={value}>{children}</AimContext.Provider>
}

// Buddy List rows: each group's buddies with their presence, plus an Offline group
export const useBuddyGroups = () => {
  const { me, presence } = useAim()
  return useMemo(() => {
    if (!me) return []
    const offline = []
    const groups = me.groups.map((group) => {
      const buddies = []
      for (const screenName of group.buddies) {
        const p = presence[keyOf(screenName)]
        const buddy = { screenName: p?.screenName || screenName, ...p, online: !!p?.online }
        // Just signed off: stay in the group with a closed door for a few seconds
        if (buddy.online || buddy.change === "off") buddies.push(buddy)
        else offline.push(buddy)
      }
      const online = buddies.filter((b) => b.online).length
      return { name: group.name, buddies, online, total: group.buddies.length }
    })
    return [...groups, { name: "Offline", buddies: offline, online: offline.length, total: offline.length, offline: true }]
  }, [me, presence])
}
