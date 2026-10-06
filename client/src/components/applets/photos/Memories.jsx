import React, { useMemo, useState } from "react"
import Dialog from "../../shared/Dialog"
import MoreOptions from "../../shared/MoreOptions"
import { previewOf } from "../../../utils/fs"
import { useFsVersion } from "../../../hooks/useFs"
import { addToAlbum, albumPrefs, setAlbumPrefs, useAlbums } from "../../../utils/albums"
import { memoriesOf, rangeTitle, yearsAgoText } from "./memoriesCore"
import { drivePhotos } from "./library"
import { AlbumPicker } from "./Albums"
import Slideshow, { MOTIONS } from "./Slideshow"
import { TUNES } from "./music"

// Memories in Photos: "On this day" (pictures from today's date in earlier years) and trips
// and days out (pictures close together in time), from every picture on drive C:. Each one
// plays as a slideshow (a title card, Ken Burns motion and music by default) or becomes a
// shared album. A small card on Photos' thumbnails leads here. Settings (the daily notice,
// the slideshow's music and motion) are under More options.

const useMemories = () => {
  const version = useFsVersion()
  const day = new Date().toDateString()
  return useMemo(() => memoriesOf(drivePhotos()), [version, day])
}

const memoryList = (m) => [
  ...m.onThisDay.map((g) => ({ id: `otd-${g.year}`, title: `On this day, ${yearsAgoText(g.yearsAgo)}`, subtitle: rangeTitle(g.items[0].time, g.items[g.items.length - 1].time), items: g.items, kind: "otd" })),
  ...m.trips.map((t) => ({ id: t.id, title: t.title, subtitle: t.kind === "trip" ? `${t.days} days · ${t.items.length} photos` : `${t.items.length} photos`, items: t.items, kind: t.kind })),
]

// the card on the thumbnails (only when there's something to show)
export const MemoriesCard = ({ onOpen }) => {
  const m = useMemories()
  const first = m.onThisDay[0] || null
  const trip = m.trips[0] || null
  if (!first && !trip) return null
  const items = (first || trip).items
  const thumbs = items.slice(0, 3).map((p) => previewOf(p.file)).filter(Boolean)
  return (
    <button type="button" className="meCard" onClick={onOpen} title="Memories">
      <span className="meCardThumbs">
        {thumbs.map((src, i) => (
          <img key={i} src={src} alt="" draggable={false} />
        ))}
      </span>
      <span className="meCardText">
        <b>Memories</b>
        <span>{first ? `On this day, ${yearsAgoText(first.yearsAgo)} · ${first.items.length} photo${first.items.length === 1 ? "" : "s"}` : `${trip.title} · ${trip.items.length} photos`}</span>
      </span>
    </button>
  )
}

const Memories = ({ onBack, showPrefs, onShowPrefs, onOpenAlbum }) => {
  const m = useMemories()
  const albums = useAlbums()
  const list = memoryList(m)
  const [playing, setPlaying] = useState(null)
  const [sharing, setSharing] = useState(null)
  const [dialog, setDialog] = useState(null)
  const prefs = albumPrefs()
  const onThisDay = list.filter((x) => x.kind === "otd")
  const trips = list.filter((x) => x.kind !== "otd")

  const share = async (memory, albumId) => {
    setSharing(null)
    setDialog({ kind: "busy", text: `Getting ${memory.items.length} photos ready...` })
    const r = await addToAlbum(
      albumId,
      memory.items.map((p) => ({ file: p.file }))
    )
    setDialog(r.problems?.length ? { kind: "alert", text: r.problems.join(" "), album: albumId } : null)
    if (!r.problems?.length) onOpenAlbum(albumId)
  }

  const card = (memory) => {
    const thumbs = memory.items.slice(0, 3).map((p) => previewOf(p.file))
    return (
      <div key={memory.id} className="meMemory">
        <button type="button" className="meCollage" onClick={() => setPlaying(memory)} aria-label={`Play ${memory.title}`}>
          {thumbs.map((src, i) => (src ? <img key={i} src={src} alt="" draggable={false} loading="lazy" /> : <span key={i} />))}
        </button>
        <div className="meMemoryTitle">{memory.title}</div>
        <div className="meMemoryInfo">{memory.subtitle}</div>
        <div className="meMemoryButtons">
          <button type="button" onClick={() => setPlaying(memory)}>
            ▶ Play
          </button>
          <button type="button" onClick={() => (albums.status === "off" ? setDialog({ kind: "alert", text: "Sign on to 98 Messenger to share memories as an album with your buddies." }) : setSharing(memory))}>
            Share as Album...
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="meRoot">
      <div className="phTools" role="toolbar" aria-label="Memories">
        <button type="button" className="phTool" onClick={onBack} title="Back to your pictures">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="phIcon">
            <path d="M10 3L4 8l6 5M4 8h9" fill="none" stroke="#000" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="phToolLabel">Pictures</span>
        </button>
      </div>
      <div className="meBody">
        {!list.length && (
          <div className="phEmpty">
            <p>No memories yet.</p>
            <p>Memories gather pictures from today's date in other years, and trips and days out with lots of photos. Take some with Camera, or upload yours: their dates come along.</p>
          </div>
        )}
        {onThisDay.length > 0 && (
          <>
            <div className="meSection">On this day</div>
            <div className="meGrid">{onThisDay.map(card)}</div>
          </>
        )}
        {trips.length > 0 && (
          <>
            <div className="meSection">Trips and days out</div>
            <div className="meGrid">{trips.map(card)}</div>
          </>
        )}
        <MoreOptions id="photos.memories" summary={`${prefs.memoriesNotify ? "Daily notice on" : "Daily notice off"} · ${TUNES.find((t) => t.id === (showPrefs.music || "none"))?.label || "No music"}`}>
          <div className="meSettings">
            <div className="field-row">
              <input id="me-notify" type="checkbox" checked={!!prefs.memoriesNotify} onChange={(e) => setAlbumPrefs({ memoriesNotify: e.target.checked })} />
              <label htmlFor="me-notify">Tell me about "On this day" memories each morning</label>
            </div>
            <label>
              Slideshow music:
              <select value={showPrefs.music || "none"} onChange={(e) => onShowPrefs({ music: e.target.value })}>
                {TUNES.filter((t) => t.id !== "file").map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Motion:
              <select value={showPrefs.motion || "kenburns"} onChange={(e) => onShowPrefs({ motion: e.target.value })}>
                {MOTIONS.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </MoreOptions>
      </div>
      <div className="status-bar phStatus">
        <p className="status-bar-field">
          {list.length} memor{list.length === 1 ? "y" : "ies"}
        </p>
      </div>
      {playing && (
        <Slideshow
          items={playing.items.map((p) => p.file)}
          start={0}
          prefs={{ ...showPrefs, music: showPrefs.music || "sunny" }}
          onPrefs={onShowPrefs}
          title={playing.title}
          subtitle={playing.subtitle}
          onExit={() => setPlaying(null)}
        />
      )}
      {sharing && <AlbumPicker title="Share as Album" count={sharing.items.length} defaultName={sharing.title.slice(0, 60)} onPick={(id) => share(sharing, id)} onCancel={() => setSharing(null)} />}
      {dialog?.kind === "busy" && (
        <Dialog title="Memories">
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
      {dialog?.kind === "alert" && (
        <Dialog title="Memories" onOk={() => (setDialog(null), dialog.album && onOpenAlbum(dialog.album))}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
    </div>
  )
}

export default Memories
