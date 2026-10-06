import React, { useEffect, useMemo, useRef, useState } from "react"
import { pickMoments } from "./moments.js"
import { buildTimeline } from "./timeline.js"
import { shareOut } from "../../../../../utils/share"
import { useAlbums, addToAlbum, refreshAlbums, albumsSignedOn } from "../../../../../utils/albums"
import Combo from "../../../../shared/select/Combo"
import "./Reels.css"

// Instant Replay Reels (Twin Replay > a game > Make Highlights): picks the best rallies, cuts
// a broadcast-style film (your video, a 3D replay of the best point, Hawk-Eye for close calls,
// a generated soundtrack) and saves or shares it. Everything is made on this device.
//   prepare(moment): loads that rally into the engine; getEngine(): the Pickleball engine
const ALBUM_MAX_S = 60
const ALBUM_MAX_BYTES = 12 * 1024 * 1024

export const Reels = ({ analysis, game, video, getEngine, prepare, onBack }) => {
  const picked = useMemo(() => pickMoments(analysis, { max: 5 }), [analysis])
  const [list, setList] = useState(picked)
  const [state, setState] = useState({ phase: "plan" }) // plan | making | done | error
  const [album, setAlbum] = useState("")
  const [note, setNote] = useState(null)
  const abort = useRef(null)
  const albums = useAlbums()
  const plan = useMemo(() => buildTimeline(list, { hasVideo: !!video, maxSec: ALBUM_MAX_S }), [list, video])
  const resultUrl = useMemo(() => (state.result ? URL.createObjectURL(state.result.blob) : null), [state.result])
  useEffect(() => () => resultUrl && URL.revokeObjectURL(resultUrl), [resultUrl])
  useEffect(() => {
    if (albumsSignedOn()) refreshAlbums().catch(() => {})
  }, [])
  useEffect(() => () => abort.current?.abort(), [])

  const move = (i, d) => setList((l) => {
    const j = i + d
    if (j < 0 || j >= l.length) return l
    const n = [...l]
    ;[n[i], n[j]] = [n[j], n[i]]
    return n
  })
  const drop = (i) => setList((l) => l.filter((_, k) => k !== i))

  const make = async () => {
    const ctrl = new AbortController()
    abort.current = ctrl
    setNote(null)
    setState({ phase: "making", pct: 0, what: "Starting" })
    try {
      const { renderReel } = await import("./render.js")
      const result = await renderReel({ timeline: plan, analysis, game, video, engine: getEngine(), prepare, signal: ctrl.signal, onProgress: (p) => setState((s) => (s.phase === "making" ? { ...s, pct: p.pct, what: p.what } : s)) })
      setState({ phase: "done", result })
    } catch (error) {
      if (error?.name === "Cancelled" || error?.message === "Cancelled") setState({ phase: "plan" })
      else setState({ phase: "error", error: error?.message || "The film couldn't be made." })
    } finally {
      abort.current = null
    }
  }

  const fileName = () => `${(game.title || "Highlights").replace(/[\\/:*?"<>|]/g, "").slice(0, 40)} highlights.${state.result.ext}`
  const save = () => shareOut({ files: [{ name: fileName(), data: state.result.blob, mime: state.result.mime }], title: `${game.title || "Pickleball"} highlights` }, "phone", { title: "Save Highlights" })
  const share = () => shareOut({ files: [{ name: fileName(), data: state.result.blob, mime: state.result.mime }], title: `${game.title || "Pickleball"} highlights`, text: "Highlights from Pickleball 98" }, "apps", { title: "Share Highlights" })
  const toAlbum = async () => {
    const r = state.result
    if (r.duration > ALBUM_MAX_S || r.blob.size > ALBUM_MAX_BYTES) return setNote(`Shared albums take videos up to ${ALBUM_MAX_S} s and 12 MB; this one is ${Math.round(r.duration)} s, ${(r.blob.size / 1048576).toFixed(1)} MB. Save it to your device instead.`)
    const file = new File([r.blob], fileName(), { type: r.mime })
    const res = await addToAlbum(album, [file], { caption: `${game.title || "Pickleball"} highlights` })
    setNote(res?.ok === false ? res.error : "Added to the album. It uploads in the background.")
  }

  return (
    <div className="pkReels window" data-reels={state.phase}>
      <div className="pkReelsHead">
        <button type="button" onClick={onBack}>‹ Stats</button>
        <b>Make Highlights</b>
      </div>
      {state.phase === "plan" && (
        <div className="pkReelsBody">
          {!list.length ? (
            <p>No rallies with at least two shots were found, so there's nothing to cut yet.</p>
          ) : (
            <>
              <p className="pkMuted">
                {list.length} moment{list.length === 1 ? "" : "s"}, about {Math.round(plan.duration)} s. {video ? "Your video, a 3D replay of the best point" : "3D replays (no video was kept with this game)"}{list.some((m) => m.call) ? ", Hawk-Eye for close calls" : ""} and a soundtrack.
              </p>
              <ol className="pkReelsList" data-moments={list.length}>
                {list.map((m, i) => (
                  <li key={m.ri}>
                    <span className="pkReelsWhat">
                      <b>{m.best ? "★ " : ""}Rally {m.ri + 1}</b> {m.tags.map((t) => t.text).join(" · ") || m.label}
                    </span>
                    <span className="pkReelsBtns">
                      <button type="button" aria-label="Earlier" onClick={() => move(i, -1)} disabled={i === 0}>▲</button>
                      <button type="button" aria-label="Later" onClick={() => move(i, 1)} disabled={i === list.length - 1}>▼</button>
                      <button type="button" aria-label="Remove" onClick={() => drop(i)} disabled={list.length === 1}>✕</button>
                    </span>
                  </li>
                ))}
              </ol>
              <button type="button" className="pkPrimary pkReelsGo" onClick={make} data-action="make-reel">
                Make the film
              </button>
            </>
          )}
        </div>
      )}
      {state.phase === "making" && (
        <div className="pkReelsBody">
          <p>{state.what}...</p>
          <div className="pkReelsBar" aria-label={`${state.pct}%`}>
            <div style={{ width: `${Math.max(3, state.pct)}%` }} />
          </div>
          <p className="pkMuted">Keep Pickleball 98 open: the 3D parts are filmed as they play.</p>
          <button type="button" onClick={() => abort.current?.abort()}>Cancel</button>
        </div>
      )}
      {state.phase === "done" && (
        <div className="pkReelsBody">
          <video className="pkReelsPreview" src={resultUrl} controls playsInline data-reel-video />
          <p className="pkMuted">
            {Math.round(state.result.duration)} s · {(state.result.blob.size / 1048576).toFixed(1)} MB · {state.result.ext.toUpperCase()} · made in {(state.result.ms / 1000).toFixed(0)} s
          </p>
          <div className="pkReelsActions">
            <button type="button" className="pkPrimary" onClick={save} data-action="save-reel">Save to Device</button>
            <button type="button" onClick={share}>Share...</button>
          </div>
          {albums?.albums?.length > 0 && (
            <div className="pkReelsActions">
              <Combo value={album} options={[["", "Choose an album..."], ...albums.albums.map((a) => [a.id, a.name])]} onChange={setAlbum} ariaLabel="Shared album" name="reel-album" />
              <button type="button" onClick={toAlbum} disabled={!album}>Add to Album</button>
            </div>
          )}
          {note && <p className="pkReelsNote">{note}</p>}
          <button type="button" onClick={() => setState({ phase: "plan" })}>Make another</button>
        </div>
      )}
      {state.phase === "error" && (
        <div className="pkReelsBody">
          <p className="pkTwinError">{state.error}</p>
          <button type="button" onClick={() => setState({ phase: "plan" })}>Back</button>
        </div>
      )}
    </div>
  )
}

export default Reels
