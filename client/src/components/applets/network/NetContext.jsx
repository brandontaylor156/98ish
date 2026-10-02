import { createContext, useContext, useEffect, useRef, useState } from "react"
import { useAim } from "../aim/AimContext"
import { fs, uniqueName } from "../../../utils/fs"

// The network every open 98ish desktop shares: who's on (Network Neighborhood), files
// passed between computers, WinPopup messages and network games. Incoming things open
// their own windows, wherever you are on the desktop.

export const NET_ICON = "/assets/program_icons/network.svg"
export const MAX_FILE_KB = 200
export const RECEIVED_FOLDER = ["C:", "Documents", "Received Files"]
export const GAME_INFO = {
  checkers: { name: "Checkers", icon: "/assets/program_icons/checkers.svg", app: "net-checkers", width: 440, height: 560 },
  race: { name: "Minesweeper Race", icon: "/assets/program_icons/mine-48.png", app: "net-race", width: 300, height: 460 },
  hearts: { name: "Hearts", icon: "/assets/program_icons/hearts.svg", app: "net-hearts", width: 660, height: 560 },
}

const TOKEN_KEY = "98ish.net.token"
const VISIBLE_KEY = "98ish.net.visible"

const session = {
  get: (key) => {
    try {
      return sessionStorage.getItem(key)
    } catch {
      return null
    }
  },
  set: (key, value) => {
    try {
      sessionStorage.setItem(key, value)
    } catch {
      // private mode: a new identity after a reload
    }
  },
}

const loadVisible = () => {
  try {
    return localStorage.getItem(VISIBLE_KEY) !== "false"
  } catch {
    return true
  }
}

// Save a received file to C:\Documents\Received Files (making the folder if needed)
export const saveReceivedFile = (file) => {
  let dir = fs.root
  for (const part of RECEIVED_FOLDER) {
    let next = dir.getItem(part)
    if (!next || !next.isDirectory) next = fs.createDirectoryIn(dir, uniqueName(dir, part))
    dir = next
  }
  return fs.createFileIn(dir, uniqueName(dir, file.name), file.type === "note" ? "note" : "text", file.content)
}

// "98 Messenger user, handheld, playing a game"
export const describe = (c) =>
  [c.me ? "This computer" : c.user ? "98 Messenger user" : "Guest", c.device === "phone" ? "handheld" : null, c.busy ? "playing a game" : null, c.hidden ? "hidden" : null]
    .filter(Boolean)
    .join(", ")

export const formatSize =(bytes) => (bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`)

const NetContext = createContext(null)
export const useNet = () => useContext(NetContext)

export const NetProvider = ({ socket, windows, dispatch: dispatchWindow, mobile, children }) => {
  const aim = useAim()
  const [status, setStatus] = useState("connecting") // connecting | online | offline
  const [me, setMe] = useState(null)
  const [computers, setComputers] = useState([])
  const [visible, setVisibleState] = useState(loadVisible)
  const [matches, setMatches] = useState({}) // id -> view from the server
  const [popups, setPopups] = useState([]) // WinPopup messages received
  const [sentFiles, setSentFiles] = useState({}) // id -> { name, to, status }
  const [intents, setIntents] = useState({}) // computer id -> { kind } waiting for its window

  const windowsRef = useRef(windows)
  const visibleRef = useRef(visible)
  const pendingWindows = useRef(new Set())
  const seenMatchWindows = useRef(new Set()) // match ids whose window has been open
  const leftMatches = useRef(new Set())
  windowsRef.current = windows
  visibleRef.current = visible

  useEffect(() => pendingWindows.current.clear(), [windows])

  // ---- windows ----

  const openWindow = (id, payload, { focus = true } = {}) => {
    const index = windowsRef.current.findIndex((w) => !w.closed && w.netId === id)
    if (index >= 0) {
      if (focus) dispatchWindow({ type: "focus_window", payload: { index } })
      return
    }
    if (pendingWindows.current.has(id)) return
    pendingWindows.current.add(id)
    const open = windowsRef.current.filter((w) => !w.closed).length
    dispatchWindow({
      type: "open_window",
      payload: {
        minimized: false,
        maximized: false,
        active: true,
        closed: false,
        icon_url: NET_ICON,
        initialX: 120 + (open % 6) * 24,
        positionY: 40 + (open % 6) * 18,
        netId: id,
        ...payload,
      },
    })
  }

  const closeWindows = (predicate) =>
    windowsRef.current.forEach((w, index) => {
      if (!w.closed && predicate(w)) dispatchWindow({ type: "close_window", payload: { name: w.name, index } })
    })

  const notice = (title, text, icon = "info") =>
    openWindow(`notice:${Date.now()}:${Math.random()}`, { name: title, program: "Network Neighborhood", app: "net-notice", text, noticeIcon: icon, width: 340, height: 170 })

  // intent: "file" | "message" opens that dialog in the computer's window
  const openComputer = (computer, intent) => {
    if (intent) setIntents((all) => ({ ...all, [computer.id]: { kind: intent, at: Date.now() } }))
    openWindow(`computer:${computer.id}`, {
      name: `\\\\${computer.name}`,
      program: "Network Neighborhood",
      app: "net-computer",
      computerId: computer.id,
      computerName: computer.name,
      width: 480,
      height: 380,
    })
  }

  const openMatchWindow = (view) => {
    const info = GAME_INFO[view.game]
    openWindow(`match:${view.id}`, {
      name: info.name,
      program: info.name,
      app: info.app,
      matchId: view.id,
      icon_url: info.icon,
      width: info.width,
      height: info.height,
      initialX: mobile ? 0 : 160,
      positionY: 20,
    })
  }

  // One WinPopup window (it may have been started from the Start menu)
  const openWinPopup = (focus = true) => {
    const index = windowsRef.current.findIndex((w) => !w.closed && w.app === "net-popup")
    if (index >= 0) return focus && dispatchWindow({ type: "focus_window", payload: { index } })
    openWindow("winpopup", { name: "WinPopup", program: "WinPopup", app: "net-popup", icon_url: "/assets/program_icons/winpopup.svg", width: 360, height: 300 }, { focus })
  }

  // ---- talking to the server ----

  const request = (event, payload = {}) =>
    new Promise((resolve) => {
      if (!socket.connected) return resolve({ ok: false, error: "You aren't connected to the network." })
      socket.timeout(15_000).emit(event, payload, (timeout, result) =>
        resolve(timeout ? { ok: false, error: "The network didn't respond. Please try again." } : result || { ok: false, error: "No answer." })
      )
    })

  const hello = () =>
    socket.emit(
      "net:hello",
      { token: session.get(TOKEN_KEY), visible: visibleRef.current, device: mobile ? "phone" : "pc" },
      (result) => {
        if (!result?.ok) return setStatus("offline")
        session.set(TOKEN_KEY, result.token)
        setMe(result.me)
        setComputers(result.computers)
        setStatus("online")
      }
    )

  useEffect(() => {
    const handlers = {
      connect: hello,
      disconnect: () => setStatus("offline"),
      connect_error: () => setStatus("offline"),
      "net:computers": (list) => {
        setComputers(list)
        const mine = list.find((c) => c.me)
        if (mine) setMe(mine)
      },
      "net:fileOffer": (offer) => {
        openWindow(`file:${offer.id}`, { name: "Incoming File", program: "Network Neighborhood", app: "net-file", offer, width: 360, height: 210 }, { focus: false })
      },
      "net:fileGone": ({ id }) => closeWindows((w) => w.netId === `file:${id}`),
      "net:fileResult": ({ id, status: result, name, to }) => {
        setSentFiles((s) => ({ ...s, [id]: { ...s[id], status: result } }))
        const text = {
          accepted: `${to} accepted "${name}". It was saved in their Received Files folder.`,
          declined: `${to} declined "${name}".`,
          expired: `${to} didn't answer, so "${name}" wasn't sent.`,
          gone: `${to} left the network before accepting "${name}".`,
        }[result]
        if (text) notice("File Transfer", text, result === "accepted" ? "info" : "warn")
      },
      "net:popup": (message) => {
        setPopups((list) => [...list, message].slice(-50))
        openWinPopup(false)
      },
      "net:invited": (invite) => {
        openWindow(`invite:${invite.id}`, { name: `${invite.gameName} Invitation`, program: invite.gameName, app: "net-invite", invite, icon_url: GAME_INFO[invite.game]?.icon, width: 340, height: 200 }, { focus: false })
      },
      "net:inviteGone": ({ id }) => closeWindows((w) => w.netId === `invite:${id}`),
      "net:inviteResult": ({ id, status: result, to, gameName }) => {
        closeWindows((w) => w.netId === `waiting:${id}`)
        const text = {
          declined: `${to} declined your invitation to play ${gameName}.`,
          expired: `${to} didn't answer your invitation to play ${gameName}.`,
          gone: `${to} is no longer on the network.`,
        }[result]
        if (text) notice(gameName, text, "warn")
      },
      "net:match": (view) => {
        if (leftMatches.current.has(view.id)) return
        setMatches((m) => ({ ...m, [view.id]: view }))
        openMatchWindow(view)
      },
      "net:matchGone": ({ id, reason }) => {
        setMatches((m) => {
          const next = { ...m }
          delete next[id]
          return next
        })
        leftMatches.current.add(id)
        closeWindows((w) => w.matchId === id)
        notice("Hearts", reason || "The game was closed.", "warn")
      },
    }
    for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler)
    if (socket.connected) hello()
    return () => {
      for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler)
    }
  }, [socket])

  // Signing on or off 98 Messenger changes this computer's name
  useEffect(() => {
    if (socket.connected) hello()
  }, [aim?.status, aim?.me?.screenName])

  // Closing a game's window leaves the game
  useEffect(() => {
    for (const id of Object.keys(matches)) {
      const open = windows.some((w) => !w.closed && w.matchId === id)
      if (open) seenMatchWindows.current.add(id)
      else if (seenMatchWindows.current.has(id)) leave(id)
    }
  }, [windows, matches])

  // ---- actions ----

  const setVisible = async (value) => {
    setVisibleState(value)
    try {
      localStorage.setItem(VISIBLE_KEY, String(value))
    } catch {
      // remembered for this visit only
    }
    await request("net:visible", { visible: value })
  }

  const sendFile = async (computer, file) => {
    const result = await request("net:sendFile", { to: { id: computer.id }, name: file.name, content: file.textContent, type: file.type })
    if (result.ok) setSentFiles((s) => ({ ...s, [result.id]: { name: file.name, to: result.to, toId: computer.id, status: "waiting", at: Date.now() } }))
    return result
  }

  const cancelFile = (id) => {
    socket.emit("net:fileCancel", { id })
    setSentFiles((s) => ({ ...s, [id]: { ...s[id], status: "canceled" } }))
  }

  const replyFile = (offer, accept) => request("net:fileReply", { id: offer.id, accept })

  const sendPopup = (to, text) => request("net:popup", { to, text })

  // Send a message: an Instant Message if you're both on 98 Messenger, else WinPopup
  const canIm = (computer) => aim?.status === "online" && computer.user && me?.user

  // to: a computer ({ id }) or a 98 Messenger buddy ({ screenName })
  const invite = async (to, game, options = {}) => {
    if (game === "hearts") {
      const table = await request("net:heartsCreate")
      if (!table.ok) return table
      return request("net:invite", { to, game, matchId: table.matchId })
    }
    const result = await request("net:invite", { to, game, options })
    if (result.ok) {
      openWindow(`waiting:${result.inviteId}`, {
        name: GAME_INFO[game].name,
        program: GAME_INFO[game].name,
        app: "net-waiting",
        inviteId: result.inviteId,
        text: `Waiting for ${result.to} to accept your invitation to play ${GAME_INFO[game].name}...`,
        icon_url: GAME_INFO[game].icon,
        width: 340,
        height: 170,
      })
    }
    return result
  }

  const inviteToTable = (matchId, to) => request("net:invite", { to, game: "hearts", matchId })

  const cancelInvite = (id) => socket.emit("net:inviteCancel", { id })

  const replyInvite = (inv, accept) => request("net:inviteReply", { id: inv.id, accept })

  const leave = (matchId) => {
    leftMatches.current.add(matchId)
    seenMatchWindows.current.delete(matchId)
    socket.emit("net:leave", { matchId })
    setMatches((m) => {
      const next = { ...m }
      delete next[matchId]
      return next
    })
  }

  const value = {
    status,
    me,
    computers,
    visible,
    matches,
    popups,
    sentFiles,
    setVisible,
    refresh: async () => {
      const result = await request("net:list")
      if (result.ok) setComputers(result.computers)
    },
    openComputer,
    intents,
    clearIntent: (id) => setIntents((all) => (all[id] ? { ...all, [id]: undefined } : all)),
    openWinPopup,
    clearPopups: () => setPopups([]),
    discardPopup: (i) => setPopups((list) => list.filter((_, j) => j !== i)),
    sendFile,
    cancelFile,
    replyFile,
    sendPopup,
    canIm,
    openIm: (computer) => aim.openIm(computer.name),
    invite,
    inviteToTable,
    cancelInvite,
    replyInvite,
    createTable: () => request("net:heartsCreate"),
    startTable: (matchId) => request("net:heartsStart", { matchId }),
    move: (matchId, path) => request("net:checkersMove", { matchId, path }),
    raceProgress: (matchId, progress) => request("net:raceProgress", { matchId, ...progress }),
    resign: (matchId) => request("net:resign", { matchId }),
    draw: (matchId, action) => request("net:draw", { matchId, action }),
    rematch: (matchId) => request("net:rematch", { matchId }),
    pass: (matchId, cards) => request("net:heartsPass", { matchId, cards }),
    play: (matchId, card) => request("net:heartsPlay", { matchId, card }),
    leave,
    notice,
  }

  return <NetContext.Provider value={value}>{children}</NetContext.Provider>
}
