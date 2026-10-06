import React, { useEffect, useRef, useState } from "react"
import { useHangout, presence, publishDesk, sendView, takeActs, meKey, onHangoutEvent, join, decline, dismissGift, follow, give, getSnapshot } from "../../../utils/hangout"
import { desktopSnapshot, glide, isPrivate, mayFollow, sameSnapshot, listNames } from "./hangoutCore"
import { getSettings, wallpaperStyle } from "../../../utils/settings"
import { launch, programByName, programs } from "../../../utils/programs"
import { notify, interrupts, openTarget } from "../../../utils/notifications"
import { fs, readContent } from "../../../utils/fs"
import { DRAG_TYPE } from "../../../utils/fsActions"
import "./Hangout.css"

// Come Over's desktop layer, mounted once on the desktop (phone and computer). While you're
// in a hangout it:
//   - sends your cursor (15 times a second at most) or your taps, and which window you're in
//   - draws everyone else's cursor, gliding between updates, with their name and window
//   - tells visitors what your desktop looks like (every 2 s, only when it changed)
//   - does what a visitor asks on your desktop, if you allowed it (open, focus, minimize)
//   - follows someone's view if you asked to (opens what they're looking at, scrolls)
//   - puts files handed to you on your desktop
// and shows invitations ("Ann wants you to come over"), also when you're not in one.

const ARROW = "M1 1 L1 15 L5 11 L8 17 L10 16 L7 10 L12 10 Z"

const wallpaperOf = () => {
  const st = wallpaperStyle(getSettings())
  const m = /url\("?(\/[^")]+)"?\)/.exec(st.backgroundImage || "")
  return { color: st.backgroundColor || "#008080", image: m ? m[1] : "", mode: getSettings().display }
}
const iconsOnScreen = () =>
  [...document.querySelectorAll(".desktopIcon, .mobileIcon")].slice(0, 40).map((el) => ({
    name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40),
    icon: el.querySelector("img")?.getAttribute("src") || "",
    program: el.getAttribute("data-program") || (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40),
  }))

// the scroll position (0..1) of a window's main scrolling area
const scrollerOf = (el) => {
  if (!el) return null
  const all = [el, ...el.querySelectorAll("textarea, .window-body, [data-scroll], div")]
  return all.find((n) => n.scrollHeight > n.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) || null
}

const typeOfGift = (file) => (/^data:image\//.test(file.data) ? "image" : file.type === "richtext" ? "richtext" : file.type === "sound" ? "sound" : "text")

const HangoutLayer = ({ windows, dispatch, mobile }) => {
  const hg = useHangout()
  const me = meKey()
  const [shown, setShown] = useState({}) // key -> { x, y } on screen, gliding
  const target = useRef({})
  const lastDesk = useRef(null)
  const windowsRef = useRef(windows)
  windowsRef.current = windows
  const people = hg.state?.people || []
  const colorOf = (key) => people.find((p) => p.key === key)?.color || "#d00000"
  const nameOf = (key) => people.find((p) => p.key === key)?.name || key

  // ---- my cursor and taps ----
  useEffect(() => {
    if (!hg.id) return
    const focusNow = () => {
      const w = windowsRef.current.find((x) => x.active && !x.closed && !x.minimized)
      return w ? { app: String(w.app || ""), title: isPrivate(w.app) ? "" : String(w.name || "").slice(0, 60) } : null
    }
    const move = (e) => {
      if (e.pointerType === "touch") return
      presence(e.clientX / window.innerWidth, e.clientY / window.innerHeight, { focus: focusNow() })
    }
    const down = (e) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return
      presence(e.clientX / window.innerWidth, e.clientY / window.innerHeight, { tap: true, focus: focusNow() })
    }
    window.addEventListener("pointermove", move, { passive: true })
    window.addEventListener("pointerdown", down, { passive: true })
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerdown", down)
    }
  }, [hg.id])

  // ---- everyone else's cursors glide toward their latest spot ----
  useEffect(() => {
    target.current = hg.cursors
  }, [hg.cursors])
  useEffect(() => {
    if (!hg.id) return
    let raf = 0
    let last = performance.now()
    const frame = (t) => {
      const dt = t - last
      last = t
      setShown((prev) => {
        const next = {}
        let moved = false
        for (const [k, c] of Object.entries(target.current)) {
          if (k === me) continue
          const to = { x: c.x * window.innerWidth, y: c.y * window.innerHeight }
          const g = glide(prev[k], to, dt)
          next[k] = g
          if (!prev[k] || Math.abs(prev[k].x - g.x) > 0.3 || Math.abs(prev[k].y - g.y) > 0.3) moved = true
        }
        if (Object.keys(prev).length !== Object.keys(next).length) moved = true
        return moved ? next : prev
      })
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [hg.id, me])

  // ---- my desktop, for visitors ----
  useEffect(() => {
    if (!hg.id) {
      lastDesk.current = null
      return
    }
    const tick = () => {
      const snap = desktopSnapshot({ windows: windowsRef.current, icons: iconsOnScreen(), wallpaper: wallpaperOf(), screen: { w: window.innerWidth, h: window.innerHeight }, mobile })
      if (lastDesk.current && sameSnapshot(lastDesk.current, snap)) return
      lastDesk.current = snap
      publishDesk(snap)
    }
    tick()
    const id = setInterval(tick, 2000)
    return () => clearInterval(id)
  }, [hg.id, mobile])

  // ---- a visitor's action on my desktop (only arrives if I allowed it) ----
  useEffect(() => {
    if (!hg.acts.length) return
    for (const { from, act } of takeActs()) {
      if (act.type === "open") {
        const program = programByName(act.program)
        if (!program || isPrivate(program.app)) continue
        dispatch({ type: "open_window", payload: launch(program.name) })
        notify({ app: "hangout", title: `${from} opened ${program.name}`, text: "On your desktop (you let friends touch it in Come Over)." })
      } else if (act.type === "focus" || act.type === "minimize") {
        const open = windowsRef.current.map((w, index) => ({ w, index })).filter(({ w }) => !w.closed)
        const pick = open[act.index]
        if (!pick || isPrivate(pick.w.app)) continue
        dispatch({ type: act.type === "focus" ? "focus_window" : "toggle_minimize", payload: { index: pick.index } })
      }
    }
  }, [hg.acts])

  // ---- follow mode: as the leader, say what I'm looking at (only if someone follows) ----
  const followers = people.filter((p) => p.watching === me)
  useEffect(() => {
    if (!hg.id || !followers.length) return
    let lastSent = ""
    const tick = () => {
      const index = windowsRef.current.findIndex((w) => w.active && !w.closed && !w.minimized)
      const w = windowsRef.current[index]
      if (!w) return
      const app = String(w.app || "").toLowerCase()
      const el = document.querySelector(`[data-window-index="${index}"]`)
      const doc = el?.querySelector("[data-shared]")?.getAttribute("data-shared") || undefined
      const sc = scrollerOf(el)
      const scroll = sc ? Math.round((sc.scrollTop / Math.max(1, sc.scrollHeight - sc.clientHeight)) * 1000) / 1000 : undefined
      const v = mayFollow(app) && !isPrivate(app) ? { app, title: String(w.name || "").slice(0, 80), doc, scroll } : { app: "private" }
      const key = JSON.stringify(v)
      if (key === lastSent) return
      lastSent = key
      sendView(v)
    }
    const id = setInterval(tick, 300)
    return () => clearInterval(id)
  }, [hg.id, followers.length, me])

  // ---- follow mode: as a follower, mirror the leader ----
  const watchingKey = people.find((p) => p.key === me)?.watching || null
  useEffect(() => {
    const v = hg.view
    if (!watchingKey || !v || v.k !== watchingKey || v.app === "private" || !mayFollow(v.app)) return
    const list = windowsRef.current
    if (v.doc && (v.app === "notepad" || v.app === "paint")) {
      const open = list.findIndex((w) => !w.closed && w.handoff?.shared === v.doc)
      if (open >= 0) dispatch({ type: "focus_window", payload: { index: open } })
      else openTarget({ kind: "program", name: v.app === "paint" ? "Paint" : "Notepad", extra: { handoff: { id: Date.now(), shared: v.doc, title: v.title?.replace(/ \(shared\).*$/, "") } } })
    } else {
      const open = list.findIndex((w) => !w.closed && String(w.app).toLowerCase() === v.app)
      if (open >= 0) {
        if (!list[open].active) dispatch({ type: "focus_window", payload: { index: open } })
      } else {
        const program = programs.find((p) => String(p.app).toLowerCase() === v.app)
        if (program && !isPrivate(program.app)) dispatch({ type: "open_window", payload: launch(program.name) })
      }
    }
    if (typeof v.scroll === "number") {
      requestAnimationFrame(() => {
        const index = windowsRef.current.findIndex((w) => w.active && !w.closed)
        const el = document.querySelector(`[data-window-index="${index}"]`)
        const sc = scrollerOf(el)
        if (sc) sc.scrollTop = v.scroll * (sc.scrollHeight - sc.clientHeight)
      })
    }
  }, [hg.view, watchingKey])

  // ---- invitations, shared documents and handed files ----
  useEffect(() => {
    const offInvite = onHangoutEvent("hg:invite", (inv) => {
      if (!interrupts("hangout", inv.from)) return
      notify({ app: "hangout", key: `hg-${inv.id}`, title: `${inv.from} wants you to come over`, text: "Join them on their desktop.", target: { kind: "program", name: "Come Over", extra: { handoff: { id: Date.now(), hangout: inv.id } } } })
    })
    const offDoc = onHangoutEvent("hg:doc", (d) => {
      const kind = d.meta?.kind === "paint" ? "picture" : d.meta?.kind === "folder" ? "folder" : "note"
      notify({ app: "hangout", key: `hgdoc-${d.id}`, title: `${d.from} shared a ${kind}: ${d.meta?.title || ""}`, text: "Open it to work on it together.", target: d.meta?.kind === "folder" ? { kind: "program", name: "Come Over", extra: { handoff: { id: Date.now(), tab: "shared" } } } : { kind: "program", name: d.meta?.kind === "paint" ? "Paint" : "Notepad", extra: { handoff: { id: Date.now(), shared: d.id, title: d.meta?.title } } } })
    })
    const offGift = onHangoutEvent("hg:gift", async (g) => {
      try {
        const desk = fs.resolve("C:/Desktop")
        const file = fs.createFileIn(desk, g.file.name, typeOfGift(g.file), g.file.data)
        notify({ app: "hangout", title: `${g.from} handed you ${file.name}`, text: "It's on your desktop." })
      } catch (error) {
        notify({ app: "hangout", title: `${g.from} tried to hand you ${g.file.name}`, text: error?.message || "There wasn't room for it." })
      }
      dismissGift(getSnapshot().gifts.find((x) => x.file === g.file))
    })
    return () => {
      offInvite()
      offDoc()
      offGift()
    }
  }, [])

  // drop a file from the desktop or My Computer onto a friend's cursor: hand it over
  const dropOn = (key) => async (e) => {
    const path = e.dataTransfer?.getData(DRAG_TYPE)
    if (!path) return
    e.preventDefault()
    await handFile(key, path)
  }

  const invite = hg.invites[hg.invites.length - 1]
  const now = Date.now()
  const watchingName = watchingKey ? nameOf(watchingKey) : null

  return (
    <>
      {hg.id && (
        <div className="hgLayer" aria-hidden="true" data-hangout-layer>
          {Object.entries(shown).map(([k, p]) => {
            const c = hg.cursors[k] || {}
            const stale = now - (c.at || 0) > 20_000
            const tapped = c.tapAt && now - c.tapAt < 700
            return (
              <div key={k} className={`hgCursor${stale ? " is-stale" : ""}`} style={{ transform: `translate(${p.x}px, ${p.y}px)` }} data-cursor={k}>
                {tapped && <span className="hgRipple" style={{ borderColor: colorOf(k) }} />}
                <svg width="14" height="19" viewBox="0 0 14 19" className="hgArrow">
                  <path d={ARROW} fill={colorOf(k)} stroke="#000" strokeWidth="1" />
                </svg>
                <span className="hgTag" style={{ background: colorOf(k) }} onDragOver={(e) => e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()} onDrop={dropOn(k)}>
                  {nameOf(k)}
                  {c.focus && c.focus.app && <small>{c.focus.app === "private" ? " · busy" : c.focus.title ? ` · ${c.focus.title}` : ""}</small>}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {watchingName && (
        <div className="hgFollowBar window" data-following={watchingKey}>
          <span>Following {watchingName}</span>
          {hg.view?.app === "private" && <small> ({watchingName} is in a private program)</small>}
          <button type="button" onClick={() => follow(null)}>
            Stop
          </button>
        </div>
      )}
      {invite && !hg.id && (
        <div className="hgInvite window" role="dialog" aria-label="Come Over invitation" data-hg-invite={invite.id}>
          <div className="title-bar">
            <div className="title-bar-text">Come Over</div>
          </div>
          <div className="window-body">
            <p>
              <b>{invite.from}</b> wants you to come over: you'll see each other's pointers and desktops, and can work on things together.
            </p>
            <div className="hgRow">
              <button type="button" onClick={() => join(invite.id)} data-hg-accept>
                Join
              </button>
              <button type="button" onClick={() => decline(invite.id)}>
                Not Now
              </button>
            </div>
          </div>
        </div>
      )}
      {followers.length > 0 && !mobile && <div className="hgShareNote">{listNames(followers.map((f) => f.name))} {followers.length > 1 ? "are" : "is"} following your view</div>}
    </>
  )
}

// hand a file from the drive to someone in the hangout
export const handFile = async (key, path) => {
  try {
    const item = fs.resolve(path)
    const file = item && !item.isDirectory ? item : null
    if (!file) return { ok: false, error: "Pick a file to hand over." }
    await readContent(file)
    const res = await give(key, { name: file.name, type: file.type, data: file.textContent || "" })
    if (!res.ok) notify({ app: "hangout", title: "Couldn't hand it over", text: res.error || "" })
    return res
  } catch (error) {
    return { ok: false, error: error?.message }
  }
}

export default HangoutLayer
