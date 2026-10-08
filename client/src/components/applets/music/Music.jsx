import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import ContextMenu from "../../shared/ContextMenu"
import Dialog from "../../shared/Dialog"
import MoreOptions from "../../shared/MoreOptions"
import { useFsVersion } from "../../../hooks/useFs"
import * as engine from "./engine"
import * as lib from "./musicStore"
import { albumOf, artistOf, clock, filterTracks, groupAlbums, groupArtists, longTime, sortSongs, titleOf, totalTime } from "./library"
import "./Music.css"

// Music 98: your own songs (MP3, M4A, WAV, FLAC, OGG) in a Windows Media Player 7-style
// player. The baseline view is Now Playing (art, title, the transport) and the library
// (Songs / Albums / Artists / Playlists / Queue) with Add Songs...; equalizer and visualizer
// are under More options. Each song's "..." button has Play Next, Add to Queue, Add to
// Playlist and Edit Info (right-click works too on a computer).

const VIEWS = [
  ["songs", "Songs"],
  ["albums", "Albums"],
  ["artists", "Artists"],
  ["playlists", "Playlists"],
  ["queue", "Queue"],
]

const usePlayer = () => useSyncExternalStore(engine.subscribePlayer, engine.playerSnapshot, engine.playerSnapshot)
const useLibraryVersion = () => useSyncExternalStore(lib.subscribeMusic, lib.musicVersion, lib.musicVersion)

const Disc = ({ size = 64 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="muDisc">
    <circle cx="32" cy="32" r="30" fill="#c8d4e8" stroke="#40507a" strokeWidth="2" />
    <circle cx="32" cy="32" r="22" fill="none" stroke="#e8eef8" strokeWidth="1" />
    <circle cx="32" cy="32" r="14" fill="none" stroke="#a8b8d4" strokeWidth="1" />
    <circle cx="32" cy="32" r="8" fill="#40507a" />
    <circle cx="32" cy="32" r="3" fill="#fff" />
    <path d="M14 18 A22 22 0 0 1 30 10" stroke="#fff" strokeWidth="3" fill="none" opacity="0.7" />
  </svg>
)

// album art (a key into the art store) or the disc
const Art = ({ artKey, size = 64, className = "" }) => {
  const [url, setUrl] = useState(() => lib.peekArt(artKey))
  useEffect(() => {
    let alive = true
    setUrl(lib.peekArt(artKey))
    if (artKey) lib.getArt(artKey).then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [artKey])
  return url ? <img className={`muArt ${className}`} src={url} alt="" width={size} height={size} /> : <span className={`muArt muArt--none ${className}`} style={{ width: size, height: size }}><Disc size={Math.round(size * 0.8)} /></span>
}

const Visualizer = ({ playing }) => {
  const canvas = useRef(null)
  useEffect(() => {
    engine.startVisualizer()
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const c = canvas.current
      if (!c || document.hidden) return
      const g = c.getContext("2d")
      const bars = engine.levels(24) || []
      g.clearRect(0, 0, c.width, c.height)
      const w = c.width / 24
      bars.forEach((v, i) => {
        const h = Math.max(1, (playing ? v : 0) * c.height)
        for (let y = c.height - 3; y > c.height - h; y -= 3) {
          const t = 1 - y / c.height
          g.fillStyle = t > 0.8 ? "#ff5050" : t > 0.55 ? "#ffd040" : "#40e070"
          g.fillRect(i * w + 1, y, w - 2, 2)
        }
      })
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [playing])
  return <canvas ref={canvas} className="muViz" width="240" height="48" aria-hidden="true" />
}

// one song row
const Row = ({ track, index, now, onPlay, onMenu, showAlbum = true, number }) => (
  <li
    className={`muRow${now ? " is-now" : ""}${track.pending ? " is-pending" : ""}`}
    onContextMenu={(e) => {
      e.preventDefault()
      onMenu(track, e.clientX, e.clientY, index)
    }}
  >
    <button type="button" className="muRowMain" onClick={() => onPlay(track, index)}>
      {number != null && <span className="muNum">{number || ""}</span>}
      <span className="muRowText">
        <span className="muTitle">
          {now ? "▶ " : ""}
          {titleOf(track)}
        </span>
        <span className="muSub">
          {artistOf(track)}
          {showAlbum && track.album ? ` · ${albumOf(track)}` : ""}
        </span>
      </span>
      <span className="muDur">{track.duration ? clock(track.duration) : ""}</span>
    </button>
    <button
      type="button"
      className="muMore"
      aria-label={`More for ${titleOf(track)}`}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        onMenu(track, r.left, r.bottom, index)
      }}
    >
      …
    </button>
  </li>
)

const Music = ({ mobile, handoff, onClose }) => {
  useFsVersion()
  useLibraryVersion()
  const player = usePlayer()
  const prefs = lib.getPrefs()
  const [view, setView] = useState(prefs.view || "songs")
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(null) // { kind: "album" | "artist" | "playlist", key }
  const [menu, setMenu] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [busy, setBusy] = useState(null)
  const fileInput = useRef(null)

  const tracks = lib.listTracks()
  const byKey = useMemo(() => new Map(tracks.map((t) => [t.key, t])), [tracks.map((t) => t.key + (t.pending ? "?" : "")).join()])
  const shown = filterTracks(tracks, query)
  const albums = useMemo(() => groupAlbums(shown), [shown.length, byKey])
  const artists = useMemo(() => groupArtists(shown), [shown.length, byKey])
  const playlists = lib.playlists()

  // details for songs that came from somewhere else (sync, a copy)
  useEffect(() => {
    if (tracks.some((t) => t.pending)) lib.readPending(tracks)
  }, [tracks.length])
  useEffect(() => lib.tidy(), [])
  // closing the window stops the music
  useEffect(() => () => engine.shutDown(), [])
  useEffect(() => {
    if (prefs.eq?.on) engine.applyEq(prefs.eq)
  }, [])

  // opened by double-clicking a song in My Computer
  useEffect(() => {
    if (!handoff?.play) return
    const t = tracks.find((x) => x.path === handoff.play)
    if (!t) return
    const folder = t.path.split("/").slice(0, -1).join("/")
    const inFolder = tracks.filter((x) => x.path.split("/").slice(0, -1).join("/") === folder)
    engine.playList(sortSongs(inFolder).map((x) => x.key), t.key)
  }, [handoff?.id])

  const pick = (v) => {
    setView(v)
    setOpen(null)
    lib.setPrefs({ view: v })
  }

  const addSongs = async (files) => {
    if (!files?.length) return
    setBusy({ text: "Adding songs..." })
    const result = await lib.importSongs(files, (i, n, name) => setBusy({ text: name ? `Adding ${name} (${i + 1} of ${n})...` : "Finishing..." }))
    setBusy(null)
    // problems, and songs over 8 MB being kept on this device only (not synced)
    const notes = result.notes || []
    const note = notes.length > 1 ? `${notes.length} of them are over 8 MB, so they're kept on this device only (not synced or backed up).` : notes[0] || ""
    if (result.problems.length || note)
      setDialog({ kind: "alert", title: "Add Songs", text: `${result.added.length ? `Added ${result.added.length} song${result.added.length === 1 ? "" : "s"}. ` : ""}${[...result.problems, note].filter(Boolean).join(" ")}` })
  }

  const playFrom = (list, track) => engine.playList(list.map((t) => t.key), track?.key ?? null)
  const shuffleAll = (list) => {
    engine.setShuffle(true)
    engine.playList(list.map((t) => t.key))
  }

  const openMenu = (track, x, y, index) => {
    const inPlaylist = open?.kind === "playlist" ? open.key : null
    setMenu({
      x,
      y,
      items: [
        { label: "Play", bold: true, onClick: () => engine.playList([track.key], track.key) },
        { label: "Play Next", onClick: () => engine.playNext(track.key), disabled: !player.key },
        { label: "Add to Queue", onClick: () => (player.key ? engine.addToQueue(track.key) : engine.playList([track.key])) },
        {
          label: "Add to Playlist",
          items: [
            { label: "New Playlist...", onClick: () => setDialog({ kind: "newPlaylist", name: "", keys: [track.key] }) },
            ...(playlists.length ? ["-"] : []),
            ...playlists.map((p) => ({ label: p.name, onClick: () => lib.addToPlaylist(p.id, [track.key]) })),
          ],
        },
        ...(inPlaylist ? [{ label: "Remove from Playlist", onClick: () => lib.removeFromPlaylist(inPlaylist, track.key) }] : []),
        "-",
        { label: "Edit Info...", disabled: track.pending, onClick: () => setDialog({ kind: "edit", key: track.key, title: track.title || titleOf(track), artist: track.artist || "", album: track.album || "", track: track.track || "" }) },
      ],
    })
  }

  // ---- the list area ----

  const songList = (list, { numbered = false, showAlbum = true } = {}) => (
    <ul className="muList">
      {list.map((t, i) => (
        <Row key={`${t.key}-${i}`} track={t} index={i} now={player.key === t.key} onPlay={(tr) => playFrom(list, tr)} onMenu={openMenu} showAlbum={showAlbum} number={numbered ? t.track : null} />
      ))}
    </ul>
  )

  const listHead = (title, sub, list, extra = null) => (
    <div className="muHead">
      <button type="button" className="muBack" onClick={() => setOpen(null)}>
        ‹ Back
      </button>
      <div className="muHeadText">
        <b>{title}</b>
        <small>{sub}</small>
      </div>
      <button type="button" onClick={() => playFrom(list, list[0])} disabled={!list.length}>
        ▶ Play
      </button>
      <button type="button" onClick={() => shuffleAll(list)} disabled={!list.length}>
        Shuffle
      </button>
      {extra}
    </div>
  )

  const body = () => {
    if (!tracks.length) {
      return (
        <div className="muEmpty">
          <Disc size={72} />
          <p>
            <b>Your music library is empty.</b>
          </p>
          <p>Add songs from your phone or computer: MP3, M4A, WAV, FLAC or OGG. They're kept in C:\My Music on this device.</p>
          <button type="button" className="muPrimary" onClick={() => fileInput.current?.click()}>
            Add Songs...
          </button>
        </div>
      )
    }
    if (open?.kind === "album") {
      const a = albums.find((x) => x.key === open.key)
      if (a)
        return (
          <>
            <div className="muAlbumTop">
              <Art artKey={a.art} size={mobile ? 96 : 80} />
              {listHead(a.album, `${a.artist}${a.year ? ` · ${a.year}` : ""} · ${a.tracks.length} songs · ${longTime(totalTime(a.tracks))}`, a.tracks)}
            </div>
            {songList(a.tracks, { numbered: true, showAlbum: false })}
          </>
        )
    }
    if (open?.kind === "artist") {
      const a = artists.find((x) => x.key === open.key)
      if (a)
        return (
          <>
            {listHead(a.name, `${a.albums} album${a.albums === 1 ? "" : "s"} · ${a.tracks.length} songs`, a.tracks)}
            {songList(a.tracks)}
          </>
        )
    }
    if (open?.kind === "playlist") {
      const p = playlists.find((x) => x.id === open.key)
      if (p) {
        const list = p.keys.map((k) => byKey.get(k)).filter(Boolean)
        return (
          <>
            {listHead(
              p.name,
              `${list.length} songs · ${longTime(totalTime(list))}`,
              list,
              <>
                <button type="button" onClick={() => setDialog({ kind: "rename", id: p.id, name: p.name })}>
                  Rename
                </button>
                <button type="button" onClick={() => setDialog({ kind: "deletePlaylist", id: p.id, name: p.name })}>
                  Delete
                </button>
              </>
            )}
            {list.length ? songList(list) : <p className="muHint">Add songs with their "…" button &gt; Add to Playlist.</p>}
          </>
        )
      }
    }
    if (view === "albums")
      return (
        <ul className="muGrid">
          {albums.map((a) => (
            <li key={a.key}>
              <button type="button" onClick={() => setOpen({ kind: "album", key: a.key })}>
                <Art artKey={a.art} size={mobile ? 104 : 88} />
                <span className="muTitle">{a.album}</span>
                <span className="muSub">{a.artist}</span>
              </button>
            </li>
          ))}
        </ul>
      )
    if (view === "artists")
      return (
        <ul className="muList">
          {artists.map((a) => (
            <li key={a.key} className="muRow">
              <button type="button" className="muRowMain" onClick={() => setOpen({ kind: "artist", key: a.key })}>
                <span className="muRowText">
                  <span className="muTitle">{a.name}</span>
                  <span className="muSub">
                    {a.albums} album{a.albums === 1 ? "" : "s"} · {a.tracks.length} song{a.tracks.length === 1 ? "" : "s"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )
    if (view === "playlists")
      return (
        <>
          <div className="muHead">
            <button type="button" onClick={() => setDialog({ kind: "newPlaylist", name: "", keys: [] })}>
              New Playlist...
            </button>
          </div>
          {!playlists.length && <p className="muHint">No playlists yet.</p>}
          <ul className="muList">
            {playlists.map((p) => (
              <li key={p.id} className="muRow">
                <button type="button" className="muRowMain" onClick={() => setOpen({ kind: "playlist", key: p.id })}>
                  <span className="muRowText">
                    <span className="muTitle">{p.name}</span>
                    <span className="muSub">{p.keys.filter((k) => byKey.has(k)).length} songs{p.keys.some((k) => !byKey.has(k)) ? " (+ videos in Media Player)" : ""}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )
    if (view === "queue") {
      const q = player.queue
      if (!q.order.length) return <p className="muHint">Nothing in the queue. Play a song, album or playlist.</p>
      return (
        <ul className="muList">
          {q.order.map((k, i) => {
            const t = byKey.get(k)
            if (!t) return null
            return (
              <li key={`${k}-${i}`} className={`muRow${i === q.pos ? " is-now" : ""}${i < q.pos ? " is-past" : ""}`}>
                <button type="button" className="muRowMain" onClick={() => engine.jumpTo(i)}>
                  <span className="muRowText">
                    <span className="muTitle">
                      {i === q.pos ? "▶ " : ""}
                      {titleOf(t)}
                    </span>
                    <span className="muSub">{artistOf(t)}</span>
                  </span>
                  <span className="muDur">{t.duration ? clock(t.duration) : ""}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )
    }
    return songList(sortSongs(shown))
  }

  const t = player.track
  const repeat = prefs.repeat
  const duration = player.duration || t?.duration || 0
  const eq = prefs.eq || {}

  return (
    <div className={`mu${mobile ? " mu--phone" : ""}`}>
      <input
        ref={fileInput}
        type="file"
        accept={lib.SONG_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          addSongs([...e.target.files])
          e.target.value = ""
        }}
      />

      {/* Now Playing: the WMP 7-style panel */}
      <div className="muNow">
        <Art artKey={t?.art} size={mobile ? 72 : 64} className="muNowArt" />
        <div className="muNowText">
          <div className="muNowTitle">{t ? titleOf(t) : "Music 98"}</div>
          <div className="muNowSub">{t ? `${artistOf(t)}${t.album ? ` · ${albumOf(t)}` : ""}` : tracks.length ? `${tracks.length} song${tracks.length === 1 ? "" : "s"} in your library` : "Add songs to start"}</div>
          {player.error && <div className="muErr">{player.error}</div>}
          {prefs.viz && <Visualizer playing={player.playing} />}
        </div>
      </div>
      <div className="muSeekRow">
        <span className="muTime">{clock(player.time)}</span>
        <input type="range" className="muSeek" aria-label="Position" min="0" max={Math.max(1, Math.floor(duration))} step="1" value={Math.min(Math.floor(player.time), Math.max(1, Math.floor(duration)))} disabled={!t} onChange={(e) => engine.seek(Number(e.target.value))} />
        <span className="muTime">{clock(duration)}</span>
      </div>
      <div className="muTransport">
        <button type="button" className={`muToggle${prefs.shuffle ? " is-on" : ""}`} aria-pressed={!!prefs.shuffle} aria-label="Shuffle" title="Shuffle" onClick={() => engine.setShuffle(!prefs.shuffle)}>
          ⤮
        </button>
        <button type="button" aria-label="Previous" onClick={engine.prev} disabled={!player.queue.order.length}>
          ⏮
        </button>
        <button type="button" className="muPlay" aria-label={player.playing ? "Pause" : "Play"} onClick={() => (player.key || player.queue.order.length ? engine.toggle() : tracks.length && playFrom(sortSongs(shown), null))} disabled={!tracks.length}>
          {player.playing ? "❚❚" : "▶"}
        </button>
        <button type="button" aria-label="Next" onClick={engine.next} disabled={!player.queue.order.length}>
          ⏭
        </button>
        <button type="button" className={`muToggle${repeat !== "off" ? " is-on" : ""}`} aria-label={`Repeat: ${repeat}`} title={`Repeat: ${repeat === "one" ? "this song" : repeat === "all" ? "all" : "off"}`} onClick={() => engine.cycleRepeat()}>
          {repeat === "one" ? "🔂" : "🔁"}
        </button>
      </div>

      <div className="muBar">
        <div className="muTabs" role="tablist">
          {VIEWS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id && !open} className={view === id ? "is-on" : ""} onClick={() => pick(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="muTools">
          <input type="search" placeholder="Search" aria-label="Search your music" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button type="button" className="muPrimary" onClick={() => fileInput.current?.click()} disabled={!!busy}>
            Add Songs...
          </button>
        </div>
      </div>
      {busy && <div className="muBusy">{busy.text}</div>}

      <div className="muBody" data-selectable="mouse">
        {body()}
      </div>

      <MoreOptions id="music.more" summary={[eq.on ? "Equalizer on" : "Equalizer off", prefs.viz ? "Visualizer on" : null].filter(Boolean).join(" · ")}>
        <label className="muCheck">
          <input
            type="checkbox"
            checked={!!eq.on}
            onChange={(e) => {
              lib.setPrefs({ eq: { on: e.target.checked } })
              engine.applyEq({ ...eq, on: e.target.checked })
            }}
          />{" "}
          Equalizer
        </label>
        <div className="muEq" aria-disabled={!eq.on}>
          {[
            ["low", "Bass"],
            ["mid", "Mid"],
            ["high", "Treble"],
          ].map(([band, label]) => (
            <label key={band}>
              <span>{label}</span>
              <input
                type="range"
                min="-12"
                max="12"
                step="1"
                value={eq[band] || 0}
                disabled={!eq.on}
                onChange={(e) => {
                  const next = { ...eq, [band]: Number(e.target.value) }
                  lib.setPrefs({ eq: { [band]: Number(e.target.value) } })
                  engine.applyEq(next)
                }}
              />
              <small>{(eq[band] || 0) > 0 ? `+${eq[band]}` : eq[band] || 0} dB</small>
            </label>
          ))}
        </div>
        <label className="muCheck">
          <input type="checkbox" checked={!!prefs.viz} onChange={(e) => lib.setPrefs({ viz: e.target.checked })} /> Visualizer
        </label>
        {mobile && <p className="muHint">On iPhone the equalizer and visualizer can stop the music when the screen locks. Leave them off for listening with the phone in your pocket.</p>}
        <p className="muHint">Songs are kept on this device in C:\My Music. File sync copies them only if you add My Music to sync in Backup.</p>
      </MoreOptions>

      {menu && <ContextMenu items={menu.items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}

      {dialog?.kind === "alert" && (
        <Dialog title={dialog.title} onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
      {(dialog?.kind === "newPlaylist" || dialog?.kind === "rename") && (
        <Dialog
          title={dialog.kind === "rename" ? "Rename Playlist" : "New Playlist"}
          okLabel={dialog.kind === "rename" ? "Rename" : "Create"}
          okDisabled={!dialog.name.trim()}
          onOk={() => {
            if (dialog.kind === "rename") lib.renamePlaylist(dialog.id, dialog.name)
            else {
              const p = lib.createPlaylist(dialog.name, dialog.keys)
              if (!dialog.keys.length) {
                setView("playlists")
                setOpen({ kind: "playlist", key: p.id })
              }
            }
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <label className="dialogLabel" htmlFor="mu-pl-name">
            Name:
          </label>
          <input id="mu-pl-name" autoFocus maxLength={60} value={dialog.name} onChange={(e) => setDialog({ ...dialog, name: e.target.value })} />
        </Dialog>
      )}
      {dialog?.kind === "deletePlaylist" && (
        <Dialog
          title="Delete Playlist"
          okLabel="Delete"
          onOk={() => {
            lib.deletePlaylist(dialog.id)
            setOpen(null)
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">Delete the playlist "{dialog.name}"? The songs stay in your library.</p>
        </Dialog>
      )}
      {dialog?.kind === "edit" && (
        <Dialog
          title="Edit Info"
          okLabel="Save"
          onOk={() => {
            lib.editTrack(dialog.key, { title: dialog.title.trim(), artist: dialog.artist.trim(), album: dialog.album.trim(), track: Number(dialog.track) || 0 })
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          {[
            ["title", "Title"],
            ["artist", "Artist"],
            ["album", "Album"],
            ["track", "Track number"],
          ].map(([field, label]) => (
            <React.Fragment key={field}>
              <label className="dialogLabel" htmlFor={`mu-ed-${field}`}>
                {label}:
              </label>
              <input id={`mu-ed-${field}`} maxLength={120} inputMode={field === "track" ? "numeric" : undefined} value={dialog[field]} onChange={(e) => setDialog({ ...dialog, [field]: e.target.value })} />
            </React.Fragment>
          ))}
        </Dialog>
      )}
    </div>
  )
}

export default Music
