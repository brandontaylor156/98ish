import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react"
import { playSound } from "./sounds"
import "./Aim.css"
import { unlock } from "../../../utils/achievements"
import { launch } from "../../../utils/programs"
import { getNotifications, interrupts, notify } from "../../../utils/notifications"
import { notifyLocked } from "../../../utils/lock"
import { currentUser } from "../../../utils/users"
import { registerSearchProvider } from "../../../utils/searchIndex"
import { applyReaction, fromServer, isTemp, mergeMessages, previewText, roomCk, sendFailure, tempId } from "./history/historyCore"
import * as historyDb from "./history/historyDb"
import { attachTogether, handleTogetherEvent, TOGETHER_EVENTS } from "../together/togetherStore"

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
    // a 98ish user with a linked screen name finds it filled in at Sign On
    const linked = currentUser()?.screenName || ""
    return { ...DEFAULT_PREFS, ...saved, lastScreenName: saved?.lastScreenName || linked, style: { ...DEFAULT_PREFS.style, ...saved?.style } }
  } catch {
    return DEFAULT_PREFS
  }
}

// "Remember me": { screenName, token } of this device's sign-on token (the server keeps
// only a hash), so a phone that reloads the page or drops the connection signs on again
const REMEMBER_KEY = "98ish.aim.remember"
const loadRemembered = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(REMEMBER_KEY))
    return saved?.screenName && saved?.token ? saved : null
  } catch {
    return null
  }
}
const saveRemembered = (saved) => {
  try {
    if (saved) localStorage.setItem(REMEMBER_KEY, JSON.stringify(saved))
    else localStorage.removeItem(REMEMBER_KEY)
  } catch {
    // storage blocked: sign on each visit
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
  // ck (the other person's key) -> { screenName, messages, typing, loaded, older }
  // (messages: history/historyCore.js; loaded: this device's saved copy is in; older: there
  // may be more to scroll back to)
  convos: {},
  rooms: {}, // key -> { name, members, messages, loaded, older }
  reads: {}, // ck -> { at, when }: the newest message they've seen ("Read 10:42 PM")
}

// a long conversation keeps this many in memory while new ones arrive (scrolling back loads
// older ones again from the device)
const trimTail = (list) => (list.length > MAX_MESSAGES * 3 ? list.slice(-MAX_MESSAGES * 2) : list)
const sysId = () => `s-${Math.random().toString(36).slice(2, 10)}`

// a message (or several) into one conversation's list, by id
const withMessages = (convo, messages, { older = false } = {}) => {
  const merged = mergeMessages(convo.messages, messages)
  return older ? merged : trimTail(merged)
}

const updateIn = (list, id, fn) => {
  const i = list.findIndex((m) => m.id === id)
  if (i < 0) return list
  const next = [...list]
  next[i] = fn(next[i])
  return next
}

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
    // messages into a two-person conversation: { ck, screenName?, messages, older?, patch? }
    case "messages": {
      const convo = state.convos[action.ck] || { screenName: action.screenName || action.ck, messages: [], typing: "none", older: true }
      const incoming = action.messages || []
      const theirs = incoming.some((m) => !m.mine && !m.system && !action.older)
      return {
        ...state,
        convos: {
          ...state.convos,
          [action.ck]: {
            ...convo,
            ...(action.patch || {}),
            screenName: theirs && action.screenName ? action.screenName : convo.screenName,
            messages: withMessages(convo, incoming, action),
            typing: theirs ? "none" : convo.typing,
          },
        },
      }
    }
    // one message changes (its id once the server answers, a reaction, "Delivered")
    case "update": {
      const roomKey = action.ck.startsWith("#") ? action.ck.slice(1) : null
      if (roomKey) {
        const room = state.rooms[roomKey]
        if (!room) return state
        return { ...state, rooms: { ...state.rooms, [roomKey]: { ...room, messages: updateIn(room.messages, action.id, action.fn) } } }
      }
      const convo = state.convos[action.ck]
      if (!convo) return state
      return { ...state, convos: { ...state.convos, [action.ck]: { ...convo, messages: updateIn(convo.messages, action.id, action.fn) } } }
    }
    case "remove": {
      const convo = state.convos[action.ck]
      if (!convo) return state
      return { ...state, convos: { ...state.convos, [action.ck]: { ...convo, messages: convo.messages.filter((m) => m.id !== action.id) } } }
    }
    // "Clear history" here or on another device: everything up to `upTo` goes
    case "cleared": {
      const keep = (list) => list.filter((m) => m.time > action.upTo)
      if (action.ck.startsWith("#")) {
        const key = action.ck.slice(1)
        const room = state.rooms[key]
        return room ? { ...state, rooms: { ...state.rooms, [key]: { ...room, messages: keep(room.messages), older: false } } } : state
      }
      const convo = state.convos[action.ck]
      return convo ? { ...state, convos: { ...state.convos, [action.ck]: { ...convo, messages: keep(convo.messages), older: false } } } : state
    }
    case "reads":
      return { ...state, reads: action.replace ? action.reads : { ...state.reads, ...action.reads } }
    case "typing": {
      const key = keyOf(action.screenName)
      const convo = state.convos[key] || { screenName: action.screenName, messages: [], typing: "none", older: true }
      return { ...state, convos: { ...state.convos, [key]: { ...convo, typing: action.state } } }
    }
    case "room": {
      const key = keyOf(action.room)
      const room = state.rooms[key] || { name: action.room, members: [], messages: [], older: true }
      const next = { ...room, name: action.room, ...(action.patch || {}) }
      if (action.members) next.members = action.members
      if (action.message) next.messages = withMessages(room, [action.message])
      if (action.messages) next.messages = withMessages(room, action.messages, action)
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

// Voice and video calls: their own download, loaded while signed on
const CallManager = React.lazy(() => import("./call/CallManager"))
const CALL_EVENTS = ["aim:callRing", "aim:callAnswered", "aim:callSignal", "aim:callMedia", "aim:callEnd", "aim:callMissed"]

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

  // Call events wait here until the call code has loaded (a ring right after signing on)
  const callListener = useRef(null)
  const callBacklog = useRef([])
  const onCall = (fn) => {
    callListener.current = fn
    const backlog = callBacklog.current
    callBacklog.current = []
    backlog.forEach(([event, payload]) => fn(event, payload))
    return () => {
      if (callListener.current === fn) callListener.current = null
    }
  }

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
    // (Delete My Account's window stays: it shows how the deletion went)
    closeWindows((w) => w.app?.startsWith("aim-") && w.app !== "aim-delete")
    dispatch({ type: "signedOff", error })
  }

  // Delete My Account (server/account): the password again; the server signs this account off
  // everywhere and deletes everything it keeps for it. -> { ok, screenName } | { ok: false,
  // error, retry? (signed off and partly deleted: asking again finishes it) }
  const deleteAccount = (screenName, password) =>
    new Promise((resolve) => {
      socket.timeout(90_000).emit("aim:deleteAccount", { screenName, password }, (timeout, result) => {
        if (timeout) return resolve({ ok: false, retry: true, error: "The 98 Messenger service didn't answer in time. Your account may be partly deleted: choose Delete Account again to finish." })
        if (result?.ok || result?.retry) {
          // signed off by the server; this device stops signing on by itself
          autoTried.current = true
          saveRemembered(null)
          if (stateRef.current.status !== "signedOff") finishSignOff(null)
        }
        resolve(result || { ok: false, error: "Something went wrong. Please try again." })
      })
    })

  const openDeleteAccount = () => openWindow("delete-account", { name: "Delete My Account", app: "aim-delete", width: 460, height: 640, initialX: 120, positionY: 20 })

  const signOn = (screenName, password, register, remember = prefsRef.current.remember !== false) =>
    new Promise((resolve) => {
      dispatch({ type: "signingOn" })
      socket.timeout(15_000).emit("aim:signOn", { screenName, password, register, remember }, (timeout, result) => {
        if (timeout || !result?.ok) {
          const error = timeout ? "Could not connect to the 98 Messenger service. Please try again." : result.error
          dispatch({ type: "signOnFailed", error })
          return resolve(false)
        }
        tokenRef.current = result.token
        saveRemembered(remember && result.remember ? { screenName: result.me.screenName, token: result.remember } : null)
        setPrefs({ lastScreenName: result.me.screenName, remember })
        dispatch({ type: "signedOn", me: result.me, online: result.online })
        sound("doorOpen")
        resolve(true)
      })
    })

  // Sign on with this device's remembered token (no password); quietly gives up if the
  // server doesn't know it any more. The Buddy List opens minimized if it isn't open.
  const autoSignOn = () =>
    new Promise((resolve) => {
      const saved = loadRemembered()
      if (!saved) return resolve(false)
      const wasOnline = stateRef.current.status === "online"
      if (!wasOnline) dispatch({ type: "signingOn" })
      socket.timeout(15_000).emit("aim:signOnRemembered", saved, (timeout, result) => {
        if (timeout || !result?.ok) {
          if (!timeout) saveRemembered(null)
          if (!wasOnline) dispatch({ type: "signOnFailed", error: null })
          return resolve(false)
        }
        tokenRef.current = result.token
        if (!windowsRef.current.some((w) => !w.closed && w.name === BUDDY_LIST)) {
          dispatchWindow({ type: "open_window", payload: launch(BUDDY_LIST, { minimized: true, active: false }) })
        }
        dispatch({ type: "signedOn", me: result.me, online: result.online })
        resolve(true)
      })
    })

  const signOff = () => {
    if (stateRef.current.status === "online") {
      // signing off on purpose: this device stops signing on by itself
      const saved = loadRemembered()
      if (saved) socket.emit("aim:forget", { token: saved.token })
      saveRemembered(null)
      socket.emit("aim:signOff")
      sound("doorClose")
    }
    finishSignOff(null)
  }

  // once per page load, when the socket is up: a remembered device signs on by itself
  const autoTried = useRef(false)
  const tryAutoSignOn = () => {
    if (autoTried.current || stateRef.current.status !== "signedOff" || !loadRemembered()) return
    autoTried.current = true
    autoSignOn()
  }
  useEffect(() => {
    if (socket.connected) tryAutoSignOn()
  }, [socket])

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
        // (Do Not Disturb: the doors stay quiet)
        if (inBuddyList(presence.screenName) && interrupts("im")) sound(presence.online ? "doorOpen" : "doorClose")
        if (stateRef.current.convos[key]) {
          dispatch({
            type: "messages",
            ck: key,
            messages: [{ id: sysId(), system: true, text: `${presence.screenName} signed ${presence.online ? "on" : "off"} at ${time()}.`, time: Date.now() }],
          })
        }
        setTimeout(() => dispatch({ type: "settleDoor", key }), DOOR_ICON_MS + 50)
      },
      "aim:im": (raw) => {
        const key = keyOf(raw.from)
        const message = fromServer(raw, { meKey: myKey(), ck: key, conv: raw.from })
        if (!message.id) message.id = sysId().replace("s-", "l-")
        dispatch({ type: "messages", ck: key, screenName: raw.from, messages: [message] })
        save([message])
        // Do Not Disturb: no sound and no window popping up (unless it's open already); the
        // Notification Center still gets it below
        const quiet = !interrupts("im", raw.from)
        if (!quiet) {
          sound("imReceive")
          notifyLocked() // the lock screen says only "New message"
        }
        if (!quiet || windowsRef.current.some((w) => !w.closed && w.aimId === `im:${key}`)) openIm(raw.from, { focus: false })
        // the Notification Center, unless that conversation is right in front of you (and
        // you've seen it: an item still unread keeps up)
        const inFront = document.visibilityState === "visible" && windowsRef.current.some((w) => !w.closed && w.active && !w.minimized && w.aimId === `im:${key}`)
        const waiting = getNotifications().some((n) => n.key === `im:${key}` && !n.read)
        if ((!inFront || waiting || quiet) && !raw.auto) {
          notify({ app: "im", key: `im:${key}`, title: raw.from, text: previewText(raw), time: raw.offline ? raw.time : Date.now(), target: { kind: "im", with: raw.from } })
        }
      },
      // someone reacted to a message (one reaction per person; null takes it away)
      "aim:react": ({ id, ck, key, emoji }) => {
        if (typeof id !== "string" || typeof ck !== "string") return
        dispatch({ type: "update", ck, id, fn: (m) => applyReaction(m, key, emoji) })
        historyDb.patchMessage(myKey(), id, (m) => (m.ck === ck ? applyReaction(m, key, emoji) : m))
      },
      // they've seen your messages up to `at`
      "aim:read": ({ ck, at, when }) => {
        if (typeof ck !== "string") return
        const reads = { [ck]: { at, when } }
        dispatch({ type: "reads", reads })
        historyDb.getMeta(myKey()).then((meta) => historyDb.setMeta(myKey(), { reads: { ...meta.reads, ...reads } }))
      },
      // IMs held for someone signed off reached them
      "aim:delivered": ({ ck, ids, at }) => {
        for (const id of Array.isArray(ids) ? ids : []) {
          const fn = (m) => ({ ...m, held: false, deliveredAt: at || Date.now() })
          dispatch({ type: "update", ck, id, fn })
          historyDb.patchMessage(myKey(), id, fn)
        }
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
      "aim:kicked": ({ reason, deleted }) => {
        autoTried.current = true // no signing back on (and bumping the other place) until a reload
        if (deleted) {
          // deleted from another device: this one forgets the account too (its files stay)
          const key = keyOf(stateRef.current.me?.screenName)
          saveRemembered(null)
          if (key) import("../../../utils/account").then((m) => m.forgetAccountOnDevice({ key })).catch(() => {})
        }
        finishSignOff(reason)
      },
      // a buddy (or someone blocked) deleted their account: off the lists
      "aim:accountGone": ({ groups, blocked, screenName }) => {
        if (Array.isArray(groups) && Array.isArray(blocked)) dispatch({ type: "me", patch: { groups, blocked } })
        // what this device kept with them moves to "(deleted account)": whoever takes the
        // name next starts fresh
        if (screenName) historyDb.renameConv(myKey(), keyOf(screenName), `~gone${Date.now().toString(36)}`, "(deleted account)")
      },
      "aim:chat": (raw) => {
        const message = raw.system ? { ...raw, id: sysId() } : fromServer(raw, { meKey: myKey(), ck: roomCk(raw.room), conv: `#${raw.room}` })
        if (!message.id) message.id = sysId()
        dispatch({ type: "room", room: raw.room, message })
        if (!raw.system) save([message])
      },
      "aim:chatMembers": ({ room, members }) => dispatch({ type: "room", room, members }),
      // Watch Together: a buddy (or someone in a chat room) started a video for you
      "tg:invite": (invite) => {
        if (!invite?.id) return
        const action = { kind: "together", id: invite.id, label: "Join" }
        const text = `${invite.from} started Watch Together${invite.title ? `: ${invite.title}` : ""}.`
        const quiet = !interrupts("im", invite.from)
        if (invite.room) dispatch({ type: "room", room: invite.room, message: { id: sysId(), system: true, text, time: Date.now(), action } })
        else {
          const key = keyOf(invite.from)
          dispatch({ type: "messages", ck: key, screenName: invite.from, messages: [{ id: sysId(), system: true, text, time: Date.now(), action }] })
          if (!quiet || windowsRef.current.some((w) => !w.closed && w.aimId === `im:${key}`)) openIm(invite.from, { focus: false })
        }
        if (!quiet) sound("imReceive")
        notify({
          app: "im",
          key: `tg:${invite.id}`,
          title: invite.room ? `${invite.from} in ${invite.room}` : invite.from,
          text: `Watch Together${invite.title ? `: ${invite.title}` : ""}. Tap to join.`,
          target: { kind: "program", name: "Watch Together", extra: { handoff: { id: Date.now(), together: invite.id } } },
        })
      },
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
        if (stateRef.current.status === "signedOff") return void tryAutoSignOn()
        if (stateRef.current.status !== "online" || !tokenRef.current) return
        socket.emit("aim:resume", { token: tokenRef.current }, async (result) => {
          if (result?.ok) {
            dispatch({ type: "resumed", me: result.me, online: result.online })
            return void syncHistory()
          }
          // away too long (a phone asleep): a remembered device just signs on again
          if (!(await autoSignOn())) finishSignOff("Your connection to the 98 Messenger service was lost. Please sign on again.")
        })
      },
      disconnect: () => dispatch({ type: "connection", connected: false }),
    }
    for (const event of TOGETHER_EVENTS) handlers[event] = (payload) => handleTogetherEvent(event, payload)
    for (const event of CALL_EVENTS) {
      handlers[event] = (payload) => {
        if (callListener.current) callListener.current(event, payload)
        else callBacklog.current = [...callBacklog.current, [event, payload]].slice(-20)
      }
    }

    for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler)
    return () => {
      for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler)
    }
  }, [socket])

  // ---- the Address Book syncs with this account while signed on (utils/contacts.js) ----
  const contactsSynced = useRef(false)
  useEffect(() => {
    const session = state.status === "online" && tokenRef.current ? { token: tokenRef.current, screenName: state.me?.screenName } : null
    if (!session && !contactsSynced.current) return
    contactsSynced.current = !!session
    import("../../../utils/contacts").then((m) => m.setSyncSession(session)).catch(() => {})
    // Notes too (utils/notes.js; shared notes and live changes need the account)
    import("../../../utils/notes").then((m) => m.setSyncSession(session)).catch(() => {})
    // and Photos' Shared Albums (utils/albums.js)
    import("../../../utils/albums").then((m) => m.setAlbumsSession(session)).catch(() => {})
  }, [state.status, state.me?.screenName])

  // ---- search: the signed-on account's conversations (this device's copy) ----
  useEffect(
    () =>
      registerSearchProvider("messages", {
        icon: AIM_ICON,
        version: () => `${searchVersion.current}:${Object.values(stateRef.current.convos).reduce((n, c) => n + c.messages.length, 0)}`,
        entries: () => {
          const seen = new Map(searchCache.current)
          for (const convo of Object.values(stateRef.current.convos)) for (const m of convo.messages) if (m.id && !m.system && !isTemp(m.id)) seen.set(m.id, { ...m, conv: m.conv || convo.screenName })
          return [...seen.values()]
            .filter((m) => m.text && !String(m.ck || "").startsWith("~"))
            .map((m) => {
              const room = String(m.ck || "").startsWith("#")
              const other = room ? m.room || String(m.conv || "").slice(1) : m.conv || m.from
              return {
                id: `im:${m.id}`,
                title: String(m.text).slice(0, 120),
                subtitle: `${m.mine ? "You" : m.from} ${room ? `in ${other}` : `to ${m.mine ? other : "you"}`} · ${new Date(m.time).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
                detail: other,
                time: m.time,
                open: () => (room ? joinRoom(other) : openIm(other)),
              }
            })
        },
      }),
    []
  )

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

  // ---- saved conversations (history/: this device in IndexedDB, the server per account) ----

  const myKey = () => keyOf(stateRef.current.me?.screenName)
  // into this device's copy (system lines and messages still on their way aren't kept)
  const save = (messages) => {
    const acct = myKey()
    if (acct) historyDb.putMessages(acct, messages)
    for (const m of messages) if (m.id && !m.system && !isTemp(m.id)) searchCache.current.set(m.id, m)
    searchVersion.current++
  }
  const searchCache = useRef(new Map())
  const searchVersion = useRef(0)
  const systemLine = (ck, text, extra = {}) => dispatch({ type: "messages", ck, messages: [{ id: sysId(), system: true, text, time: Date.now(), ...extra }] })

  // Catch up with the server: everything that changed since this device last asked (new
  // messages, reactions, "Delivered", conversations cleared elsewhere, read receipts). A device
  // with nothing gets the newest 50 of each conversation; older ones come when scrolling back.
  const syncing = useRef(null)
  const syncHistory = () => {
    if (syncing.current) return syncing.current
    const run = (async () => {
      const acct = myKey()
      if (!acct) return
      const meta = await historyDb.getMeta(acct)
      // a few seconds of overlap: anything saved at the same moment isn't missed
      let since = meta.cursor ? Math.max(1, meta.cursor - 5_000_000) : 0
      let cursor = meta.cursor || 0
      let reads = null
      for (let page = 0; page < 40; page++) {
        const res = await request("aim:history", { since })
        if (!res?.ok || myKey() !== acct) return
        const messages = (res.messages || []).map((m) => fromServer(m, { meKey: acct }))
        if (messages.length) {
          await historyDb.putMessages(acct, messages)
          save([])
          for (const m of messages) searchCache.current.set(m.id, m)
          const byCk = new Map()
          for (const m of messages) byCk.set(m.ck, [...(byCk.get(m.ck) || []), m])
          for (const [ck, list] of byCk) {
            if (ck.startsWith("#")) {
              if (stateRef.current.rooms[ck.slice(1)]) dispatch({ type: "room", room: stateRef.current.rooms[ck.slice(1)].name, messages: list })
            } else if (stateRef.current.convos[ck]) dispatch({ type: "messages", ck, messages: list })
          }
        }
        for (const c of res.clears || []) {
          await historyDb.clearConv(acct, c.ck, c.upTo)
          dispatch({ type: "cleared", ck: c.ck, upTo: c.upTo })
        }
        if (Array.isArray(res.reads)) reads = Object.fromEntries(res.reads.map((r) => [r.ck, { at: r.at, when: r.when }]))
        if (res.prefs) dispatch({ type: "me", patch: { prefs: res.prefs } })
        cursor = res.cursor || cursor
        if (!res.more) break
        since = res.cursor
      }
      if (reads) dispatch({ type: "reads", reads, replace: true })
      await historyDb.setMeta(acct, { cursor, ...(reads ? { reads } : {}) })
    })()
    syncing.current = run
    run.catch(() => {}).finally(() => (syncing.current = null))
    return run
  }

  // An IM window opened: this device's copy of the conversation (newest 50)
  const loadConvo = async (screenName) => {
    const ck = keyOf(screenName)
    const acct = myKey()
    if (!acct || stateRef.current.convos[ck]?.loaded) return
    const saved = await historyDb.loadLatest(acct, ck, 50)
    dispatch({ type: "messages", ck, screenName: stateRef.current.convos[ck]?.screenName || screenName, messages: saved, older: true, patch: { loaded: true } })
    if (!stateRef.current.reads[ck]) {
      const meta = await historyDb.getMeta(acct)
      if (meta.reads?.[ck]) dispatch({ type: "reads", reads: { [ck]: meta.reads[ck] } })
    }
  }
  const loadRoom = async (room) => {
    const acct = myKey()
    const key = keyOf(room)
    if (!acct || stateRef.current.rooms[key]?.loaded) return
    const saved = await historyDb.loadLatest(acct, `#${key}`, 50)
    dispatch({ type: "room", room, messages: saved, older: true, patch: { loaded: true } })
  }

  // Scrolling back past the top: older messages from this device, then from the server
  const loadOlder = async (ck) => {
    const acct = myKey()
    const room = ck.startsWith("#")
    const current = room ? stateRef.current.rooms[ck.slice(1)] : stateRef.current.convos[ck]
    if (!acct || !current || current.older === false || current.loadingOlder) return
    const setMeta = (patch) => (room ? dispatch({ type: "room", room: current.name, patch }) : dispatch({ type: "messages", ck, messages: [], patch }))
    setMeta({ loadingOlder: true })
    const oldest = current.messages.find((m) => !m.system && m.id && !isTemp(m.id))?.time ?? Date.now()
    let found = await historyDb.loadBefore(acct, ck, oldest, 50)
    if (found.length < 50 && keyOf(ck) !== keyOf(BOT_NAME) && stateRef.current.status === "online") {
      const before = found[0]?.time ?? oldest
      const res = await request("aim:historyOlder", { ck, before, limit: 50 - found.length })
      if (res?.ok && res.messages?.length) {
        const more = res.messages.map((m) => fromServer(m, { meKey: acct }))
        await historyDb.putMessages(acct, more)
        found = [...more, ...found]
      }
    }
    if (room) dispatch({ type: "room", room: current.name, messages: found, older: true, patch: { loadingOlder: false, older: found.length > 0 } })
    else dispatch({ type: "messages", ck, messages: found, older: true, patch: { loadingOlder: false, older: found.length > 0 } })
  }

  // "Clear History": this conversation goes from this device and from your saved copy on the
  // server (the other person keeps theirs)
  const clearHistory = async (ck) => {
    const upTo = Date.now()
    const acct = myKey()
    if (stateRef.current.status === "online") await request("aim:clearHistory", { ck, upTo })
    await historyDb.clearConv(acct, ck, upTo)
    for (const [id, m] of searchCache.current) if (m.ck === ck) searchCache.current.delete(id)
    searchVersion.current++
    dispatch({ type: "cleared", ck, upTo })
  }

  // "Read": the newest message from them that you've seen (sent once per message)
  const readSent = useRef({})
  const markRead = (ck, at) => {
    if (!at || readSent.current[ck] >= at || ck === keyOf(BOT_NAME) || stateRef.current.me?.prefs?.receipts === false) return
    readSent.current[ck] = at
    socket.emit("aim:read", { ck, at })
  }

  // Preferences kept with the account: { saveHistory, receipts }
  const setServerPrefs = async (patch) => {
    const result = await request("aim:setPrefs", patch)
    if (result.ok) {
      dispatch({ type: "me", patch: { prefs: result.prefs } })
      if (patch.receipts === false) dispatch({ type: "reads", reads: {}, replace: true })
      if (patch.receipts === true) syncHistory()
    }
    return result
  }

  const react = async (ck, message, emoji) => {
    const key = myKey()
    const value = message.r?.[key] === emoji ? null : emoji
    const fn = (m) => applyReaction(m, key, value)
    dispatch({ type: "update", ck, id: message.id, fn })
    historyDb.patchMessage(key, message.id, fn)
    const result = await request("aim:react", { id: message.id, ck, emoji: value })
    if (!result.ok) {
      const undo = (m) => applyReaction(m, key, message.r?.[key] || null)
      dispatch({ type: "update", ck, id: message.id, fn: undo })
      historyDb.patchMessage(key, message.id, undo)
    }
    return result
  }

  // An IM: shown at once, then given the server's id (and kept) when it's sent
  const sendIm = async (screenName, text, extra = {}) => {
    const style = prefsRef.current.style
    const ck = keyOf(screenName)
    const temp = { id: tempId(), ck, conv: screenName, from: stateRef.current.me.screenName, text, style, time: Date.now(), mine: true, pending: true, ...(extra.local || {}) }
    dispatch({ type: "messages", ck, screenName, messages: [temp] })
    sound("imSend")
    const result = extra.media ? await request("aim:im", { to: screenName, text, style, media: { id: extra.media.id }, thumb: extra.thumb }) : await request("aim:im", { to: screenName, text, style })
    if (result.ok && ck === keyOf(BOT_NAME)) unlock("smarterchild")
    if (!result.ok) {
      dispatch({ type: "update", ck, id: temp.id, fn: (m) => ({ ...m, pending: false, failed: true }) })
      systemLine(ck, result.error, { error: true })
      return result
    }
    // the server's time: "Read" compares it with theirs (this device's clock may be off)
    const sent = { ...temp, id: result.id || temp.id, time: result.time || temp.time, pending: false, held: !!result.offline }
    dispatch({ type: "update", ck, id: temp.id, fn: () => sent })
    if (result.id) save([sent])
    // signed off with notifications on: it waits for them
    if (result.offline && result.notice) systemLine(ck, result.notice)
    return result
  }

  // A picture or voice message: { kind: "image" | "audio", blob, thumb?, w, h | d, wf }
  const sendMedia = async (screenName, item) => {
    const ck = keyOf(screenName)
    if (ck === keyOf(BOT_NAME)) {
      systemLine(ck, `${BOT_NAME} can't open pictures or voice messages. Try typing!`, { error: true })
      return { ok: false }
    }
    const { uploadMedia } = await import("./history/mediaClient")
    const info = item.kind === "image" ? { kind: "image", w: item.w, h: item.h } : { kind: "audio", d: Math.round(item.d * 10) / 10, wf: item.wf }
    const localMedia = item.kind === "image" ? { k: "image", w: item.w, h: item.h, z: item.blob.size } : { k: "audio", d: info.d, wf: item.wf, z: item.blob.size }
    const temp = { id: tempId(), ck, conv: screenName, from: stateRef.current.me.screenName, text: "", time: Date.now(), mine: true, pending: true, media: { ...localMedia, id: "" }, thumb: item.thumb, localBlob: item.blob }
    dispatch({ type: "messages", ck, screenName, messages: [temp] })
    const uploaded = await uploadMedia(request, item.blob, info).catch(() => ({ ok: false }))
    if (!uploaded?.ok) {
      dispatch({ type: "remove", ck, id: temp.id })
      systemLine(ck, sendFailure(item.kind, uploaded), { error: true })
      return uploaded
    }
    await historyDb.putMedia(myKey(), uploaded.id, item.blob)
    dispatch({ type: "remove", ck, id: temp.id })
    return sendIm(screenName, "", { media: { id: uploaded.id }, thumb: item.thumb, local: { media: { ...localMedia, id: uploaded.id }, thumb: item.thumb } })
  }

  // the bytes of a picture or voice message (this device's copy, else fetched once)
  const getMediaBlob = async (media) => (await import("./history/mediaClient")).loadMedia(request, myKey(), media)

  useEffect(() => {
    if (state.status !== "online" || !state.me?.screenName) return
    searchCache.current = new Map()
    syncHistory()
    // Find: what this device kept for the account
    historyDb.allMessages(myKey(), 3000).then((list) => {
      for (const m of list) if (!searchCache.current.has(m.id)) searchCache.current.set(m.id, m)
      searchVersion.current++
    })
  }, [state.status, state.me?.screenName])

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
      loadRoom(result.room)
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

  // Watch Together uses this session's socket while signed on
  useEffect(() => {
    attachTogether(state.status === "online" ? { request, meKey: myKey } : null)
  }, [state.status])

  // Watch Together's window: { with } / { room } (start from an IM or a chat room), { together }
  // (join), { video, title } (from YouTube '98)
  const openTogether = (handoff = {}) => dispatchWindow({ type: "open_window", payload: launch("Watch Together", { handoff: { id: Date.now(), ...handoff } }) })

  const value = {
    ...state,
    openTogether,
    // signs 98ish Mail and HomePage Studio requests (null when signed off)
    token: state.status === "online" ? tokenRef.current : null,
    prefs,
    setPrefs,
    signOn,
    signOff,
    deleteAccount,
    openDeleteAccount,
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
    getToken: () => tokenRef.current, // the session token (the online drive signs in with it)
    // for calls (call/CallManager.jsx)
    request,
    emit: (event, payload) => socket.emit(event, payload),
    onCall,
    openWindow,
    closeWindows,
    getWindows: () => windowsRef.current,
    // a grey system line in an IM conversation ("Missed call from ...")
    addNotice: (screenName, text) => systemLine(keyOf(screenName), text),
    // saved conversations, pictures and voice messages, reactions, read receipts
    windows,
    loadConvo,
    loadOlder,
    clearHistory,
    markRead,
    react,
    sendMedia,
    getMediaBlob,
    setServerPrefs,
  }

  return (
    <AimContext.Provider value={value}>
      {children}
      {state.status === "online" && (
        <React.Suspense fallback={null}>
          <CallManager />
        </React.Suspense>
      )}
    </AimContext.Provider>
  )
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
