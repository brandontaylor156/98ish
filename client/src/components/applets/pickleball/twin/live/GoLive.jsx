// Live Broadcast, the filming phone (Pickleball 98 > Real Games > Go Live): set the game up,
// point the phone at the court from the fence, tap the corners, and go live. Friends watch
// the game in 3D at the same venue and court while it's played. Only tracked positions and
// hits leave the phone (liveReader.js / packet.js); never the picture or the sound.
//
// Steps: setup (where, who) -> camera (+ the corners, Calibrate with live pictures) -> live
// (status, score taps, share the link, end) -> ended (saved to Twin Replay).

import React, { useEffect, useMemo, useRef, useState } from "react"
import MoreOptions from "../../../../shared/MoreOptions"
import { Select } from "../../../../shared/select/Combo"
import { useNet } from "../../../network/NetContext"
import { useAim } from "../../../aim/AimContext"
import { shareOut } from "../../../../../utils/share"
import { Calibrate } from "../Calibrate"
import { courtsOf, venueChoices } from "../venues.js"
import { newId, putGame } from "../store.js"
import { HALF_L, HALF_W } from "../core/homography.js"
import { call as scoreCall, newGame as newScore, rally as scoreRally } from "../../../pbclub/scoring.js"
import { snapshot, startLive } from "./liveReader.js"
import { createStream } from "./stream.js"
import "../TwinReplay.css"
import "./Live.css"

const DOTS = ["#3c8cff", "#29c46b", "#ff8a2a", "#e84fd0"]

export default function GoLive({ onExit, onOpenTwin = null }) {
  const net = useNet()
  const aim = useAim()
  const myName = aim?.me?.screenName || ""
  const [step, setStep] = useState("setup")
  const [venue, setVenue] = useState(venueChoices().find((v) => v.real)?.id || "stadium")
  const [courts, setCourts] = useState([])
  const [court, setCourt] = useState(null)
  const [title, setTitle] = useState("")
  const [players, setPlayers] = useState(4)
  const [names, setNames] = useState(() => [myName || "Me", "", "", ""])
  const [notify, setNotify] = useState(true)
  const [error, setError] = useState(null)
  const [status, setStatusState] = useState("")
  const setStatus = (s) => {
    statusRef.current = s
    setStatusState(s)
  }
  const [taps, setTaps] = useState(null)
  const [cast, setCast] = useState(null) // { id, code }
  const [viewers, setViewers] = useState(0)
  const [stats, setStats] = useState(null)
  const [score, setScore] = useState(null)
  const [reactions, setReactions] = useState([])
  const [saved, setSaved] = useState(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null) // the camera's MediaStream
  const liveRef = useRef(null) // startLive's handle
  const ownRef = useRef(null) // our own copy of what we send (saved as a Twin Replay game)
  const dotsRef = useRef(null)
  const wakeRef = useRef(null)
  const statusRef = useRef("")
  const online = net?.status === "online"
  const real = venueChoices().find((v) => v.id === venue)?.real

  useEffect(() => {
    if (!real) return setCourts([])
    courtsOf(venue).then((cs) => {
      setCourts(cs)
      setCourt((c) => (cs.some((x) => String(x.id) === String(c)) ? c : cs[0]?.id ?? null))
    })
  }, [venue, real])

  const roster = useMemo(() => Array.from({ length: players }, (_, i) => ({ name: (names[i] || "").trim() || `Player ${i + 1}`, team: i < players / 2 ? 0 : 1 })), [players, names])
  const venueName = venueChoices().find((v) => v.id === venue)?.short || "the courts"
  const courtName = courts.find((c) => String(c.id) === String(court))?.name || null

  // the camera (back camera, sound without the phone's voice processing: the paddle pop)
  const openCamera = async () => {
    setError(null)
    try {
      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      } catch {
        // (no microphone allowed: the camera alone still works, hits come from the swings)
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } })
      }
      streamRef.current = stream
      setStep("camera")
    } catch (e) {
      setError(e?.name === "NotAllowedError" ? "Pickleball 98 needs the camera to go live. Allow it in the browser's settings." : `The camera didn't start (${e?.message || e}).`)
    }
  }
  useEffect(() => {
    const v = videoRef.current
    if (v && streamRef.current && v.srcObject !== streamRef.current) {
      v.srcObject = streamRef.current
      v.play().catch(() => {})
    }
  })
  const snap = async () => {
    const v = videoRef.current
    for (let i = 0; i < 50 && (!v || v.readyState < 2); i++) await new Promise((r) => setTimeout(r, 100))
    if (!v || v.readyState < 2) throw new Error("The camera isn't showing a picture yet.")
    return snapshot(v)
  }

  // go live: the server first (the id and link), then the reader
  const goLive = async ({ taps: t, players: p }) => {
    setTaps(t)
    setPlayers(p)
    setError(null)
    if (!online) return setError("Going live needs the network: sign on to 98 Messenger (your buddies are the ones told).")
    const list = Array.from({ length: p }, (_, i) => roster[i] || { name: `Player ${i + 1}`, team: i < p / 2 ? 0 : 1 })
    const r = await net.request("bc:start", { title: title.trim() || `${myName || "A"} game at ${venueName}`, venue, court, venueName, courtName, players: list, notify })
    if (!r?.ok) return setError(r?.error || "Couldn't go live.")
    setCast({ id: r.id, code: r.code })
    // (dev: what the browser tests read)
    if (import.meta.env?.DEV) window.__goLive = { id: r.id, code: r.code, own: () => ownRef.current, stats: () => liveRef.current?.stats() || null, sent: [] }
    const own = createStream({ players: list, keep: Infinity })
    ownRef.current = own
    const rosterEvent = { k: "roster", t: 0, players: list }
    own.addEvent(rosterEvent)
    net.request("bc:ev", rosterEvent)
    setScore(newScore({ format: p === 2 ? "singles" : "doubles" }))
    setStep("live")
    try {
      wakeRef.current = await navigator.wakeLock?.request?.("screen")
    } catch {
      // (no wake lock: the phone's own auto-lock setting applies)
    }
    liveRef.current = await startLive({
      video: videoRef.current,
      stream: streamRef.current,
      taps: t,
      players: p,
      onStatus: setStatus,
      onTick: (bytes, { t }) => {
        own.addTick(bytes)
        if (import.meta.env?.DEV) (window.__goLive.sent ||= []).push([Date.now(), Math.round(t * 1000) / 1000, bytes.length])
        if (net.socket?.connected) net.socket.volatile.emit("bc:tick", bytes)
      },
      onHit: (e) => {
        own.addEvent(e)
        net.request("bc:ev", e)
      },
      onFrame: ({ tracks, slots }) => {
        // (the reader's start-up words go once it's reading)
        if (statusRef.current) setStatus("")
        drawDots(tracks, slots)
      },
    })
    setStatus("")
  }

  // the little court with everyone's dot (so the person filming sees it's working)
  const drawDots = (tracks, slots) => {
    const c = dotsRef.current
    if (!c) return
    const g = c.getContext("2d")
    const w = c.width
    const h = c.height
    const sx = (x) => w / 2 + (x / (HALF_W + 1.5)) * (w / 2)
    const sz = (z) => h / 2 + (z / (HALF_L + 1.5)) * (h / 2)
    g.fillStyle = "#1d3f7a"
    g.fillRect(0, 0, w, h)
    g.strokeStyle = "#fff"
    g.strokeRect(sx(-HALF_W), sz(-HALF_L), sx(HALF_W) - sx(-HALF_W), sz(HALF_L) - sz(-HALF_L))
    g.beginPath()
    g.moveTo(sx(-HALF_W - 0.3), sz(0))
    g.lineTo(sx(HALF_W + 0.3), sz(0))
    g.stroke()
    for (const tr of tracks) {
      const slot = slots.get(tr.id)
      g.fillStyle = slot === undefined ? "#999" : DOTS[slot % 4]
      g.beginPath()
      g.arc(sx(tr.x), sz(tr.z), 5, 0, Math.PI * 2)
      g.fill()
    }
  }

  // viewers, reactions, the end
  useEffect(() => {
    const s = net?.socket
    if (!s || !cast) return
    const onInfo = (d) => d?.id === cast.id && setViewers(d.viewers || 0)
    const onReact = (d) => {
      const id = Math.random()
      setReactions((r) => [...r.slice(-8), { id, e: d.e, name: d.name }])
      setTimeout(() => setReactions((r) => r.filter((x) => x.id !== id)), 2600)
    }
    const onEnd = (d) => d?.id === cast.id && step === "live" && finish(false)
    s.on("bc:info", onInfo)
    s.on("bc:react", onReact)
    s.on("bc:end", onEnd)
    return () => {
      s.off("bc:info", onInfo)
      s.off("bc:react", onReact)
      s.off("bc:end", onEnd)
    }
  })
  useEffect(() => {
    if (step !== "live") return
    const id = setInterval(() => liveRef.current && setStats(liveRef.current.stats()), 1000)
    return () => clearInterval(id)
  }, [step])

  const point = (team) => {
    if (!score || score.over) return
    const next = scoreRally(score, team).state
    setScore(next)
    const e = { k: "score", t: Math.round((liveRef.current?.clock() || 0) * 1000), a: next.score[0], b: next.score[1], call: scoreCall(next), over: !!next.over }
    ownRef.current?.addEvent(e)
    net.request("bc:ev", e)
  }

  const share = () => {
    if (!cast) return
    const url = `${location.origin}/?open=program&name=Pickleball%2098&live=${cast.id}&code=${cast.code}`
    shareOut({ title: "Watch my game live", text: `I'm live at ${venueName}: watch it in 3D in Pickleball 98`, url }, "apps", { title: "Live game" })
  }

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }
  const finish = async (tell = true) => {
    const live = liveRef.current
    liveRef.current = null
    await live?.stop()
    if (tell) net?.request("bc:stop", {})
    stopCamera()
    wakeRef.current?.release?.().catch(() => {})
    setStep("ended")
    // what was sent, kept as a Twin Replay game (tracked data: a few hundred KB an hour)
    const own = ownRef.current
    if (own && own.newest > 5) {
      try {
        const analysis = own.toAnalysis()
        const g = { id: newId(), title: title.trim() || `Live at ${venueName}`, created: Date.now() - Math.round(own.newest * 1000), duration: analysis.duration, venue: real ? venue : null, court: real ? court : null, analysis, live: true, thumb: null }
        await putGame(g)
        setSaved(g)
      } catch (e) {
        setError(e.message)
      }
    }
  }
  // leaving the screen mid-broadcast ends it
  useEffect(
    () => () => {
      if (liveRef.current) {
        liveRef.current.stop()
        net?.request("bc:stop", {})
      }
      stopCamera()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  return (
    <div className="pkTwin pkLive" data-view={step}>
      {(step === "camera" || step === "live") && <video ref={videoRef} className="pkLiveCam" muted playsInline autoPlay aria-label="The camera" />}

      {step === "setup" && (
        <div className="pkTwinHome">
          <div className="pkPanel window pkTwinHero">
            <b className="pkTwinBig">Go Live</b>
            <p>Put this phone on the fence and your friends watch the game live in 3D, at this court, from anywhere. Only where everyone is goes out; the video stays on this phone.</p>
            <label className="pkTwinRow">
              <span>Where</span>
              <Select value={venue} onChange={(e) => setVenue(e.target.value)} aria-label="Venue" data-field="live-venue">
                {venueChoices().map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.short}
                  </option>
                ))}
              </Select>
            </label>
            {courts.length > 0 && (
              <label className="pkTwinRow">
                <span>Court</span>
                <Select value={String(court ?? "")} onChange={(e) => setCourt(e.target.value)} aria-label="Court" data-field="live-court">
                  {courts.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <div className="pkTwinRow">
              <span>Game</span>
              <button type="button" className={players === 4 ? "is-on" : ""} onClick={() => setPlayers(4)}>
                Doubles
              </button>
              <button type="button" className={players === 2 ? "is-on" : ""} onClick={() => setPlayers(2)}>
                Singles
              </button>
            </div>
            <div className="pkLiveNames">
              {Array.from({ length: players }, (_, i) => (
                <label key={i}>
                  <small>{i < players / 2 ? "Near side (by the phone)" : "Far side"}</small>
                  <input type="text" maxLength={32} value={names[i] || ""} placeholder={`Player ${i + 1}`} onChange={(e) => setNames((n) => Object.assign([...n], { [i]: e.target.value }))} data-field={`live-name-${i}`} />
                </label>
              ))}
            </div>
            <MoreOptions id="pickleball.goLive">
              <label className="pkTwinRow">
                <span>Title</span>
                <input type="text" maxLength={60} value={title} placeholder={`Game at ${venueName}`} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="pkCloneCheck">
                <input id="pk-live-notify" type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                <label htmlFor="pk-live-notify">Tell my buddies I'm live</label>
              </label>
              <p className="pkMuted">Your buddies can watch (and anyone you send the link to). Nothing is recorded on the server; the game is kept on this phone afterwards as a Twin Replay.</p>
            </MoreOptions>
            {error && <p className="pkTwinError">{error}</p>}
            <div className="pkTwinButtons">
              <button type="button" onClick={onExit}>
                Back
              </button>
              <button type="button" className="pkPrimary" onClick={openCamera} data-action="live-camera">
                Point the camera
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "camera" && (
        <div className="pkLiveCal">
          <Calibrate snap={snap} players={players} initial={taps} doneLabel="Go live" onCancel={() => (stopCamera(), setStep("setup"))} onDone={goLive} />
          {error && <p className="pkTwinError">{error}</p>}
        </div>
      )}

      {step === "live" && (
        <div className="pkLiveHud">
          <div className="pkTwinTop pkLiveTop">
            <span className="pkLiveBadge" data-live-badge>
              ● LIVE
            </span>
            <b className="pkTwinTitle">
              {venueName}
              {courtName ? ` · ${courtName}` : ""}
            </b>
            <span className="pkLiveViewers" data-viewers={viewers}>
              👁 {viewers}
            </span>
          </div>
          <div className="pkLiveMid">
            <canvas ref={dotsRef} width="96" height="150" className="pkLiveDots" aria-label="Where everyone is" />
            <div className="pkLiveReacts" aria-live="polite">
              {reactions.map((r) => (
                <span key={r.id} className="pkLiveReact" title={r.name}>
                  {r.e}
                </span>
              ))}
            </div>
          </div>
          <div className="pkPanel window pkLiveBar">
            {status && <p className="pkMuted">{status}</p>}
            {score && (
              <div className="pkLiveScore">
                <button type="button" onClick={() => point(0)} disabled={score.over} data-action="point-near">
                  Point: near
                </button>
                <b data-score>{scoreCall(score)}</b>
                <button type="button" onClick={() => point(1)} disabled={score.over} data-action="point-far">
                  Point: far
                </button>
              </div>
            )}
            <p className="pkMuted pkLiveStats" data-live-stats>
              {stats ? `${stats.fps.toFixed(1)} pictures/s · ${stats.hits} hits · ${stats.mic ? "listening" : "no sound (swings only)"} · ${(stats.bytes / 1024).toFixed(0)} KB sent` : "Starting..."}
            </p>
            <div className="pkTwinButtons">
              <button type="button" onClick={share} data-action="live-share">
                Share the link
              </button>
              <button type="button" className="pkPrimary" onClick={() => finish(true)} data-action="live-end">
                End broadcast
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "ended" && (
        <div className="pkTwinHome">
          <div className="pkPanel window pkTwinHero">
            <b className="pkTwinBig">Broadcast over</b>
            <p>{saved ? `Kept in Twin Replay as "${saved.title}": replays and stats for every rally.` : "Thanks for filming!"}</p>
            {error && <p className="pkTwinError">{error}</p>}
            <div className="pkTwinButtons">
              {saved && onOpenTwin && (
                <button type="button" className="pkPrimary" onClick={() => onOpenTwin(saved.id)}>
                  Open in Twin Replay
                </button>
              )}
              <button type="button" onClick={onExit}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
