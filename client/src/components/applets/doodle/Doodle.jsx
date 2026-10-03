import React, { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import PlayOnlineButton from "../../shared/online/PlayOnlineButton"
import { ConnectionPanel } from "../../shared/online/PlayOnline"
import { useServerStatus } from "../../shared/online/useOnlineRoom"
import Dialog from "../../shared/Dialog"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import { useNet } from "../network/NetContext"
import { useRecipients, usePartner } from "../puzzle/partner"
import { drawSticker } from "../puzzle/art"
import { fs, uniqueName, writeAndSave } from "../../../utils/fs"
import { paintWindow } from "../../../utils/programs"
import { unlock } from "../../../utils/achievements"
import { CANVAS, PENCIL_WIDTH, SIZES, STICKERS, TEMPLATES, drawOp, drawStrokeEnd, drawStrokePart, drawTemplate, floodFill, scaled } from "./paper"
import "./Doodle.css"

// Doodle Together: one canvas, two (or up to four) people drawing on it at once. Invite
// your partner or a buddy (here, from Network Neighborhood or from a 98 Messenger window);
// everyone sees everyone's strokes as they're drawn, with a colored cursor for each person.
// Pencil, brush, eraser, paint bucket and stickers; undo takes back your own things; clear
// asks the others first. Drawing alone works too, and inviting someone brings your drawing
// along. Save puts a PNG in C:\Documents\Doodles (for everyone in the room) for Paint.
//
// On phones: one finger draws, two fingers pan and pinch-zoom.

const PALETTE = [
  "#000000", "#808080", "#800000", "#808000", "#008000", "#008080", "#000080", "#800080", "#808040", "#004040", "#0080ff", "#004080", "#8000ff", "#804000",
  "#ffffff", "#c0c0c0", "#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ffff80", "#00ff80", "#80ffff", "#8080ff", "#ff0080", "#ff8040",
  "#e0457b", "#ff9fbf", "#ffd9e6", "#ffd23f", "#9be7c4", "#b9a6ff", "#7cc7ff",
]
const TOOLS = [
  { id: "pencil", label: "Pencil" },
  { id: "brush", label: "Brush" },
  { id: "eraser", label: "Eraser" },
  { id: "fill", label: "Fill" },
  { id: "sticker", label: "Stickers" },
]
const STICKER_SIZES = [36, 60, 90, 130, 180]
const SEND_MS = 40 // stroke points go out in batches this often
const BATCH_POINTS = 110
const STROKE_POINTS = 2800
const TOUCH_COMMIT_MS = 70 // a second finger this soon means pan/zoom, not a stroke
const DOODLE_FOLDER = ["C:", "Documents", "Doodles"]
const MAX_SNAPSHOT = 880 * 1024

const rid = () => Math.random().toString(36).slice(2, 10).padEnd(6, "0")

const ToolIcon = ({ id }) => {
  const common = { width: 22, height: 22, viewBox: "0 0 22 22", "aria-hidden": true }
  if (id === "pencil")
    return (
      <svg {...common}>
        <path d="M4 18l1.5-5L15 3.5l3.5 3.5L9 16.5z" fill="#ffd23f" stroke="#333" />
        <path d="M4 18l1.5-5 3.5 3.5z" fill="#f2c9a0" stroke="#333" />
        <path d="M15 3.5l3.5 3.5" stroke="#e0457b" strokeWidth="2.5" />
      </svg>
    )
  if (id === "brush")
    return (
      <svg {...common}>
        <path d="M17.5 2.5l2 2-8 8-2-2z" fill="#a0683a" stroke="#333" />
        <path d="M9.5 10.5l2 2c-1 3-3.5 5.5-8 6 1-2 .5-6 6-8z" fill="#e0457b" stroke="#333" />
      </svg>
    )
  if (id === "eraser")
    return (
      <svg {...common}>
        <path d="M3 14l8-8 7 7-5 5H7z" fill="#ffb3c8" stroke="#333" />
        <path d="M7 10l7 7" stroke="#333" />
        <path d="M3 19h16" stroke="#888" />
      </svg>
    )
  if (id === "fill")
    return (
      <svg {...common}>
        <path d="M4 10l6-6 7 7-6 6z" fill="#cfe6ff" stroke="#333" />
        <path d="M17 11c1.5 2 2.5 3.5 2.5 4.5a1.8 1.8 0 0 1-3.6 0c0-1 .6-2.2 1.1-4.5z" fill="#2f7fd8" stroke="#333" />
      </svg>
    )
  return (
    <svg {...common}>
      <path d="M11 19C5 14.5 2.5 11.5 2.5 8a4.3 4.3 0 0 1 8.5-1.3A4.3 4.3 0 0 1 19.5 8c0 3.5-2.5 6.5-8.5 11z" fill="#ff5e8a" stroke="#8a2f55" />
    </svg>
  )
}

const Doodle = ({ mobile, onClose, onTitle, dispatch, inviteTo }) => {
  const net = useNet()
  const socket = net?.socket
  const me = net?.me?.id || null
  const partner = usePartner()
  const recipients = useRecipients()
  const chatItem = useGameChatMenuItem("doodle")

  const [tool, setTool] = useState("brush")
  const [size, setSize] = useState(1) // index into SIZES / STICKER_SIZES
  const [color, setColor] = useState("#e0457b")
  const [sticker, setSticker] = useState("heart")
  const [template, setTemplate] = useState("blank")
  const [room, setRoom] = useState(null) // { id, members, template, host, invited }
  const [dialog, setDialog] = useState(null)
  const [status, setStatus] = useState(null) // a line under the canvas
  const [saved, setSaved] = useState(null) // the last saved file
  const [cursors, setCursors] = useState({}) // pid -> { x, y, at }
  const [, bump] = useReducer((n) => n + 1, 0)
  const [view, setView] = useState(null) // { z, tx, ty }
  const viewRef = useRef(null)
  viewRef.current = view
  const roomRef = useRef(null)
  roomRef.current = room

  const stageRef = useRef(null)
  const bgRef = useRef(null)
  const inkRef = useRef(null)
  const ctx = useRef({ bg: null, ink: null })
  const ops = useRef([]) // everything drawn since the snapshot, in arrival order
  const snapshot = useRef(null) // data URL of the flattened drawing, or null
  const snapImage = useRef(null) // its loaded <img>
  const generation = useRef(0)
  const local = useRef({ dirty: false })

  // ---- drawing everything again (undo, someone joining, a new background) ----

  const rebuild = async () => {
    const gen = ++generation.current
    let img = null
    if (snapshot.current) {
      if (snapImage.current?.src !== snapshot.current) {
        img = new Image()
        img.src = snapshot.current
        await img.decode().catch(() => null)
        if (gen !== generation.current) return
        snapImage.current = img
      }
      img = snapImage.current
    }
    const { bg, ink } = ctx.current
    if (!bg || !ink) return
    ink.save()
    ink.setTransform(1, 0, 0, 1, 0, 0)
    ink.clearRect(0, 0, ink.canvas.width, ink.canvas.height)
    ink.restore()
    if (img) ink.drawImage(img, 0, 0, CANVAS, CANVAS)
    for (const op of ops.current) if (!op.undone) drawOp(ink, bg, op)
  }

  const paintBackground = (id) => {
    const { bg } = ctx.current
    if (!bg) return
    drawTemplate(bg, id)
  }

  useLayoutEffect(() => {
    ctx.current.bg = scaled(bgRef.current)
    ctx.current.ink = scaled(inkRef.current)
    paintBackground(template)
  }, [])

  // the background follows the room's
  const currentTemplate = room?.template || template
  const shownTemplate = useRef(currentTemplate)
  useEffect(() => {
    if (shownTemplate.current === currentTemplate) return
    shownTemplate.current = currentTemplate
    paintBackground(currentTemplate)
    rebuild()
  }, [currentTemplate])

  // ---- the view: fit, pan, zoom ----

  const fit = () => {
    const el = stageRef.current
    if (!el) return
    const w = el.clientWidth
    const h = el.clientHeight
    const z = Math.max(0.05, Math.min((w - 16) / CANVAS, (h - 16) / CANVAS))
    setView({ z, tx: (w - CANVAS * z) / 2, ty: (h - CANVAS * z) / 2 })
  }
  useLayoutEffect(() => {
    fit()
    const ro = new ResizeObserver(() => fit())
    ro.observe(stageRef.current)
    return () => ro.disconnect()
  }, [])

  const toPaper = (clientX, clientY) => {
    const rect = stageRef.current.getBoundingClientRect()
    const v = viewRef.current
    return [(clientX - rect.left - v.tx) / v.z, (clientY - rect.top - v.ty) / v.z]
  }

  const zoomAt = (mx, my, z) => {
    const v = viewRef.current
    z = Math.max(0.15, Math.min(6, z))
    const wx = (mx - v.tx) / v.z
    const wy = (my - v.ty) / v.z
    setView({ z, tx: mx - wx * z, ty: my - wy * z })
  }

  // ---- talking to the room ----

  const request = (event, payload) => (net?.request ? net.request(event, payload) : Promise.resolve({ ok: false, error: "You aren't connected to the network." }))
  const inRoom = () => !!roomRef.current && net?.status === "online"
  const othersHere = () => (roomRef.current?.members || []).filter((m) => !m.me)

  const adopt = (result) => {
    setRoom(result.room)
    ops.current = (result.state?.ops || []).map((op) => ({ ...op, mine: !!me && op.by === me }))
    snapshot.current = result.state?.snapshot || null
    shownTemplate.current = result.state?.template || result.room.template
    paintBackground(shownTemplate.current)
    rebuild()
  }

  // Into a room: a new one (bringing this drawing along), or the one you were invited to
  const renderInk = (scale = 1) => {
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(CANVAS * scale)
    canvas.height = Math.round(CANVAS * scale)
    canvas.getContext("2d").drawImage(inkRef.current, 0, 0, canvas.width, canvas.height)
    return canvas
  }
  const hasDrawing = () => !!snapshot.current || ops.current.some((op) => !op.undone)

  const pictureOf = (canvas) => {
    for (const [type, q] of [["image/png"], ["image/webp", 0.92]]) {
      const data = canvas.toDataURL(type, q)
      if (data.length <= MAX_SNAPSHOT && data.startsWith(`data:${type}`)) return data
    }
    return null
  }

  const openRoom = async () => {
    let image = null
    if (hasDrawing()) {
      image = pictureOf(renderInk(1)) || pictureOf(renderInk(0.75))
      if (!image) return { ok: false, error: "This drawing is too big to share. Save it, then clear some of it." }
    }
    const result = await request("doodle:create", { template, image })
    if (!result.ok) return result
    adopt(result)
    return result
  }

  const invite = async (to) => {
    setDialog(null)
    let roomId = roomRef.current?.id
    if (!roomId) {
      const made = await openRoom()
      if (!made.ok) return setStatus(made.error)
      roomId = made.roomId
    }
    const result = await request("net:invite", { to, game: "doodle", matchId: roomId })
    setStatus(result.ok ? `Invited ${result.to}. Waiting for them to join...` : result.error)
  }

  const join = async (roomId) => {
    const result = await request("doodle:join", { roomId })
    if (!result.ok) return setStatus(result.error)
    adopt(result)
    setStatus("You joined the drawing. Say hi!")
  }

  const askToJoin = (roomId) => {
    if (roomRef.current?.id === roomId) return
    if (hasDrawing() && !local.current.saved) setDialog({ kind: "join", roomId })
    else join(roomId)
  }

  // the window opened from an invitation, or from a "Doodle Together" menu item somewhere
  const helloDone = useRef(false)
  useEffect(() => {
    if (net?.status !== "online") return
    request("doodle:hello").then((result) => {
      if (!result.ok) return
      if (result.room) adopt(result)
      else if (result.invited) askToJoin(result.invited)
      else if (roomRef.current) {
        // the server forgot us (it restarted): drawing alone again
        setRoom(null)
        setStatus("The connection was lost, so you're drawing alone now.")
      }
      if (!helloDone.current && inviteTo) invite(inviteTo)
      helloDone.current = true
    })
  }, [net?.status])

  // more invitations while open (from Network Neighborhood or 98 Messenger)
  useEffect(() => {
    const onInvite = (e) => invite(e.detail)
    window.addEventListener("98ish:doodle-invite", onInvite)
    return () => window.removeEventListener("98ish:doodle-invite", onInvite)
  })

  // leave the room when the window closes
  useEffect(
    () => () => {
      if (roomRef.current) socket?.emit("doodle:leave", { roomId: roomRef.current.id })
    },
    []
  )

  // ---- what the others do ----

  const findOp = (by, id) => ops.current.find((o) => o.by === by && o.id === id)

  useEffect(() => {
    if (!socket) return
    const mine = (payload) => roomRef.current && (!payload?.roomId || payload.roomId === roomRef.current.id)
    const handlers = {
      "doodle:room": (r) => {
        if (roomRef.current && r.id !== roomRef.current.id) return
        setRoom(r)
      },
      "doodle:stroke": ({ by, id, p, start, end }) => {
        if (!roomRef.current) return
        const { ink } = ctx.current
        let op = findOp(by, id)
        if (start && !op) {
          op = { k: "s", id, by, c: start.c, w: start.w, t: start.t, p: [], end: false }
          ops.current.push(op)
        }
        if (!op || op.undone) return
        const before = op.p.length / 2
        op.p.push(...p)
        drawStrokePart(ink, op, before)
        if (end) {
          op.end = true
          drawStrokeEnd(ink, op)
        }
        const last = p.length >= 2 ? [p[p.length - 2], p[p.length - 1]] : null
        if (last) setCursors((c) => ({ ...c, [by]: { x: last[0], y: last[1], at: Date.now() } }))
      },
      "doodle:op": (op) => {
        if (!roomRef.current || findOp(op.by, op.id)) return
        ops.current.push({ ...op })
        drawOp(ctx.current.ink, ctx.current.bg, op)
      },
      "doodle:undo": ({ by, id }) => {
        const op = findOp(by, id)
        if (op) {
          op.undone = true
          rebuild()
        }
      },
      "doodle:cleared": () => {
        ops.current = []
        snapshot.current = null
        rebuild()
        setDialog((d) => (d?.kind === "clearAsk" ? null : d))
        setStatus("The drawing was cleared.")
      },
      "doodle:clearAsk": ({ from }) => setDialog({ kind: "clearAsk", from }),
      "doodle:clearResult": ({ text }) => setStatus(text),
      "doodle:clearDone": () => setDialog((d) => (d?.kind === "clearAsk" ? null : d)),
      "doodle:cursor": ({ by, x, y }) => setCursors((c) => ({ ...c, [by]: x === null ? undefined : { x, y, at: Date.now() } })),
      "doodle:notice": ({ text }) => setStatus(text),
      "doodle:invited": ({ roomId }) => askToJoin(roomId),
      "doodle:saved": ({ by }) => {
        const file = saveToDrive(true)
        if (file) {
          setStatus(`${by} saved the drawing. A copy is in your Doodles folder too.`)
          unlock("doodle-pair")
        }
      },
      "doodle:needSnapshot": (ask) => mine(ask) && sendSnapshot(ask),
    }
    for (const [event, fn] of Object.entries(handlers)) socket.on(event, fn)
    return () => {
      for (const [event, fn] of Object.entries(handlers)) socket.off(event, fn)
    }
  }, [socket])

  // cursors fade away when someone stops moving
  useEffect(() => {
    const id = setInterval(() => {
      setCursors((c) => {
        const now = Date.now()
        const next = Object.fromEntries(Object.entries(c).filter(([, v]) => v && now - v.at < 4000))
        return Object.keys(next).length === Object.keys(c).length ? c : next
      })
    }, 1000)
    return () => clearInterval(id)
  }, [])

  // The server asked for a picture of the drawing so far (it's getting big)
  const sendSnapshot = async ({ roomId, token, lastId, lastBy }) => {
    const bgC = document.createElement("canvas")
    const inkC = document.createElement("canvas")
    bgC.width = inkC.width = CANVAS
    bgC.height = inkC.height = CANVAS
    const bg = bgC.getContext("2d", { willReadFrequently: true })
    const ink = inkC.getContext("2d", { willReadFrequently: true })
    drawTemplate(bg, shownTemplate.current)
    if (snapshot.current) {
      const img = new Image()
      img.src = snapshot.current
      await img.decode().catch(() => null)
      ink.drawImage(img, 0, 0, CANVAS, CANVAS)
    }
    for (const op of ops.current) {
      if (!op.undone && (op.k !== "s" || op.end)) drawOp(ink, bg, op)
      if (op.id === lastId && op.by === lastBy) break
    }
    const image = pictureOf(inkC) || pictureOf(renderInkFrom(inkC, 0.75))
    if (image) socket?.emit("doodle:snapshot", { roomId, token, image })
  }
  const renderInkFrom = (source, scale) => {
    const c = document.createElement("canvas")
    c.width = Math.round(CANVAS * scale)
    c.height = Math.round(CANVAS * scale)
    c.getContext("2d").drawImage(source, 0, 0, c.width, c.height)
    return c
  }

  // ---- your own drawing ----

  const stroke = useRef(null) // { op, sendFrom, started }
  const sendTimer = useRef(null)

  const flush = (final = false) => {
    const s = stroke.current
    if (!s || !inRoom()) return
    const op = s.op
    const pts = op.p.slice(s.sent)
    if (!pts.length && !final && s.started) return
    if (!s.started && !pts.length && !final) return
    const payload = { roomId: roomRef.current.id, id: op.id, p: pts }
    if (!s.started) payload.start = { c: op.c, w: op.w, t: op.t }
    if (final) payload.end = true
    s.sent = op.p.length
    s.started = true
    socket.emit("doodle:stroke", payload, (result) => {
      if (result && !result.ok) {
        if (result.code === "full") setStatus("Saving the canvas... draw again in a moment.")
        else if (result.code !== "rate") setStatus(result.error)
        // the others never got this stroke: take it back here too
        if (payload.start) {
          op.undone = true
          rebuild()
        }
      }
    })
  }

  const beginStroke = (x, y) => {
    const op = { k: "s", id: rid(), by: me || "me", c: color, w: tool === "pencil" ? PENCIL_WIDTH : SIZES[size], t: tool, p: [x, y], end: false, mine: true }
    ops.current.push(op)
    drawStrokePart(ctx.current.ink, op, 0)
    stroke.current = { op, sent: 0, started: false }
    local.current.saved = false
    clearInterval(sendTimer.current)
    sendTimer.current = setInterval(() => flush(), SEND_MS)
  }

  const extendStroke = (x, y) => {
    const s = stroke.current
    if (!s) return
    const p = s.op.p
    const lx = p[p.length - 2]
    const ly = p[p.length - 1]
    if (Math.hypot(x - lx, y - ly) < 1.2) return
    const before = p.length / 2
    p.push(Math.round(x * 2) / 2, Math.round(y * 2) / 2)
    drawStrokePart(ctx.current.ink, s.op, before)
    if ((p.length - s.sent) / 2 >= BATCH_POINTS) flush()
    // very long strokes carry on as a new one
    if (p.length / 2 >= STROKE_POINTS) {
      endStroke()
      beginStroke(x, y)
    }
  }

  const endStroke = () => {
    const s = stroke.current
    if (!s) return
    clearInterval(sendTimer.current)
    s.op.end = true
    drawStrokeEnd(ctx.current.ink, s.op)
    flush(true)
    stroke.current = null
  }

  const place = (x, y) => {
    if (x < 0 || y < 0 || x > CANVAS || y > CANVAS) return
    const { ink, bg } = ctx.current
    local.current.saved = false
    if (tool === "fill") {
      const op = { k: "f", id: rid(), by: me || "me", x: Math.floor(x), y: Math.floor(y), c: color, mine: true }
      ops.current.push(op)
      floodFill(ink, bg, op.x, op.y, op.c)
      if (inRoom()) socket.emit("doodle:fill", { roomId: roomRef.current.id, id: op.id, x: op.x, y: op.y, c: op.c }, (r) => r && !r.ok && takeBack(op, r))
    } else {
      const op = { k: "k", id: rid(), by: me || "me", x: Math.round(x), y: Math.round(y), n: sticker, s: STICKER_SIZES[size], c: color, mine: true }
      ops.current.push(op)
      drawSticker(ink, op.n, op.x, op.y, op.s, op.c)
      if (inRoom()) socket.emit("doodle:sticker", { roomId: roomRef.current.id, id: op.id, x: op.x, y: op.y, n: op.n, s: op.s, c: op.c }, (r) => r && !r.ok && takeBack(op, r))
    }
  }
  const takeBack = (op, result) => {
    op.undone = true
    rebuild()
    setStatus(result.error)
  }

  const undo = async () => {
    if (stroke.current) return
    const mine = [...ops.current].reverse().find((op) => op.mine && !op.undone && (op.k !== "s" || op.end))
    if (!mine) return setStatus(snapshot.current ? "Older things are part of the picture now and can't be undone." : "Nothing to undo.")
    if (inRoom()) {
      const result = await request("doodle:undo", { roomId: roomRef.current.id, id: mine.id })
      if (!result.ok) {
        mine.mine = false // can't be undone anymore; skip it next time
        return setStatus(result.error)
      }
    }
    mine.undone = true
    rebuild()
  }

  const clearAll = async () => {
    if (inRoom() && othersHere().length) {
      const result = await request("doodle:clear", { roomId: roomRef.current.id })
      setStatus(result.ok ? `Asked ${othersHere().map((m) => m.name).join(" and ")} to clear the drawing...` : result.error)
      return
    }
    setDialog({ kind: "clear" })
  }
  const wipe = async () => {
    setDialog(null)
    if (inRoom()) await request("doodle:clear", { roomId: roomRef.current.id })
    ops.current = []
    snapshot.current = null
    rebuild()
  }

  const chooseTemplate = async (id) => {
    if (inRoom()) {
      const result = await request("doodle:template", { roomId: roomRef.current.id, template: id })
      if (!result.ok) setStatus(result.error)
    } else setTemplate(id)
  }

  // ---- saving ----

  const pictureForSave = () => {
    const canvas = document.createElement("canvas")
    canvas.width = CANVAS
    canvas.height = CANVAS
    const c = canvas.getContext("2d")
    c.drawImage(bgRef.current, 0, 0, CANVAS, CANVAS)
    c.drawImage(inkRef.current, 0, 0, CANVAS, CANVAS)
    return canvas.toDataURL("image/png")
  }

  // -> the file, or null (the drive is full)
  const saveToDrive = (quiet = false) => {
    let dir = fs.root
    for (const part of DOODLE_FOLDER) {
      let next = dir.getItem(part)
      if (!next || !next.isDirectory) next = fs.createDirectoryIn(dir, part)
      dir = next
    }
    const names = (roomRef.current?.members || []).filter((m) => !m.me).map((m) => m.name)
    const base = names.length ? `Doodle with ${names.join(" and ")}`.slice(0, 56) : "Doodle"
    const file = fs.createFileIn(dir, uniqueName(dir, base), "image", "")
    if (!writeAndSave(file, pictureForSave(), { created: true })) {
      if (!quiet) setDialog({ kind: "alert", text: "There isn't enough room on the drive to save this drawing." })
      return null
    }
    local.current.saved = true
    setSaved(file)
    return file
  }

  const save = () => {
    const file = saveToDrive()
    if (!file) return
    const together = inRoom() && othersHere().length > 0
    if (together) {
      socket.emit("doodle:saved", { roomId: roomRef.current.id })
      unlock("doodle-pair")
    }
    setStatus(`Saved as C:\\Documents\\Doodles\\${file.name}${together ? " (and for everyone here)" : ""}.`)
  }

  const openInPaint = () => {
    const file = saved && fs.resolve(fs.partsOf(saved)) === saved ? saved : saveToDrive()
    if (file) dispatch?.({ type: "open_window", payload: paintWindow(file) })
  }

  // ---- pointers ----

  const pointers = useRef(new Map()) // pointerId -> { x, y, type }
  const pending = useRef(null) // a touch that may become a stroke or a pinch
  const pinch = useRef(null)
  const panning = useRef(null)
  const lastCursor = useRef(0)
  const tapStart = useRef(null)

  const drawingTool = tool === "pencil" || tool === "brush" || tool === "eraser"

  const sendCursor = (x, y) => {
    if (!inRoom() || Date.now() - lastCursor.current < 60) return
    lastCursor.current = Date.now()
    socket.emit("doodle:cursor", { roomId: roomRef.current.id, x, y })
  }

  const commitPending = () => {
    const p = pending.current
    if (!p) return
    clearTimeout(p.timer)
    pending.current = null
    const [first, ...rest] = p.points
    beginStroke(first[0], first[1])
    for (const [x, y] of rest) extendStroke(x, y)
  }

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()]
    const rect = stageRef.current.getBoundingClientRect()
    pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }, view: viewRef.current }
  }

  const onPointerDown = (e) => {
    if (!view) return
    // a palm (a very big touch) is ignored
    if (e.pointerType === "touch" && (e.width > 60 || e.height > 60)) return
    stageRef.current.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType })
    const [x, y] = toPaper(e.clientX, e.clientY)
    // mouse: middle button (or right) pans
    if (e.pointerType === "mouse" && e.button !== 0) {
      panning.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
      return
    }
    if (pointers.current.size === 2 && e.pointerType === "touch") {
      // two fingers: pan and zoom (a stroke just started is dropped; one going on ends)
      if (pending.current) {
        clearTimeout(pending.current.timer)
        pending.current = null
      }
      if (stroke.current) endStroke()
      tapStart.current = null
      startPinch()
      return
    }
    if (pointers.current.size > 1) return
    tapStart.current = { x: e.clientX, y: e.clientY, px: x, py: y, id: e.pointerId }
    if (!drawingTool) return
    if (e.pointerType === "touch") {
      pending.current = { id: e.pointerId, points: [[x, y]], timer: setTimeout(commitPending, TOUCH_COMMIT_MS) }
    } else beginStroke(x, y)
  }

  const onPointerMove = (e) => {
    const [x, y] = view ? toPaper(e.clientX, e.clientY) : [0, 0]
    if (e.pointerType === "mouse" && !pointers.current.size) sendCursor(x, y)
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType })
    if (panning.current?.id === e.pointerId) {
      const v = viewRef.current
      setView({ ...v, tx: v.tx + e.clientX - panning.current.x, ty: v.ty + e.clientY - panning.current.y })
      panning.current = { ...panning.current, x: e.clientX, y: e.clientY }
      return
    }
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const rect = stageRef.current.getBoundingClientRect()
      const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }
      const p = pinch.current
      const z = Math.max(0.15, Math.min(6, (p.view.z * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(10, p.dist)))
      const wx = (p.mid.x - p.view.tx) / p.view.z
      const wy = (p.mid.y - p.view.ty) / p.view.z
      setView({ z, tx: mid.x - wx * z, ty: mid.y - wy * z })
      return
    }
    const events = e.nativeEvent.getCoalescedEvents?.() || []
    const points = events.length ? events.map((ev) => toPaper(ev.clientX, ev.clientY)) : [[x, y]]
    if (pending.current?.id === e.pointerId) {
      pending.current.points.push(...points)
      const [sx, sy] = pending.current.points[0]
      if (Math.hypot(x - sx, y - sy) * viewRef.current.z > 8) commitPending()
      return
    }
    if (stroke.current) {
      for (const [px, py] of points) extendStroke(px, py)
      sendCursor(x, y)
    }
  }

  const onPointerUp = (e) => {
    const had = pointers.current.delete(e.pointerId)
    if (panning.current?.id === e.pointerId) panning.current = null
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null
      return
    }
    if (!had) return
    if (pending.current?.id === e.pointerId) commitPending()
    if (stroke.current) endStroke()
    const tap = tapStart.current
    tapStart.current = null
    if (tap?.id === e.pointerId && !drawingTool && e.type !== "pointercancel" && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 12) place(tap.px, tap.py)
  }

  const onWheel = (e) => {
    if (!view) return
    const rect = stageRef.current.getBoundingClientRect()
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, view.z * Math.exp(-e.deltaY * 0.0015))
  }
  useEffect(() => {
    const el = stageRef.current
    const stop = (e) => e.preventDefault()
    el.addEventListener("wheel", stop, { passive: false })
    // iOS: no page zoom/scroll gestures over the paper
    el.addEventListener("gesturestart", stop)
    return () => {
      el.removeEventListener("wheel", stop)
      el.removeEventListener("gesturestart", stop)
    }
  }, [])

  // keyboard: Ctrl+Z undo
  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault()
      undo()
    }
  }

  // ---- title, tests ----

  const others = (room?.members || []).filter((m) => !m.me)
  useEffect(() => {
    onTitle?.(others.length ? `Doodle Together - with ${others.map((m) => m.name).join(", ")}` : "Doodle Together")
  }, [others.map((m) => m.name).join(",")])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__doodle = {
      room: () => roomRef.current,
      ops: () => ops.current.filter((o) => !o.undone).map((o) => ({ k: o.k, by: o.by, id: o.id, n: o.p ? o.p.length / 2 : 0, end: o.end })),
      // the color at a paper point, as everyone sees it (background and ink)
      pixel: (x, y) => {
        const k = inkRef.current.width / CANVAS
        const i = ctx.current.ink.getImageData(Math.floor(x * k), Math.floor(y * k), 1, 1).data
        const b = ctx.current.bg.getImageData(Math.floor(x * k), Math.floor(y * k), 1, 1).data
        const a = i[3] / 255
        return [0, 1, 2].map((j) => Math.round(i[j] * a + b[j] * (1 - a)))
      },
      // where a paper point is on the screen
      screen: (x, y) => {
        const rect = stageRef.current.getBoundingClientRect()
        const v = viewRef.current
        return { x: rect.left + v.tx + x * v.z, y: rect.top + v.ty + y * v.z }
      },
      view: () => viewRef.current,
    }
  })

  // ---- menus and layout ----

  const menus = [
    {
      label: "File",
      items: [
        { label: "Save to My Documents", onClick: save },
        { label: "Open in Paint", onClick: openInPaint },
        "-",
        { label: "Draw Online with Someone...", onClick: () => setDialog({ kind: "invite" }) },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo My Last", onClick: undo },
        { label: "Clear Drawing...", onClick: clearAll },
      ],
    },
    {
      label: "Background",
      items: TEMPLATES.map((t) => ({ label: t.name, checked: currentTemplate === t.id, onClick: () => chooseTemplate(t.id) })),
    },
    {
      label: "View",
      items: [
        { label: "Zoom In", onClick: () => stageRef.current && zoomAt(stageRef.current.clientWidth / 2, stageRef.current.clientHeight / 2, view.z * 1.4) },
        { label: "Zoom Out", onClick: () => stageRef.current && zoomAt(stageRef.current.clientWidth / 2, stageRef.current.clientHeight / 2, view.z / 1.4) },
        { label: "Fit to Window", onClick: fit },
        "-",
        chatItem,
      ],
    },
  ]

  const online = net?.status === "online"
  const server = useServerStatus()
  const computers = (net?.computers || []).filter((c) => !c.me && !c.hidden)
  const inviteOptions = useMemo(() => {
    const list = []
    const seen = new Set()
    const here = new Set((room?.members || []).map((m) => m.name.toLowerCase()))
    for (const r of recipients) {
      const c = computers.find((c) => c.name.replace(/\s+/g, "").toLowerCase() === r.screenName.replace(/\s+/g, "").toLowerCase())
      if (!c && !r.online) continue
      seen.add(r.screenName.toLowerCase())
      list.push({ key: `aim:${r.screenName}`, name: r.screenName, partner: r.partner, to: { screenName: r.screenName }, here: here.has(r.screenName.toLowerCase()) })
    }
    for (const c of computers) {
      if (seen.has(c.name.toLowerCase())) continue
      list.push({ key: `pc:${c.id}`, name: c.name, partner: false, to: { id: c.id }, here: here.has(c.name.toLowerCase()), device: c.device })
    }
    return list
  }, [recipients, computers, room])

  const toolbox = (
    <div className="ddTools" role="toolbar" aria-label="Tools">
      {TOOLS.map((t) => (
        <button key={t.id} type="button" className={tool === t.id ? "is-on" : ""} aria-pressed={tool === t.id} title={t.label} aria-label={t.label} onClick={() => setTool(t.id)}>
          <ToolIcon id={t.id} />
        </button>
      ))}
      <button type="button" className="ddUndo" title="Undo my last (Ctrl+Z)" aria-label="Undo" onClick={undo}>
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <path d="M8 5L3 9.5 8 14" fill="none" stroke="#24508a" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M3.5 9.5h9a5 5 0 0 1 0 10H9" fill="none" stroke="#24508a" strokeWidth="2.2" />
        </svg>
      </button>
    </div>
  )

  const options = (
    <div className="ddOptions">
      {tool === "sticker" ? (
        <div className="ddStickers" role="group" aria-label="Stickers">
          {STICKERS.map((k) => (
            <button key={k} type="button" className={sticker === k ? "is-on" : ""} aria-label={k} title={k} onClick={() => setSticker(k)}>
              <StickerPreview kind={k} color={color} />
            </button>
          ))}
        </div>
      ) : null}
      {tool !== "fill" && tool !== "pencil" && (
        <div className="ddSizes" role="group" aria-label="Size">
          {SIZES.map((w, i) => (
            <button key={w} type="button" className={size === i ? "is-on" : ""} aria-label={`Size ${i + 1}`} onClick={() => setSize(i)}>
              <span style={{ width: Math.min(22, 4 + i * 4.5), height: Math.min(22, 4 + i * 4.5), background: tool === "eraser" ? "#fff" : color }} />
            </button>
          ))}
        </div>
      )}
    </div>
  )

  const palette = (
    <div className="ddPalette" role="group" aria-label="Colors">
      <div className="ddCurrent" style={{ background: color }} title="Current color" />
      <div className="ddSwatches">
        {PALETTE.map((c) => (
          <button key={c} type="button" className={`ddSwatch${c === color ? " is-on" : ""}`} style={{ background: c }} aria-label={c} onClick={() => setColor(c)} />
        ))}
        <label className="ddCustom" title="Custom color...">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Custom color" />
          <span>+</span>
        </label>
      </div>
    </div>
  )

  const people = (
    <div className="ddPeople">
      {room ? (
        room.members.map((m) => (
          <span key={m.id} className={`ddPerson${m.away ? " is-away" : ""}`}>
            <i style={{ background: m.color }} />
            {m.me ? "You" : m.name}
          </span>
        ))
      ) : (
        <span className="ddAlone">Drawing alone</span>
      )}
      {room?.invited?.map((n) => (
        <span key={n} className="ddPerson is-invited">
          <i />
          {n}...
        </span>
      ))}
      <PlayOnlineButton size="small" className="ddInvite" label={partner && !others.length ? `Invite ${partner}` : "Draw Online"} sub="Invite someone to draw with you, live" onClick={() => setDialog({ kind: "invite" })} />
    </div>
  )

  return (
    <div className={`ddApp${mobile ? " is-mobile" : ""}`} tabIndex={-1} onKeyDown={onKeyDown}>
      <MenuBar menus={menus} />
      {people}
      <div className="ddMain">
        {!mobile && (
          <div className="ddSide">
            {toolbox}
            {options}
          </div>
        )}
        <div
          className={`ddStage tool-${tool}`}
          ref={stageRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={(e) => e.pointerType === "mouse" && inRoom() && socket.emit("doodle:cursor", { roomId: roomRef.current.id, x: null, y: null })}
          onWheel={onWheel}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="ddPaper" style={view ? { transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.z})` } : { visibility: "hidden" }}>
            <canvas ref={bgRef} className="ddLayer" />
            <canvas ref={inkRef} className="ddLayer" />
            {Object.entries(cursors).map(([pid, c]) => {
              const m = room?.members.find((x) => x.id === pid)
              if (!c || !m || m.me) return null
              return (
                <div key={pid} className="ddCursor" style={{ left: c.x, top: c.y, "--c": m.color, transform: `scale(${1 / (view?.z || 1)})` }}>
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                    <path d="M1 1l6 15 2-6 6-2z" fill={m.color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                  <span>{m.name}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {mobile && (
        <div className="ddBottom">
          {toolbox}
          {options}
        </div>
      )}
      {palette}
      <div className="ddStatus">
        <span>{status || (room ? (others.length ? "Drawing together. Everyone sees every stroke as it's drawn." : "Waiting for someone to join...") : mobile ? "One finger draws. Two fingers move and zoom." : "Draw with the mouse. Wheel zooms; right-drag moves the paper.")}</span>
        <span className="ddStatusButtons">
          <button type="button" onClick={save}>
            Save
          </button>
          {saved && (
            <button type="button" onClick={openInPaint}>
              Open in Paint
            </button>
          )}
        </span>
      </div>

      <GameChat game="doodle" title="Doodle Together" room={room ? `match:${room.id}` : undefined} />

      {dialog?.kind === "invite" && (
        <Dialog title="Draw Together" onCancel={() => setDialog(null)} cancelLabel="Close">
          <div className="ddInviteList">
            <p className="dialogText">Invite someone who's online now: you'll both draw on this page at the same time.</p>
            {!server.online && <ConnectionPanel server={server} />}
            {server.online && inviteOptions.length === 0 && <p className="dialogText">Nobody else is on the network right now. When your partner or a buddy is online, they'll show up here.</p>}
            {inviteOptions.map((o) => (
              <div key={o.key} className="ddInviteRow">
                <span>
                  {o.partner ? "♥ " : ""}
                  <b>{o.name}</b>
                  {o.partner ? " (your partner)" : o.device === "phone" ? " (phone)" : ""}
                </span>
                <button type="button" disabled={o.here} onClick={() => invite(o.to)}>
                  {o.here ? "Here" : "Invite"}
                </button>
              </div>
            ))}
          </div>
        </Dialog>
      )}

      {dialog?.kind === "clearAsk" && (
        <Dialog
          title="Clear the Drawing?"
          okLabel="Clear It"
          cancelLabel="Keep It"
          sound="ding"
          onOk={() => {
            socket?.emit("doodle:clearReply", { roomId: roomRef.current?.id, accept: true })
            setDialog(null)
          }}
          onCancel={() => {
            socket?.emit("doodle:clearReply", { roomId: roomRef.current?.id, accept: false })
            setDialog(null)
          }}
        >
          <p className="dialogText">{dialog.from} wants to clear the whole drawing and start over. Is that OK?</p>
        </Dialog>
      )}

      {dialog?.kind === "clear" && (
        <Dialog title="Clear Drawing" okLabel="Clear" onOk={wipe} onCancel={() => setDialog(null)} sound="ding">
          <p className="dialogText">Clear the whole drawing? This can't be undone.</p>
        </Dialog>
      )}

      {dialog?.kind === "join" && (
        <Dialog
          title="Doodle Together"
          okLabel="Save & Join"
          noLabel="Just Join"
          onOk={() => {
            const roomId = dialog.roomId
            setDialog(null)
            saveToDrive()
            join(roomId)
          }}
          onNo={() => {
            const roomId = dialog.roomId
            setDialog(null)
            join(roomId)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">You're joining a shared drawing. Save the one you have here first?</p>
        </Dialog>
      )}

      {dialog?.kind === "alert" && (
        <Dialog title="Doodle Together" onOk={() => setDialog(null)} sound="ding">
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
    </div>
  )
}

const StickerPreview = ({ kind, color }) => {
  const ref = useRef(null)
  useEffect(() => {
    const c = ref.current
    const g = c.getContext("2d")
    g.clearRect(0, 0, c.width, c.height)
    drawSticker(g, kind, c.width / 2, c.height / 2, c.width * 0.86, color)
  }, [kind, color])
  return <canvas ref={ref} width={26} height={26} />
}

export default Doodle
