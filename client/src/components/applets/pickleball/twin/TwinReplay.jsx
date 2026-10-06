// Twin Replay (inside Pickleball 98): film a real game, or open a video of one, and watch it
// played back by Pickleball 98's athletes at your real venue, with the stats. Everything is
// read on this device: the video and what's in it never leave it.
//
// Screens: home (your games, Film a game, Open a video) -> calibrate (tap the corners) ->
// reading (progress) -> names (who's who) -> the game (TwinPlayer: replay + stats).

import React, { useCallback, useEffect, useRef, useState } from "react"
import MoreOptions from "../../../shared/MoreOptions"
import { filePayload, shareOut } from "../../../../utils/share"
import { Calibrate } from "./Calibrate"
import { Recorder } from "./Recorder"
import { TwinPlayer } from "./TwinPlayer"
import { readGame, grabFrame, READ_FPS } from "./reader.js"
import { deleteGame, getGame, getVideo, listGames, newId, putGame, putVideo } from "./store.js"
import { fromTwin, MAX_TWIN_BYTES, toTwin } from "./core/twinfile.js"
import { HALF_L, HALF_W } from "./core/homography.js"
import "./TwinReplay.css"

const when = (ms) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })
const clock = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.max(1, Math.round(s))} s`)

const gzip = async (text) => {
  if (typeof CompressionStream === "undefined") return new Blob([text], { type: "application/json" })
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))
  return new Blob([await new Response(s).arrayBuffer()], { type: "application/gzip" })
}
const readTwinFile = async (file) => {
  const buf = new Uint8Array(await file.arrayBuffer())
  let text
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    if (typeof DecompressionStream === "undefined") throw new Error("This browser can't open packed replays.")
    const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))
    text = await new Response(s).text()
  } else text = new TextDecoder().decode(buf)
  return fromTwin(JSON.parse(text))
}

export default function TwinReplay({ getEngine, onExit }) {
  const [view, setView] = useState("home")
  const [games, setGames] = useState([])
  const [game, setGame] = useState(null) // the open game (with analysis)
  const [blob, setBlob] = useState(null) // its video, if there is one
  const [progress, setProgress] = useState(null)
  const [status, setStatus] = useState("")
  const [error, setError] = useState(null)
  const [paused, setPaused] = useState(false)
  const [live, setLive] = useState(null) // tracked dots while reading
  const control = useRef({ paused: false, cancelled: false })
  const fileRef = useRef(null)
  const twinRef = useRef(null)

  const refresh = useCallback(() => listGames().then(setGames).catch(() => setGames([])), [])
  useEffect(() => {
    refresh()
  }, [refresh])
  // (the match behind stays on its title while we're not replaying)
  useEffect(() => {
    if (view !== "game") getEngine()?.stopTwin()
  }, [view, getEngine])

  const startNew = async (b, title) => {
    setError(null)
    const id = newId()
    try {
      const f = await grabFrame(b, 1.5, 160)
      const thumb = f.canvas.toDataURL("image/jpeg", 0.6)
      const g = { id, title: title || `Game, ${when(Date.now())}`, created: Date.now(), duration: f.duration, venue: null, court: null, taps: null, players: 4, analysis: null, thumb }
      await putVideo(id, b)
      await putGame(g)
      setGame(g)
      setBlob(b)
      setView("calibrate")
      refresh()
    } catch (e) {
      setError(e.message || "That video couldn't be opened.")
    }
  }

  const openGame = async (id) => {
    const g = await getGame(id)
    if (!g) return
    const v = await getVideo(id).catch(() => null)
    setGame(g)
    setBlob(v || null)
    if (!g.analysis) setView(v ? "calibrate" : "home")
    else setView("game")
  }

  const read = async ({ taps, players }) => {
    const g = { ...game, taps, players }
    setGame(g)
    await putGame(g)
    control.current = { paused: false, cancelled: false }
    setPaused(false)
    setProgress({ done: 0, eta: null })
    setView("reading")
    try {
      const result = await readGame(blob, {
        taps,
        players,
        control: control.current,
        onProgress: setProgress,
        onStatus: setStatus,
        onFrame: ({ tracks }) => setLive(tracks.map((t) => ({ id: t.id, x: t.x, z: t.z, team: t.team }))),
      })
      const next = { ...g, analysis: result }
      setGame(next)
      await putGame(next)
      setView("names")
    } catch (e) {
      if (e.message !== "cancelled") setError(`Reading stopped: ${e.message}`)
      setView("calibrate")
    } finally {
      setLive(null)
      refresh()
    }
  }

  const saveNames = async (players) => {
    const analysis = { ...game.analysis, players: game.analysis.players.map((p) => ({ ...p, ...(players[p.id] || {}) })) }
    const next = { ...game, analysis }
    setGame(next)
    if (!next.demo) await putGame(next)
    setView("game")
  }

  const changeGame = async (patch) => {
    const next = { ...game, ...patch }
    setGame(next)
    if (!next.demo) await putGame(next).catch(() => {})
  }

  const share = async () => {
    const twin = toTwin(game.analysis, { venue: game.venue, court: game.court, title: game.title, when: game.created })
    const data = await gzip(JSON.stringify(twin))
    if (data.size > MAX_TWIN_BYTES) return setError("This game is too long to send in one file.")
    const name = `${game.title.replace(/[^\w ,.-]+/g, "").slice(0, 40) || "Game"}.twin`
    shareOut(filePayload(`${game.title} (Twin Replay)`, { name, data, mime: "application/octet-stream" }, { text: "A Pickleball 98 Twin Replay: open it in Pickleball 98 > Twin Replay > Open a replay file." }), "apps", { title: "Twin Replay" })
  }

  const openTwin = async (file) => {
    setError(null)
    try {
      const { analysis, meta } = await readTwinFile(file)
      const g = { id: newId(), title: meta.title, created: meta.when, duration: analysis.duration, venue: meta.venue, court: meta.court, analysis, shared: true, thumb: null }
      await putGame(g)
      setGame(g)
      setBlob(null)
      setView("game")
      refresh()
    } catch (e) {
      setError(e.message || "That isn't a Twin Replay file.")
    }
  }

  const demo = async () => {
    const { demoGame } = await import("./demo.js")
    setGame(demoGame())
    setBlob(null)
    setView("game")
  }

  return (
    <div className="pkTwin" data-view={view}>
      {view === "home" && (
        <div className="pkTwinHome">
          <div className="pkPanel window pkTwinHero">
            <b className="pkTwinBig">Twin Replay</b>
            <p>Film a real game. Watch it played back in Pickleball 98 at your court, with everyone's stats.</p>
            <div className="pkTwinButtons">
              <button type="button" className="pkPrimary" onClick={() => setView("record")} data-action="twin-record">
                Film a game
              </button>
              <button type="button" onClick={() => fileRef.current?.click()} data-action="twin-open">
                Open a video
              </button>
            </div>
            <input ref={fileRef} type="file" accept="video/*" hidden onChange={(e) => e.target.files?.[0] && startNew(e.target.files[0], e.target.files[0].name.replace(/\.[^.]+$/, "").slice(0, 60))} />
            <input ref={twinRef} type="file" accept=".twin,.json,application/json,application/octet-stream" hidden onChange={(e) => e.target.files?.[0] && openTwin(e.target.files[0])} />
            {error && <p className="pkTwinError">{error}</p>}
            <MoreOptions id="pickleball.twinHome">
              <div className="pkTwinButtons">
                <button type="button" onClick={demo} data-action="twin-demo">
                  Try the demo rally
                </button>
                <button type="button" onClick={() => twinRef.current?.click()}>
                  Open a replay file...
                </button>
              </div>
              <p className="pkMuted">
                Best results: the phone on the back fence behind a baseline, sideways, the whole court in the picture, sound on. Reading runs on this {navigator.maxTouchPoints ? "phone" : "computer"} (about {READ_FPS} pictures for each second of video); your video never leaves it.
              </p>
            </MoreOptions>
          </div>
          {games.length > 0 && (
            <div className="pkPanel window pkTwinGames">
              <b>Your games</b>
              <ul className="pkTwinList">
                {games.map((g) => (
                  <li key={g.id}>
                    <button type="button" className="pkTwinGame" onClick={() => openGame(g.id)}>
                      {g.thumb ? <img src={g.thumb} alt="" /> : <span className="pkTwinThumb">▶</span>}
                      <span>
                        <b>{g.title}</b>
                        <small className="pkMuted">
                          {when(g.created)} · {g.rallies ? `${g.rallies} rallies, ${g.shots} shots` : g.taps ? "not read yet" : "needs the court corners"}
                          {g.shared ? " · from a friend" : ""}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="pkTwinButtons pkTwinExit">
            <button type="button" onClick={onExit}>
              Back to Pickleball 98
            </button>
          </div>
        </div>
      )}

      {view === "record" && <Recorder onCancel={() => setView("home")} onDone={(b) => startNew(b)} />}

      {view === "calibrate" && blob && (
        <div className="pkTwinScroll">
          {error && <p className="pkTwinError">{error}</p>}
          <Calibrate blob={blob} initial={game?.taps || []} players={game?.players || 4} onCancel={() => (setError(null), setView("home"))} onDone={read} />
        </div>
      )}

      {view === "reading" && (
        <div className="pkCenter">
          <div className="pkPanel window pkTwinReading">
            <b>Reading your game</b>
            <p className="pkMuted">{status}</p>
            <div className="pkTwinProgress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress?.done || 0) * 100)}>
              <span style={{ width: `${Math.round((progress?.done || 0) * 100)}%` }} />
            </div>
            <p>
              {Math.round((progress?.done || 0) * 100)}%{progress?.eta ? ` · about ${clock(progress.eta)} left` : ""}
              {progress?.framesPerSecond ? <small className="pkMuted"> · {progress.framesPerSecond.toFixed(1)} pictures/s</small> : null}
            </p>
            {live && <LiveCourt dots={live} />}
            <div className="pkTwinButtons">
              <button type="button" onClick={() => ((control.current.paused = !control.current.paused), setPaused(control.current.paused))}>
                {paused ? "Resume" : "Pause"}
              </button>
              <button type="button" onClick={() => (control.current.cancelled = true)}>
                Stop
              </button>
            </div>
          </div>
        </div>
      )}

      {view === "names" && game?.analysis && <Names analysis={game.analysis} onDone={saveNames} />}

      {view === "game" && game?.analysis && (
        <TwinPlayer
          getEngine={getEngine}
          game={game}
          video={blob}
          onBack={() => (refresh(), setView("home"))}
          onChange={changeGame}
          onShare={share}
          onDelete={game.demo ? null : async () => (await deleteGame(game.id), refresh(), setView("home"))}
        />
      )}
    </div>
  )
}

// the players as they're found, on a little court seen from above
const LiveCourt = ({ dots }) => (
  <svg className="pkTwinLive" viewBox={`${-HALF_W - 2} ${-HALF_L - 2} ${2 * HALF_W + 4} ${2 * HALF_L + 4}`} aria-label="Players found so far">
    <rect x={-HALF_W} y={-HALF_L} width={2 * HALF_W} height={2 * HALF_L} fill="#2f62ad" stroke="#fff" strokeWidth="0.08" />
    <line x1={-HALF_W - 0.3} y1="0" x2={HALF_W + 0.3} y2="0" stroke="#ddd" strokeWidth="0.12" />
    {dots.map((d) => (
      <circle key={d.id} cx={d.x} cy={d.z} r="0.4" fill={d.team === 0 ? "#ffd400" : "#ff6b3d"} stroke="#000" strokeWidth="0.06" />
    ))}
  </svg>
)

// who's who: each tracked player gets a name (and a hand)
const Names = ({ analysis, onDone }) => {
  const [names, setNames] = useState(() => Object.fromEntries(analysis.players.map((p) => [p.id, { name: p.name, hand: p.hand }])))
  return (
    <div className="pkCenter">
      <div className="pkPanel window pkTwinNames">
        <b>Who's who?</b>
        <p className="pkMuted">
          Found {analysis.players.length} players, {analysis.rallies.length} rallies and {analysis.stats.shots} shots. Name them by their shirt color and side.
        </p>
        {analysis.players.map((p) => (
          <div key={p.id} className="pkTwinNameRow">
            <span className="pkTwinChip" style={{ background: p.color || "#888" }} />
            <small className="pkMuted">{p.team === 0 ? "Near side" : "Far side"}</small>
            <input data-selectable value={names[p.id].name} maxLength={32} onChange={(e) => setNames((n) => ({ ...n, [p.id]: { ...n[p.id], name: e.target.value } }))} aria-label={`Name for the ${p.team === 0 ? "near" : "far"} side player`} />
            <button type="button" onClick={() => setNames((n) => ({ ...n, [p.id]: { ...n[p.id], hand: n[p.id].hand === -1 ? 1 : -1 } }))} aria-label="Right or left handed">
              {names[p.id].hand === -1 ? "Lefty" : "Righty"}
            </button>
          </div>
        ))}
        <div className="pkTwinButtons">
          <button type="button" className="pkPrimary" onClick={() => onDone(names)}>
            Watch it
          </button>
        </div>
      </div>
    </div>
  )
}
