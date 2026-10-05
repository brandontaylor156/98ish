import { createContext, useContext, useEffect, useRef, useState } from "react"
import { useAim } from "../aim/AimContext"
import { FILE_TYPE, fs, readContent, uniqueName } from "../../../utils/fs"
import { launch } from "../../../utils/programs"
import { onlineProgram, setPendingJoin } from "../../shared/online/useOnlineRoom"
import { interrupts, notify } from "../../../utils/notifications"

// The network every open 98ish desktop shares: who's on (Network Neighborhood), files
// passed between computers, WinPopup messages and network games. Incoming things open
// their own windows, wherever you are on the desktop.

export const NET_ICON = "/assets/program_icons/network.svg"
export const MAX_FILE_KB = 200
// What can be sent, by file type, and how big it may be (the server checks again). Types
// this desktop doesn't have yet are left out.
const SENDABLE = {
  text: { maxKB: 200, label: "document" },
  note: { maxKB: 200, label: "document" },
  richtext: { maxKB: 512, label: "document" },
  image: { maxKB: 1536, label: "picture" },
  sound: { maxKB: 1536, label: "sound" },
}
export const sendableTypes = Object.keys(SENDABLE).filter((type) => FILE_TYPE[type])
export const canSend = (item) => !!item && !item.isDirectory && sendableTypes.includes(item.type)
export const maxBytesFor = (type) => (SENDABLE[type]?.maxKB || MAX_FILE_KB) * 1024
export const sizeLimitText = (type) => {
  const kb = SENDABLE[type]?.maxKB || MAX_FILE_KB
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`
}
// what sending it takes (a big file that isn't loaded counts its stored length)
export const fileBytes = (item) => (item.loaded ? new Blob([item.textContent]).size : item.textLength)
export const RECEIVED_FOLDER = ["C:", "Documents", "Received Files"]
export const GAME_INFO = {
  checkers: { name: "Checkers", icon: "/assets/program_icons/checkers.svg", app: "net-checkers", width: 440, height: 560 },
  race: { name: "Minesweeper Race", icon: "/assets/program_icons/mine-48.png", app: "net-race", width: 300, height: 460 },
  hearts: { name: "Hearts", icon: "/assets/program_icons/hearts.svg", app: "net-hearts", width: 660, height: 560 },
  reversi: { name: "Reversi", icon: "/assets/program_icons/reversi.svg", app: "net-reversi", width: 420, height: 560 },
  chess: { name: "Chess", icon: "/assets/program_icons/chess.svg", app: "net-chess", width: 700, height: 580 },
  battleship: { name: "Battleship", icon: "/assets/program_icons/battleship.svg", app: "net-battleship", width: 660, height: 500 },
  // played in the Tetris app's own window (Tetris Online), not a network game window
  tetris: { name: "Tetris Online", icon: "/assets/program_icons/tetris3-48.png", app: null },
  // drawn in the Doodle Together window
  doodle: { name: "Doodle Together", icon: "/assets/program_icons/doodle.svg", app: null },
  // played in the Lovebirds Quiz Show's own window too
  quiz: { name: "Lovebirds Quiz Show", icon: "/assets/program_icons/quiz.svg", app: null },
  // farmed together in the Sunny Acres window (a co-op town)
  town: { name: "Sunny Acres Co-op", icon: "/assets/program_icons/town.svg", app: null },
}

// A game's name, icon and window: the network games above, or a game on the online room
// system (its program has `online: "<id>"`, see components/shared/online)
export const gameInfo = (game) => {
  if (GAME_INFO[game]) return GAME_INFO[game]
  const program = onlineProgram(game)
  return program ? { name: program.name, icon: program.icon, app: null, program: program.name } : null
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
  return fs.createFileIn(dir, uniqueName(dir, file.name), sendableTypes.includes(file.type) ? file.type : "text", file.content)
}

// "98 Messenger user, handheld, playing a game"
export const describe = (c) =>
  [c.me ? "This computer" : c.user ? "98 Messenger user" : "Guest", c.device === "phone" ? "handheld" : null, c.busy ? "playing a game" : null, c.hidden ? "hidden" : null]
    .filter(Boolean)
    .join(", ")

export const formatSize =(bytes) => (bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`)

// A small JPEG of a picture (at most 96 pixels across) for the receiver's Accept box
const thumbnail = (dataUrl) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 96 / Math.max(img.width, img.height))
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      const ctx = canvas.getContext("2d")
      ctx.fillStyle = "#fff"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL("image/jpeg", 0.75))
    }
    img.onerror = reject
    img.src = dataUrl
  })

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
  const joinLinkChecked = useRef(false)
  const myId = useRef(null) // this computer's id on the network, to notice a new one
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

  // intent: "file" | "message" opens that dialog in the computer's window;
  // { kind: "send", path } sends that file (dropped on the computer)
  const openComputer = (computer, intent) => {
    if (intent) setIntents((all) => ({ ...all, [computer.id]: { ...(typeof intent === "string" ? { kind: intent } : intent), at: Date.now() } }))
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

  // Every move sends the match again: only a new match takes focus, an update must not
  // un-minimize the table or pull the keyboard away from another window
  const openMatchWindow = (view) => {
    const info = GAME_INFO[view.game]
    const id = `match:${view.id}`
    const focus = !windowsRef.current.some((w) => !w.closed && w.netId === id)
    openWindow(id, {
      name: info.name,
      program: info.name,
      app: info.app,
      matchId: view.id,
      icon_url: info.icon,
      width: info.width,
      height: info.height,
      initialX: mobile ? 0 : 160,
      positionY: 20,
    }, { focus })
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
        // Back after a long time offline the network gave us a new computer: our games on
        // the old one were forfeited, and their windows would only answer "No such game."
        if (myId.current && myId.current !== result.me.id) {
          const open = windowsRef.current.some((w) => !w.closed && w.matchId)
          setMatches({})
          closeWindows((w) => !!w.matchId)
          if (open) notice("Network Neighborhood", "You were offline too long, so your game ended.", "warn")
        }
        myId.current = result.me.id
        setMe(result.me)
        setComputers(result.computers)
        setStatus("online")
        followJoinLink()
      }
    )

  // A shared link to an online room (https://.../?join=K7QX): open its game and join
  const followJoinLink = async () => {
    if (joinLinkChecked.current) return
    joinLinkChecked.current = true
    let code = null
    try {
      code = new URLSearchParams(window.location.search).get("join")
    } catch {
      code = null
    }
    if (!code) return
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete("join")
      window.history.replaceState(window.history.state, "", url.toString())
    } catch {
      // the link stays in the address bar
    }
    const room = await request("room:peek", { code })
    if (!room.ok || !onlineProgram(room.game)) return notice("Play Online", `There's no game with the code ${code.toUpperCase()} any more. Ask your friend for a new code.`, "warn")
    openOnlineGame(room.game, { code })
  }

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
        // (Do Not Disturb: it waits minimized on the taskbar instead of popping up)
        const quiet = !interrupts("games")
        openWindow(`invite:${invite.id}`, { name: `${invite.gameName} Invitation`, program: invite.gameName, app: "net-invite", invite, icon_url: gameInfo(invite.game)?.icon, width: 340, height: 200, ...(quiet ? { minimized: true, active: false } : {}) }, { focus: false })
        notify({ app: "games", key: `invite:${invite.id}`, title: `${invite.from} invited you to play`, text: `${invite.gameName}. The invitation is open on your desktop.`, target: { kind: "invites" } })
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
    const content = await readContent(file)
    const preview = file.type === "image" ? await thumbnail(content).catch(() => null) : null
    const result = await request("net:sendFile", { to: { id: computer.id }, name: file.name, content, type: file.type, preview })
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
    // Tetris Online: into your room (options.roomId), or a new private Battle room; the
    // Tetris window shows the room and who's been invited
    if (game === "tetris") {
      let roomId = options.roomId
      if (!roomId) {
        const room = await request("tetris:create", { mode: options.mode || "battle", isPrivate: true })
        if (!room.ok) return room
        roomId = room.roomId
        openTetris()
      }
      return request("net:invite", { to, game, matchId: roomId })
    }
    // Doodle Together: the Doodle window makes the room (bringing its drawing) and invites
    if (game === "doodle") {
      openDoodle(to)
      return { ok: true }
    }
    // Quiz Show: into your game (options.roomId), or a new one (How Well Do You Know Me?)
    if (game === "quiz") {
      let roomId = options.roomId
      if (!roomId) {
        const room = await request("quiz:create", { mode: options.mode || "knowme" })
        if (!room.ok) return room
        roomId = room.roomId
        openQuiz()
      }
      return request("net:invite", { to, game, matchId: roomId })
    }
    // Sunny Acres Co-op: into the co-op town you're farming in (options.roomId, or the
    // server knows which one you have open)
    if (game === "town") return request("net:invite", { to, game, matchId: options.roomId })
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

  const replyInvite = async (inv, accept) => {
    const result = await request("net:inviteReply", { id: inv.id, accept })
    if (result.ok && result.tetrisRoom) openTetris() // it joins the room it was let into
    if (result.ok && result.doodleRoom) openDoodle()
    if (result.ok && result.quizRoom) openQuiz()
    if (result.ok && result.townCoop) openTownCoop(result.townCoop)
    if (result.ok && result.onlineRoom) openOnlineGame(result.onlineGame, { roomId: result.onlineRoom })
    return result
  }

  // A game on the online room system, joining a room (by its id or code) once its window is up
  const openOnlineGame = (game, where) => {
    const program = onlineProgram(game)
    if (!program) return
    setPendingJoin({ game, ...where })
    dispatchWindow({ type: "open_window", payload: launch(program.name) })
  }

  // "Play Online..." in a game: a game on the online room system opens its own window (Play
  // Online is front and center there); the others open a window listing who's online to invite
  const openPlayOnline = (game, options = {}) => {
    const program = onlineProgram(game)
    if (program) return dispatchWindow({ type: "open_window", payload: launch(program.name) })
    // Hearts: a new table, whose lobby lists who to invite
    if (game === "hearts") return request("net:heartsCreate").then((r) => !r.ok && notice("Hearts", r.error, "warn"))
    const info = GAME_INFO[game]
    if (!info) return
    openWindow(`online:${game}`, {
      name: `Play ${info.name} Online`,
      program: info.name,
      app: "net-online",
      game,
      options,
      icon_url: info.icon,
      width: 400,
      height: 460,
    })
  }

  // The Tetris window (one per desktop: comes forward if it's open)
  const openTetris = () => dispatchWindow({ type: "open_window", payload: launch("Tetris") })
  const openQuiz = () => dispatchWindow({ type: "open_window", payload: launch("Lovebirds Quiz Show") })
  // Sunny Acres, into a co-op town (an open window hears about it; a new one opens there)
  const openTownCoop = (id) => {
    window.dispatchEvent(new CustomEvent("98ish:town-coop", { detail: id }))
    dispatchWindow({ type: "open_window", payload: launch("Sunny Acres", { coopId: id }) })
  }

  // The Doodle Together window (one per desktop), inviting `to` once it's ready
  const openDoodle = (to = null) => {
    const open = windowsRef.current.some((w) => !w.closed && w.app === "doodle")
    if (open && to) window.dispatchEvent(new CustomEvent("98ish:doodle-invite", { detail: to }))
    dispatchWindow({ type: "open_window", payload: launch("Doodle Together", open || !to ? {} : { inviteTo: to }) })
  }

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
    socket, // the shared connection (game chat talks over it too)
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
    gameMove: (matchId, move) => request("net:gameMove", { matchId, move }),
    raceProgress: (matchId, progress) => request("net:raceProgress", { matchId, ...progress }),
    resign: (matchId) => request("net:resign", { matchId }),
    draw: (matchId, action) => request("net:draw", { matchId, action }),
    rematch: (matchId) => request("net:rematch", { matchId }),
    pass: (matchId, cards) => request("net:heartsPass", { matchId, cards }),
    play: (matchId, card) => request("net:heartsPlay", { matchId, card }),
    leave,
    notice,
    openPlayOnline,
    openOnlineGame,
    // any program by name (e.g. "98 Messenger" for a game that needs you signed on)
    openProgram: (name, extra) => dispatchWindow({ type: "open_window", payload: launch(name, extra) }),
    // for apps with their own protocol (Tetris Online)
    socket,
    request,
  }

  return <NetContext.Provider value={value}>{children}</NetContext.Provider>
}
