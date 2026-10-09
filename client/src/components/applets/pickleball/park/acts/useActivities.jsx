import React, { useEffect, useRef, useState } from "react"
import MoreOptions from "../../../../shared/MoreOptions"
import { useNet } from "../../../network/NetContext"
import { ActHud } from "./ActivityHud.jsx"
import { addStats, fitnessOf } from "./stats.js"
import { MOVES, MOVE_IDS } from "./workout.js"
import "./acts.css"

// My Park activities (the owner: "other fun activities to do at each venue"): the context
// button at an activity's spot opens a small sheet (the 1-3 ways to do it, a friend near you
// as one more, the rest under More options); picking one starts it in the park
// (world.setActivity) with its own screen (ActivityHud.jsx). With a friend: an ask through
// My Park > Together (server/park/together.js kinds tennis / horse / workout); a yes makes a
// private "parkact" room (server/arcade/games/parkact.js) and both screens start together.
//
// useActivities({ world, prefs, setPrefs, aim, mobile, showPad, padSide, onWatchLive })
//   -> { onEvent(ev) -> handled?, overlays, running }

const LEVELS = [
  ["easy", "Easy"],
  ["normal", "Normal"],
  ["hard", "Hard"],
]
const ASK_KIND = { tennis: "tennis", hoops: "horse", workout: "workout" }

// what each sheet offers (pal: a friend near you, by name)
export const sheetFor = (spot, { pal = null, stats = {}, move = "squat" } = {}) => {
  if (!spot) return null
  const k = spot.kind
  if (k === "tennis")
    return {
      title: spot.name,
      items: [
        { id: "match", icon: "🎾", label: "vs the computer", sub: "First to 4 games" },
        { id: "rally", icon: "🔁", label: "Rally challenge", sub: stats.tennis?.best ? `Your best: ${stats.tennis.best} in a row` : "How many in a row?" },
        ...(pal ? [{ id: "pal:match", icon: "💞", label: `Play ${pal.name}`, sub: "First to 4 games", pal: true }, { id: "pal:rally", icon: "🤝", label: `Rally with ${pal.name}`, sub: "Keep it going together", pal: true }] : []),
      ],
      hint: "Run with the move pad. Swipe up to hit: the angle aims, a faster swipe hits harder.",
      level: true,
    }
  if (k === "hoops")
    return {
      title: spot.name,
      items: [
        { id: "free", icon: "🏀", label: "Shoot around", sub: stats.hoops?.streak ? `Best streak: ${stats.hoops.streak}` : "Makes and streaks" },
        { id: "world", icon: "🌎", label: "Around the world", sub: stats.hoops?.world ? `Best: ${stats.hoops.world} shots` : "Seven spots, make each" },
        { id: "horse", icon: "🐴", label: "H-O-R-S-E", sub: "vs the computer" },
        ...(pal ? [{ id: "pal:horse", icon: "💞", label: `H-O-R-S-E with ${pal.name}`, sub: "Make it, they match it", pal: true }] : []),
      ],
      hint: "Swipe up to shoot: how far up is how hard (half way is just right), the angle aims. Walk with the move pad.",
      level: true,
    }
  if (k === "workout")
    return {
      title: spot.name,
      items: [
        { id: "daily", icon: "📅", label: "Today's workout", sub: fitnessOf(stats).today ? "Done today: go again?" : "Five moves, about 2 minutes" },
        { id: "quick", icon: "⚡", label: "Quick set", sub: `${(MOVES[move] || MOVES.squat).name}, 30 seconds` },
        ...(pal ? [{ id: "pal:together", icon: "💞", label: `Work out with ${pal.name}`, sub: "Same beat, side by side", pal: true }] : []),
      ],
      hint: "Tap (or swipe down for rows) in time with the beat: every rep on the beat counts.",
      camera: true,
      moves: true,
    }
  if (k === "tv")
    return {
      title: spot.name,
      items: [
        { id: "live", icon: "📡", label: "Live courts", sub: "A friend's game, live" },
        { id: "videos", icon: "🎞", label: "My videos", sub: "Your highlight reels" },
        ...(pal ? [{ id: "together", icon: "💞", label: `YouTube with ${pal.name}`, sub: "Watch Together" }] : [{ id: "youtube", icon: "▶", label: "YouTube", sub: "Watch Together" }]),
      ],
      hint: null,
    }
  return null
}

export const useActivities = ({ world, prefs, setPrefs, aim, mobile = false, showPad = false, padSide = "left", onWatchLive = null }) => {
  const net = useNet()
  const [sheet, setSheet] = useState(null) // { spot, pal }
  const [run, setRun] = useState(null) // the running activity's object
  const [hud, setHud] = useState(null)
  const [note, setNote] = useState(null)
  const [pending, setPending] = useState(null) // an ask out: { kind, name }
  const runRef = useRef(null)
  runRef.current = run
  const linkRef = useRef(null)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const say = (text) => setNote({ text, id: Date.now() })
  useEffect(() => {
    if (!note) return
    const id = setTimeout(() => setNote((n) => (n?.id === note.id ? null : n)), 3600)
    return () => clearTimeout(id)
  }, [note])
  // left the park (or another venue): whatever was running is over
  useEffect(() => {
    if (world) return
    setSheet(null)
    stopRun(false)
  }, [world])
  useEffect(() => () => stopRun(false), [])

  // ---- a friend's room (relay) for a game together ----
  const makeLink = (d) => {
    const socket = net?.socket
    if (!socket || !d.roomId) return null
    const roomId = d.roomId
    const fns = new Set()
    const fire = (type, data) => fns.forEach((f) => f(type, data))
    const h = {
      "room:snap": (m) => m?.roomId === roomId && fire("snap", m.data),
      "room:input": (m) => m?.roomId === roomId && fire("input", m.data),
      "room:relay": (m) => m?.roomId === roomId && m.data && fire(m.data.t, m.data),
      "room:state": (v) => v?.id === roomId && v.phase !== "playing" && fire("left", {}),
      "room:gone": (m) => m?.roomId === roomId && fire("left", {}),
    }
    for (const [ev, fn] of Object.entries(h)) socket.on(ev, fn)
    const link = {
      roomId,
      host: d.host === d.me,
      team: d.host === d.me ? 0 : 1,
      num: d.with,
      name: d.name,
      look: d.look,
      seed: d.seed,
      send(type, data = {}) {
        if (!socket.connected) return
        // (dev: what goes over the wire, for the docs' numbers)
        if (import.meta.env?.DEV) {
          const b = (window.__actBytes ||= {})
          b[type] = (b[type] || 0) + JSON.stringify(data).length
          b.n = (b.n || 0) + 1
        }
        if (type === "snap") socket.volatile.emit("room:snap", { roomId, data })
        else if (type === "input") socket.volatile.emit("room:input", { roomId, data })
        else net.request("room:relay", { roomId, data: { ...data, t: type } })
      },
      on(fn) {
        fns.add(fn)
        return () => fns.delete(fn)
      },
      close() {
        for (const [ev, fn] of Object.entries(h)) socket.off(ev, fn)
        fns.clear()
        if (socket.connected) net.request("room:leave", { roomId })
      },
    }
    return link
  }

  // ---- start and stop ----
  const startRun = async (spot, opts = {}) => {
    if (!world || !spot) return
    setSheet(null)
    stopRun(false)
    let r = null
    try {
      if (spot.kind === "tennis") {
        const { createTennisRun } = await import("./tennisRun.js")
        r = createTennisRun({ spot, mode: opts.mode || "match", level: opts.level || prefsRef.current.actLevel || "normal", link: opts.link || null, opp: opts.link ? { name: opts.link.name, look: opts.link.look } : null, seed: opts.link?.seed })
      } else if (spot.kind === "hoops") {
        const { createHoopsRun } = await import("./hoopsRun.js")
        r = createHoopsRun({ spot, mode: opts.mode || "free", level: prefsRef.current.actLevel || "normal", link: opts.link || null, opp: opts.link ? { name: opts.link.name, look: opts.link.look } : null, seed: opts.link?.seed })
      } else if (spot.kind === "workout") {
        const { createWorkoutRun } = await import("./workoutRun.js")
        r = createWorkoutRun({ spot, mode: opts.mode || "daily", move: opts.move || prefsRef.current.actMove || null, link: opts.link || null, mate: opts.link ? { name: opts.link.name, look: opts.link.look } : null, seed: opts.link?.seed, camera: !!opts.camera, stats: prefsRef.current.actStats || {} })
      } else if (spot.kind === "tv") {
        const { createTvRun } = await import("./tvRun.js")
        r = createTvRun({ spot, channel: opts.channel || "live" })
      }
    } catch (e) {
      console.error(e)
      say("That didn't load. Please try again.")
      opts.link?.close()
      return
    }
    if (!r) return
    linkRef.current = opts.link || null
    if (opts.link) {
      opts.link.on((type) => {
        if (type === "left" && runRef.current === r) {
          say(`${opts.link.name || "Your friend"} left.`)
          stopRun(true)
        }
      })
    }
    r.unsub = r.subscribe((h) => setHud(h))
    world.setActivity(r)
    setRun(r)
  }
  function stopRun(save = true) {
    const r = runRef.current
    if (!r) return
    runRef.current = null
    if (save) {
      const res = r.result?.()
      if (res) setPrefs({ actStats: addStats(prefsRef.current.actStats || {}, res) })
    }
    r.unsub?.()
    world?.activity === r && world.setActivity(null)
    linkRef.current?.close()
    linkRef.current = null
    setRun(null)
    setHud(null)
  }

  // ---- the sheet's choices ----
  const choose = async (item) => {
    const s = sheet
    if (!s) return
    const spot = s.spot
    if (item.pal) {
      const [, mode] = item.id.split(":")
      setSheet(null)
      const r = await world?.tgAsk(ASK_KIND[spot.kind], s.pal.num, { spot: spot.id, mode })
      if (r?.ok) {
        setPending({ kind: spot.kind, name: s.pal.name })
        say(`Asked ${s.pal.name}...`)
      } else say(r?.error || "That didn't work. Please try again.")
      return
    }
    if (spot.kind === "tv") {
      if (item.id === "together" || item.id === "youtube") {
        setSheet(null)
        if (aim?.openTogether) aim.openTogether(s.pal ? { with: s.pal.name } : {})
        else say("Watch Together needs 98 Messenger. Sign on first.")
        return startRun(spot, { channel: "together" })
      }
      if (item.id === "live" && onWatchLive) {
        setSheet(null)
        const r = await net?.request?.("bc:list", {})
        const live = r?.ok ? r.live || [] : []
        if (!live.length) return startRun(spot, { channel: "nolive" })
        return startRun(spot, { channel: "live", live })
      }
      return startRun(spot, { channel: item.id })
    }
    startRun(spot, { mode: item.id, camera: !!s.camera })
  }

  const onEvent = (ev) => {
    if (ev.type === "activity") {
      if (runRef.current) return true
      setSheet({ spot: ev.spot, pal: ev.pal || null, camera: false })
      return true
    }
    if (ev.type === "actStart") {
      setPending(null)
      if (!ev.spot) {
        say("That spot isn't at this venue.")
        return true
      }
      const link = makeLink(ev)
      if (!link) return true
      const mode = ev.kind === "horse" ? "horse" : ev.kind === "workout" ? "together" : ev.mode
      startRun(ev.spot, { mode, link })
      return true
    }
    if (ev.type === "tgAnswer" && pending && !ev.yes) setPending(null)
    return false
  }

  const stats = prefs.actStats || {}
  const sh = sheet ? sheetFor(sheet.spot, { pal: sheet.pal, stats, move: prefs.actMove || "squat" }) : null
  const overlays = (
    <>
      {sh && (
        <div className="pkCenter pkDim pkTgSheetWrap" onClick={(e) => e.target === e.currentTarget && setSheet(null)}>
          <div className="pkPanel window pkTgSheet pkActSheet" data-act="sheet" data-kind={sheet.spot.kind} role="dialog" aria-label={sh.title}>
            <div className="pkParkMenuHead">
              <b>{sh.title}</b>
              <button type="button" className="pkParkVenuesX" onClick={() => setSheet(null)} aria-label="Close" data-act="close">
                ×
              </button>
            </div>
            <div className="pkTgGrid">
              {sh.items.map((it) => (
                <button type="button" key={it.id} className="pkTgItem is-big" onClick={() => choose(it)} disabled={!!pending && it.pal} data-act={`do-${it.id}`}>
                  <span className="pkTgIcon" aria-hidden="true">
                    {it.icon}
                  </span>
                  <b>{it.label}</b>
                  {it.sub && <small>{it.sub}</small>}
                </button>
              ))}
            </div>
            {(sh.level || sh.camera || sh.moves) && (
              <MoreOptions id={`pickleball.act.${sheet.spot.kind}`} summary={sh.level ? "How good the computer is" : "The quick set's move, real reps with the camera"}>
                {sh.moves && (
                  <div className="pkActMoves" role="radiogroup" aria-label="The quick set's move">
                    {MOVE_IDS.filter((m) => sheet.spot.treadmill || !MOVES[m].treadmill).map((m) => (
                      <button type="button" key={m} role="radio" aria-checked={(prefs.actMove || "squat") === m} className={(prefs.actMove || "squat") === m ? "is-on" : ""} onClick={() => setPrefs({ actMove: m })} data-act={`move-${m}`}>
                        {MOVES[m].icon} {MOVES[m].name}
                      </button>
                    ))}
                  </div>
                )}
                {sh.level && (
                  <div className="pkActLevels" role="radiogroup" aria-label="How good the computer is">
                    {LEVELS.map(([id, name]) => (
                      <button type="button" key={id} role="radio" aria-checked={(prefs.actLevel || "normal") === id} className={(prefs.actLevel || "normal") === id ? "is-on" : ""} onClick={() => setPrefs({ actLevel: id })} data-act={`level-${id}`}>
                        {name}
                      </button>
                    ))}
                  </div>
                )}
                {sh.camera && (
                  <label className="pkActCam">
                    <input type="checkbox" checked={!!sheet.camera} onChange={(e) => setSheet((s) => ({ ...s, camera: e.target.checked }))} data-act="camera" /> Real workout: count my real reps with the camera (on this phone only, nothing is sent)
                  </label>
                )}
              </MoreOptions>
            )}
            {sh.hint && <p className="pkTgHint">{sh.hint}</p>}
          </div>
        </div>
      )}
      {run && hud && (
        <ActHud
          run={run}
          hud={hud}
          mobile={mobile}
          showPad={showPad}
          padSide={padSide}
          onLeave={() => stopRun(true)}
          onAgain={() => {
            // (the result so far goes on your record first: a match won, a workout done)
            const res = run.result?.()
            if (res) setPrefs({ actStats: addStats(prefsRef.current.actStats || {}, res) })
            run.again?.()
          }}
          fitness={fitnessOf(hud.over && run.result?.() ? addStats(stats, run.result()) : stats)}
          actions={{
            watchLive: (it) => {
              stopRun(true)
              onWatchLive?.(it)
            },
            together: () => {
              if (aim?.openTogether) aim.openTogether({})
              else say("Watch Together needs 98 Messenger. Sign on first.")
            },
          }}
        />
      )}
      {note && <div className="pkTgNote pkActNote" role="status" data-act="note">{note.text}</div>}
    </>
  )
  return { onEvent, overlays, running: !!run, kind: run?.kind || null, sheetOpen: !!sheet, stop: () => stopRun(true) }
}
