import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import ContextMenu from "../../shared/ContextMenu"
import { FILE_TYPE, fs, isDeviceOnly, mediaBlob } from "../../../utils/fs"
import { useFsVersion } from "../../../hooks/useFs"
import { useOpenGesture } from "../../../hooks/useMediaQuery"
import { claimPlaybackSession, unlockAudio } from "../../../utils/audio"
import { registerPlayer } from "./bus"
import MoreOptions from "../../shared/MoreOptions"
import { summarize } from "../../../utils/disclosure"
import { NextGlyph, PauseGlyph, PlayGlyph, PrevGlyph, RepeatGlyph, ShuffleGlyph, SpeakerGlyph, StopGlyph } from "./Glyphs"
import "./MediaPlayer.css"
import { masterGain, subscribeSettings } from "../../../utils/settings"
import { unlock } from "../../../utils/achievements"
import { helpItem } from "../../../utils/help"
import { SONG_ACCEPT, addToPlaylist, createPlaylist, getArt, importSongs, listTracks, playlists as allPlaylists, removeFromPlaylist, subscribeMusic } from "../music/musicStore"
import { artistOf, titleOf } from "../music/library"
import { explorerWindow, launch } from "../../../utils/programs"
import { DEVICE_ONLY_LINE } from "../../../utils/mediaRules"
import { clearResume, getResume, importVideos, listVideos, readPendingVideos, saveResume, subscribeVideos, tidyVideos } from "./videoStore"
import { formatDuration, playlistItems, progressOf, resumePoint, searchMedia, sortVideos } from "./videoLib"

// Media Player, as in Windows 98, playing your own things. Since wave 2 (2026-10-08) it's the
// library for your music AND your videos: Library: Music | Videos.
//  - Music: the songs in your Music 98 library and Sound Recorder's recordings.
//  - Videos: the video files on drive C: (C:\My Videos), each with a poster frame and its
//    length; a video picks up where you stopped it (videoStore.js / videoLib.js).
//  - Add Songs... / Add Videos... keep the original files in the drive (no conversion; files
//    over 8 MB stay on this device: utils/mediaFiles.js). File > Open from Your Device... still
//    plays something once without keeping it.
//  - More options: Stop, Shuffle, Repeat, volume, Search, a playlist (Music 98's playlists,
//    which can hold videos too), Picture in Picture.
// Space plays/pauses, arrows seek and change the volume. Lock screen / Control Center
// controls through the Media Session API.

const PREFS_KEY = "98ish.mediaPlayer"
const DEFAULT_PREFS = { volume: 80, muted: false, playlist: true, shuffle: false, repeat: false, tab: "music", list: "" }
const VIDEO_ACCEPT = "video/*,.mp4,.m4v,.mov,.webm"

const loadPrefs = () => {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY)) }
  } catch {
    return DEFAULT_PREFS
  }
}

export const formatTime = (seconds) => {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
}

// volume slider (0-100) -> gain, on a curve that sounds even
const gainFor = (volume) => Math.pow(volume / 100, 2)
const STATUS_TEXT = { playing: "Playing", paused: "Paused", stopped: "Stopped", ready: "Ready", loading: "Opening..." }

// every sound recording on the drive (not the Recycle Bin)
const soundFiles = () => {
  const out = []
  const walk = (dir) => {
    for (const item of dir.content || []) {
      if (item.isDirectory) walk(item)
      else if (item.type === FILE_TYPE.sound) out.push(item)
    }
  }
  const drive = fs.resolve("C:")
  if (drive?.isDirectory) walk(drive)
  return out
}

// Music: your songs (Music 98) and your recordings
const musicItems = () => [
  ...listTracks().map((t) => ({ id: `song:${t.key}`, kind: "song", key: t.key, title: titleOf(t), artist: artistOf(t), album: t.album, file: t.file, name: t.name, songKey: t.key, duration: t.duration })),
  ...soundFiles().map((f) => ({ id: `sound:${fs.partsOf(f).join("/")}`, kind: "sound", key: f.contentHash, title: f.name.replace(/\.wav$/i, ""), artist: "Sound Recorder", file: f, name: f.name })),
]

// Videos: the video files on the drive, newest first
const videoItems = () =>
  sortVideos(listVideos()).map((v) => ({ id: `video:${v.key}`, kind: "video", key: v.key, title: v.title, artist: "Video", file: v.file, name: v.name, duration: v.duration, poster: v.poster, added: v.added, pending: v.pending }))

// A video's poster frame (from the art store), or a film-strip placeholder
const Poster = ({ item }) => {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let live = true
    setSrc(null)
    if (item.poster) getArt(item.poster).then((url) => live && setSrc(url || null))
    return () => {
      live = false
    }
  }, [item.poster])
  return <span className="mpPoster">{src ? <img src={src} alt="" /> : <span className="mpPosterNone" aria-hidden="true" />}</span>
}

// A transport button. It doesn't take focus on click, so the keyboard keeps working.
const Btn = ({ label, onClick, children, on, disabled, className = "" }) => (
  <button
    type="button"
    className={`mpBtn ${on ? "is-on" : ""} ${className}`}
    title={label}
    aria-label={label}
    aria-pressed={on === undefined ? undefined : on}
    disabled={disabled}
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
  >
    {children}
  </button>
)

const pipSupported = (el) => !!el && ((typeof document !== "undefined" && document.pictureInPictureEnabled && !el.disablePictureInPicture) || typeof el.webkitSetPresentationMode === "function")

const MediaPlayer = ({ file: initialFile = null, windowIndex, onTitle, onClose, dispatch }) => {
  const fsVersion = useFsVersion()
  const [prefs, setPrefsState] = useState(loadPrefs)
  const [libVersion, setLibVersion] = useState(0)
  const [device, setDevice] = useState([]) // things opened from the phone/computer this session
  const [query, setQuery] = useState("")
  const all = useMemo(() => ({ music: musicItems(), videos: videoItems() }), [fsVersion, libVersion])
  const lists = allPlaylists()
  const tab = prefs.tab === "videos" ? "videos" : "music"
  const playlist = lists.find((p) => p.id === prefs.list) || null
  const items = useMemo(() => {
    let list = [...all[tab], ...device.filter((d) => (d.kind === "video") === (tab === "videos"))]
    if (playlist) list = playlistItems(playlist.keys, list)
    return searchMedia(list, query)
  }, [all, device, tab, playlist, query])
  const [currentId, setCurrentId] = useState(null)
  const [status, setStatus] = useState("ready")
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [scrub, setScrub] = useState(null)
  const [error, setError] = useState(null)
  const [isVideo, setIsVideo] = useState(false)
  const [art, setArt] = useState(null)
  const [selected, setSelected] = useState(null)
  const [resumedAt, setResumedAt] = useState(null)
  const [busy, setBusy] = useState(null)
  const [menu, setMenu] = useState(null)
  const [dialog, setDialog] = useState(null) // "about" | { kind: "newPlaylist" | "alert", ... }
  const openGesture = useOpenGesture()
  const mediaRef = useRef(null)
  const urlRef = useRef(null)
  const uploadRef = useRef(null)
  const songsRef = useRef(null)
  const videosRef = useRef(null)
  const releaseSession = useRef(null)
  const savedAt = useRef(0)
  const handlers = useRef({})
  const latest = useRef({})
  const current = [...all.music, ...all.videos, ...device].find((i) => i.id === currentId) || null
  latest.current = { items, current, prefs, status }

  const setPrefs = (patch) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      } catch {
        // this visit only
      }
      return next
    })

  useEffect(() => {
    const bump = () => setLibVersion((v) => v + 1)
    const offA = subscribeVideos(bump)
    const offB = subscribeMusic(bump)
    return () => (offA(), offB())
  }, [])

  // videos without details yet (synced, copied, from before): read a few in the background
  useEffect(() => {
    if (tab !== "videos") return
    const t = setTimeout(() => {
      tidyVideos()
      readPendingVideos(listVideos())
    }, 300)
    return () => clearTimeout(t)
  }, [tab, fsVersion])

  // the taskbar's volume and mute, times this player's own
  const applyVolume = () => {
    const el = mediaRef.current
    if (!el) return
    const p = latest.current.prefs
    el.volume = Math.max(0, Math.min(1, masterGain() * gainFor(p.volume)))
    el.muted = p.muted || masterGain() === 0
  }
  useEffect(() => subscribeSettings(applyVolume), [])
  useEffect(applyVolume, [prefs.volume, prefs.muted])

  // ---- continue where you left off (videos) ----

  const rememberPlace = (force = false) => {
    const el = mediaRef.current
    const now = latest.current.current
    if (!el || !now || now.kind !== "video" || !now.key || now.url) return
    if (!force && Date.now() - savedAt.current < 5000) return
    savedAt.current = Date.now()
    const d = Number.isFinite(el.duration) ? el.duration : now.duration || 0
    saveResume(now.key, el.currentTime, d)
  }

  // ---- lock screen / Control Center (Media Session) ----

  const session = () => (typeof navigator !== "undefined" && navigator.mediaSession ? navigator.mediaSession : null)
  const claimSession = (item, artwork) => {
    const ms = session()
    if (!ms) return
    try {
      if (typeof MediaMetadata !== "undefined")
        ms.metadata = new MediaMetadata({
          title: item.title,
          artist: item.kind === "video" ? "" : item.artist || "",
          album: item.album || (item.kind === "video" ? "Videos" : ""),
          artwork: artwork ? [{ src: artwork, sizes: "256x256", type: "image/jpeg" }] : [{ src: "/assets/program_icons/mediaplayer.svg", sizes: "any", type: "image/svg+xml" }],
        })
    } catch {
      // older browsers
    }
    const on = (action, fn) => {
      try {
        ms.setActionHandler(action, fn)
      } catch {
        // not supported
      }
    }
    // through a ref: the newest play/pause/next..., never the ones from when it was set
    const h = () => handlers.current
    on("play", () => h().play())
    on("pause", () => h().pause())
    on("previoustrack", () => h().prev())
    on("nexttrack", () => h().next())
    on("seekto", (d) => d?.seekTime != null && h().seek(d.seekTime))
    on("seekbackward", (d) => h().seek((mediaRef.current?.currentTime || 0) - (d?.seekOffset || 10)))
    on("seekforward", (d) => h().seek((mediaRef.current?.currentTime || 0) + (d?.seekOffset || 10)))
    on("stop", () => h().stop())
  }
  const positionAt = useRef(0)
  const positionState = (force = false) => {
    const ms = session()
    const el = mediaRef.current
    if (!ms?.setPositionState || !el || !Number.isFinite(el.duration) || !el.duration) return
    if (!force && Date.now() - positionAt.current < 4000) return
    positionAt.current = Date.now()
    try {
      ms.setPositionState({ duration: el.duration, playbackRate: el.playbackRate || 1, position: Math.min(el.duration, el.currentTime) })
    } catch {
      // bad numbers
    }
  }
  // the iPhone ringer switch doesn't silence what you chose to play
  const holdSession = (on) => {
    if (on && !releaseSession.current) releaseSession.current = claimPlaybackSession()
    if (!on && releaseSession.current) {
      releaseSession.current()
      releaseSession.current = null
    }
  }

  // ---- loading and playing ----

  const releaseUrl = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
  }

  // a time on an element as soon as it knows its length
  const seekWhenReady = (el, t) =>
    new Promise((resolve) => {
      const go = () => {
        try {
          el.currentTime = t
        } catch {
          // fine: it starts from the beginning
        }
        resolve()
      }
      if (el.readyState >= 1) return go()
      const on = () => (el.removeEventListener("loadedmetadata", on), go())
      el.addEventListener("loadedmetadata", on)
      setTimeout(resolve, 5000)
    })

  const load = async (item, autoplay = true, { fromStart = false } = {}) => {
    const el = mediaRef.current
    if (!el || !item) return
    rememberPlace(true)
    setCurrentId(item.id)
    setError(null)
    setPosition(0)
    setDuration(0)
    setStatus("loading")
    setArt(null)
    setResumedAt(null)
    onTitle?.(`${item.title} - Media Player`)
    let opened = false
    try {
      let url = item.url || null
      if (!url) {
        // a data URL or a big file kept on this device: a Blob either way, never a giant text
        const blob = await mediaBlob(item.file)
        if (!blob) throw new Error("empty")
        opened = true
        releaseUrl()
        url = urlRef.current = URL.createObjectURL(blob)
      }
      if (latest.current.current?.id !== item.id && latest.current.current) return // something else was chosen meanwhile
      el.src = url
      setIsVideo(item.kind === "video")
      applyVolume()
      let artwork = null
      if (item.songKey) artwork = await getArt(item.songKey).catch(() => null)
      else if (item.poster) artwork = await getArt(item.poster).catch(() => null)
      if (item.songKey) setArt(artwork || null)
      if (item.kind === "video" && item.key && !item.url) {
        if (fromStart) clearResume(item.key)
        const at = fromStart ? 0 : resumePoint(getResume(item.key), item.duration)
        if (at) {
          await seekWhenReady(el, at)
          setResumedAt(at)
        }
      }
      claimSession(item, artwork)
      if (autoplay) {
        // Music 98 and Media Player don't play over each other
        import("../music/engine").then((m) => m.playerSnapshot().playing && m.pause()).catch(() => {})
        await el.play()
        holdSession(true)
        setStatus("playing")
      } else setStatus("stopped")
    } catch (error) {
      setStatus("stopped")
      if (error?.name === "NotAllowedError") setError("Press Play to start it.")
      else if (!opened && !item.url && item.file && isDeviceOnly(item.file)) setError("This file isn't on this device any more.")
      else setError("This file can't be played here.")
    }
  }

  const play = () => {
    unlockAudio()
    const el = mediaRef.current
    if (!el) return
    if (!current) return items.length && load(items[0])
    if (!el.src) return load(current)
    import("../music/engine").then((m) => m.playerSnapshot().playing && m.pause()).catch(() => {})
    el.play()
      .then(() => (holdSession(true), setStatus("playing")))
      .catch(() => setError("Press Play again to start it."))
  }
  const pause = () => {
    mediaRef.current?.pause()
    rememberPlace(true)
    setStatus("paused")
  }
  const togglePlay = () => (status === "playing" ? pause() : play())
  const stop = () => {
    const el = mediaRef.current
    if (!el) return
    rememberPlace(true)
    el.pause()
    el.currentTime = 0
    setPosition(0)
    setStatus("stopped")
    holdSession(false)
  }
  // the element's length, or the one measured when the video came in (browser recordings
  // don't say until they've played to the end)
  const lengthOf = (el) => (Number.isFinite(el?.duration) ? el.duration : latest.current.current?.duration || 0)
  const seek = (t) => {
    const el = mediaRef.current
    const d = lengthOf(el)
    if (!el || !d) return
    el.currentTime = Math.min(Math.max(0, t), Math.max(0, d - 0.2))
    setPosition(el.currentTime)
    positionState(true)
  }
  const startOver = () => {
    if (current?.key) clearResume(current.key)
    seek(0)
    setResumedAt(null)
  }

  // the item after (dir 1) or before (dir -1); null at the end of the list (no repeat)
  const neighbor = (dir, auto = false) => {
    const { items: list, current: now, prefs: p } = latest.current
    if (!list.length) return null
    const i = Math.max(0, list.findIndex((x) => x.id === now?.id))
    if (p.shuffle && list.length > 1) {
      let j = i
      while (j === i) j = Math.floor(Math.random() * list.length)
      return list[j]
    }
    const j = i + dir
    if (j >= list.length) return p.repeat || !auto ? list[0] : null
    if (j < 0) return list[list.length - 1]
    return list[j]
  }
  const next = () => {
    unlockAudio()
    const n = neighbor(1)
    if (n) load(n, latest.current.status === "playing")
  }
  const prev = () => {
    unlockAudio()
    const el = mediaRef.current
    if (el && el.currentTime > 3) return seek(0)
    const n = neighbor(-1)
    if (n) load(n, latest.current.status === "playing")
  }

  // the element's events
  useEffect(() => {
    const el = mediaRef.current
    if (!el) return
    const onTime = () => {
      setPosition(el.currentTime)
      rememberPlace()
      positionState()
    }
    const onDur = () => setDuration(lengthOf(el))
    const onEnded = () => {
      unlock("full-song")
      const now = latest.current.current
      if (now?.kind === "video" && now.key) clearResume(now.key)
      const n = neighbor(1, true)
      if (n) load(n, true)
      else {
        setStatus("stopped")
        holdSession(false)
      }
    }
    const onPause = () => {
      if (!el.ended && latest.current.status === "playing") setStatus("paused")
      rememberPlace(true)
    }
    el.addEventListener("timeupdate", onTime)
    el.addEventListener("durationchange", onDur)
    el.addEventListener("ended", onEnded)
    el.addEventListener("pause", onPause)
    return () => {
      rememberPlace(true)
      el.removeEventListener("timeupdate", onTime)
      el.removeEventListener("durationchange", onDur)
      el.removeEventListener("ended", onEnded)
      el.removeEventListener("pause", onPause)
      el.pause()
      releaseUrl()
      holdSession(false)
    }
  }, [])

  // a file to play when the window opens (My Computer, MS-DOS `start`), and later ones
  const playPath = (path) => {
    // fresh lists: the file may have just arrived
    const item = [...musicItems(), ...videoItems()].find((i) => i.file && fs.partsOf(i.file).join("/") === path)
    if (!item) return
    if ((item.kind === "video") !== (latest.current.prefs.tab === "videos")) setPrefs({ tab: item.kind === "video" ? "videos" : "music", list: "" })
    load(item, true)
  }
  useEffect(() => {
    if (initialFile) playPath(initialFile)
  }, [])
  useEffect(() => registerPlayer({ index: windowIndex, play: playPath }), [windowIndex])

  // a song or video from the phone or computer: played from memory, never copied to the drive
  const openFromDevice = (file) => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const video = /^video\//i.test(file.type) || /\.(mp4|mov|m4v|webm)$/i.test(file.name)
    const item = { id: `device:${Date.now()}`, kind: video ? "video" : "song", title: file.name.replace(/\.[^.]+$/, ""), artist: "From your device", name: file.name, url }
    setDevice((d) => [...d, item].slice(-20))
    if (video !== (tab === "videos")) setPrefs({ tab: video ? "videos" : "music", list: "" })
    setTimeout(() => load(item, true), 0)
  }

  // ---- adding to the library (kept in the drive as they are) ----

  const addFiles = async (files, kind) => {
    if (!files?.length) return
    setBusy(kind === "videos" ? "Adding videos..." : "Adding songs...")
    const progress = (i, n, name) => setBusy(name ? `Adding ${name} (${i + 1} of ${n})...` : "Finishing...")
    const result = kind === "videos" ? await importVideos(files, progress) : await importSongs(files, progress)
    setBusy(null)
    setLibVersion((v) => v + 1)
    const notes = result.notes || []
    const word = kind === "videos" ? "video" : "song"
    const note = notes.length > 1 ? `${notes.length} of them are over 8 MB, so they're kept on this device only (not synced or backed up).` : notes[0] || ""
    if (result.problems.length || note)
      setDialog({ kind: "alert", title: kind === "videos" ? "Add Videos" : "Add Songs", text: `${result.added.length ? `Added ${result.added.length} ${word}${result.added.length === 1 ? "" : "s"}. ` : ""}${[...result.problems, note].filter(Boolean).join(" ")}` })
  }
  const pickAdd = () => (tab === "videos" ? videosRef : songsRef).current?.click()

  // ---- a row's menu ("..." or right-click) ----

  const openMenu = (item, x, y) => {
    const resumable = item.kind === "video" && item.key && resumePoint(getResume(item.key), item.duration)
    const inLibrary = !!item.file && !!item.key
    setMenu({
      x,
      y,
      items: [
        { label: "Play", bold: true, onClick: () => (unlockAudio(), load(item, true)) },
        ...(resumable ? [{ label: "Play from Start", onClick: () => (unlockAudio(), load(item, true, { fromStart: true })) }] : []),
        {
          label: "Add to Playlist",
          disabled: !inLibrary,
          items: [
            { label: "New Playlist...", onClick: () => setDialog({ kind: "newPlaylist", name: "", keys: [item.key] }) },
            ...(lists.length ? ["-"] : []),
            ...lists.map((p) => ({ label: p.name, onClick: () => addToPlaylist(p.id, [item.key]) })),
          ],
        },
        ...(playlist && inLibrary ? [{ label: "Remove from Playlist", onClick: () => removeFromPlaylist(playlist.id, item.key) }] : []),
        ...(item.file?.parent ? ["-", { label: "Show in My Computer", onClick: () => dispatch?.({ type: "open_window", payload: explorerWindow(fs.partsOf(item.file.parent)) }) }] : []),
      ],
    })
  }

  // ---- keyboard ----

  const onKeyDown = (e) => {
    if (dialog || e.altKey || e.ctrlKey || e.metaKey) return
    const tag = e.target.tagName
    if (e.key === " " || e.key === "Spacebar") {
      if (tag === "BUTTON" || tag === "INPUT" || tag === "SELECT") return
      e.preventDefault()
      togglePlay()
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (tag === "INPUT") return
      e.preventDefault()
      seek((mediaRef.current?.currentTime || 0) + (e.key === "ArrowLeft" ? -5 : 5))
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (tag === "INPUT" || tag === "SELECT") return
      e.preventDefault()
      setPrefs({ volume: Math.min(100, Math.max(0, prefs.volume + (e.key === "ArrowUp" ? 5 : -5))), muted: false })
    }
  }

  const openMusic = () => dispatch?.({ type: "open_window", payload: launch("Music 98") })
  const pictureInPicture = () => {
    const el = mediaRef.current
    if (!el) return
    try {
      if (document.pictureInPictureElement) document.exitPictureInPicture()
      else if (el.requestPictureInPicture) el.requestPictureInPicture().catch(() => setError("Picture in Picture didn't start."))
      else el.webkitSetPresentationMode?.(el.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture")
    } catch {
      setError("Picture in Picture didn't start.")
    }
  }
  const switchTab = (t) => {
    if (t !== tab) setPrefs({ tab: t, list: "" })
    setQuery("")
  }

  const menus = [
    {
      label: "File",
      items: [
        { label: "Add Songs...", onClick: () => songsRef.current?.click() },
        { label: "Add Videos...", onClick: () => videosRef.current?.click() },
        { label: "Open from Your Device...", onClick: () => uploadRef.current?.click() },
        "-",
        { label: "Open Music 98", onClick: openMusic },
        "-",
        { label: "Exit", onClick: () => onClose?.() },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Music", checked: tab === "music", onClick: () => switchTab("music") },
        { label: "Videos", checked: tab === "videos", onClick: () => switchTab("videos") },
        "-",
        { label: "Playlist", checked: prefs.playlist, onClick: () => setPrefs({ playlist: !prefs.playlist }) },
      ],
    },
    {
      label: "Play",
      items: [
        { label: status === "playing" ? "Pause" : "Play", onClick: togglePlay, disabled: !items.length },
        { label: "Stop", onClick: stop, disabled: status !== "playing" && status !== "paused" },
        "-",
        { label: "Previous", onClick: prev, disabled: !items.length },
        { label: "Next", onClick: next, disabled: !items.length },
        "-",
        { label: "Shuffle", checked: prefs.shuffle, onClick: () => setPrefs({ shuffle: !prefs.shuffle }) },
        { label: "Repeat", checked: prefs.repeat, onClick: () => setPrefs({ repeat: !prefs.repeat }) },
        "-",
        { label: "Mute", checked: prefs.muted, onClick: () => setPrefs({ muted: !prefs.muted }) },
      ],
    },
    { label: "Help", items: [helpItem({ program: "Media Player" }), "-", { label: "About Media Player...", onClick: () => setDialog("about") }] },
  ]

  handlers.current = { play, pause, prev, next, seek, stop }
  const shown = scrub ?? position
  const playing = status === "playing"
  const canPip = isVideo && pipSupported(mediaRef.current)
  const emptyLibrary = !all[tab].length && !device.some((d) => (d.kind === "video") === (tab === "videos"))

  return (
    <div className="mpRoot" tabIndex={-1} onKeyDown={onKeyDown} data-state={status} data-item={current?.id || ""} data-tab={tab}>
      <MenuBar menus={menus} />
      <input ref={uploadRef} type="file" accept="audio/*,video/*" hidden onChange={(e) => (openFromDevice(e.target.files?.[0]), (e.target.value = ""))} />
      <input ref={songsRef} type="file" accept={SONG_ACCEPT} multiple hidden data-add="songs" onChange={(e) => (addFiles([...(e.target.files || [])], "music"), (e.target.value = ""))} />
      <input ref={videosRef} type="file" accept={VIDEO_ACCEPT} multiple hidden data-add="videos" onChange={(e) => (addFiles([...(e.target.files || [])], "videos"), (e.target.value = ""))} />

      <div className={`mpDisplay${isVideo ? " is-video" : ""}`}>
        <video ref={mediaRef} className="mpVideo" playsInline preload="auto" style={{ display: isVideo ? "block" : "none" }} />
        {!isVideo && current && (
          <div className="mpNow">
            {art ? <img src={art} alt="" className="mpArt" /> : <span className="mpLogo">♪</span>}
            <span className="mpNowTitle">{current.title}</span>
            <span>{current.artist}</span>
          </div>
        )}
        {!current && (
          <div className="mpDisplayNote">
            <span className="mpLogo">98ish Media Player</span>
            <span>{items.length ? "Press Play" : "Nothing to play yet"}</span>
          </div>
        )}
        {resumedAt != null && isVideo && (
          <div className="mpResumed" data-resumed={Math.round(resumedAt)}>
            <span>Resumed at {formatDuration(resumedAt)}</span>
            <button type="button" onClick={startOver}>
              Start Over
            </button>
          </div>
        )}
        {error && <div className="mpDisplayNote mpError">{error}</div>}
      </div>

      <div className="mpSeek">
        <input
          type="range"
          aria-label="Seek"
          min={0}
          max={Math.max(1, Math.floor(duration))}
          step={0.1}
          value={Math.min(shown, Math.max(1, duration))}
          disabled={!duration}
          onPointerDown={() => setScrub(position)}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (scrub !== null) setScrub(v)
            else seek(v)
          }}
          onPointerUp={(e) => {
            if (scrub === null) return
            seek(Number(e.target.value))
            setScrub(null)
          }}
          onPointerCancel={() => setScrub(null)}
        />
      </div>

      <div className="mpControls">
        <div className="mpTransport">
          {playing ? (
            <Btn label="Pause" onClick={pause} on>
              <PauseGlyph />
            </Btn>
          ) : (
            <Btn label="Play" onClick={play} disabled={!items.length}>
              <PlayGlyph />
            </Btn>
          )}
          <Btn label="Previous" onClick={prev} disabled={!items.length}>
            <PrevGlyph />
          </Btn>
          <Btn label="Next" onClick={next} disabled={!items.length}>
            <NextGlyph />
          </Btn>
        </div>
        <MoreOptions
          id="mediaplayer.more"
          inline
          className="mpMore"
          label="More"
          lessLabel="Less"
          summary={summarize(playlist && `Playlist: ${playlist.name}`, query && `"${query}"`, prefs.shuffle && "Shuffle", prefs.repeat && "Repeat", prefs.muted ? "Muted" : `Volume ${prefs.volume}%`)}
        >
          <div className="mpTransport">
            <Btn label="Stop" onClick={stop} disabled={status !== "playing" && status !== "paused"}>
              <StopGlyph />
            </Btn>
            <span className="mpSep" />
            <Btn label="Shuffle" onClick={() => setPrefs({ shuffle: !prefs.shuffle })} on={prefs.shuffle}>
              <ShuffleGlyph />
            </Btn>
            <Btn label="Repeat" onClick={() => setPrefs({ repeat: !prefs.repeat })} on={prefs.repeat}>
              <RepeatGlyph />
            </Btn>
          </div>
          <div className="mpVolume">
            <Btn label={prefs.muted ? "Unmute" : "Mute"} onClick={() => setPrefs({ muted: !prefs.muted })} on={prefs.muted} className="mpMute">
              <SpeakerGlyph muted={prefs.muted} />
            </Btn>
            <input type="range" aria-label="Volume" min={0} max={100} value={prefs.muted ? 0 : prefs.volume} onChange={(e) => setPrefs({ volume: Number(e.target.value), muted: false })} />
          </div>
          <div className="mpFind">
            <label>
              Search:{" "}
              <input type="search" className="mpSearch" value={query} placeholder={tab === "videos" ? "Video name" : "Song, artist, album"} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <label>
              Playlist:{" "}
              <select className="mpListPick" value={playlist?.id || ""} onChange={(e) => setPrefs({ list: e.target.value })}>
                <option value="">{tab === "videos" ? "All videos" : "All music"}</option>
                {lists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {canPip && (
              <button type="button" onClick={pictureInPicture}>
                Picture in Picture
              </button>
            )}
          </div>
        </MoreOptions>
      </div>

      <div className="mpInfo">
        <dl>
          <dt>Show:</dt>
          <dd className="mpTitle">{current?.title || ""}</dd>
          <dt>Clip:</dt>
          <dd>{current?.name || ""}</dd>
          <dt>Author:</dt>
          <dd>{current?.file && isDeviceOnly(current.file) ? DEVICE_ONLY_LINE : current?.artist || ""}</dd>
        </dl>
        <div className="mpTime" aria-label="Time">
          <span className="mpElapsed">{formatTime(shown)}</span>
          <span className="mpTotal">/ {formatTime(duration)}</span>
        </div>
      </div>

      <div className="mpLibBar">
        <div className="mpTabs" role="tablist" aria-label="Library">
          <button type="button" role="tab" aria-selected={tab === "music"} className={tab === "music" ? "is-on" : ""} onClick={() => switchTab("music")}>
            Music
          </button>
          <button type="button" role="tab" aria-selected={tab === "videos"} className={tab === "videos" ? "is-on" : ""} onClick={() => switchTab("videos")}>
            Videos
          </button>
        </div>
        <button type="button" className="mpAdd" onClick={pickAdd} disabled={!!busy}>
          {tab === "videos" ? "Add Videos..." : "Add Songs..."}
        </button>
      </div>
      {busy && <div className="mpBusy">{busy}</div>}

      {prefs.playlist && (
        <div className="mpPlaylist" role="listbox" aria-label={tab === "videos" ? "Videos" : "Music"}>
          {items.map((item, i) => {
            const resume = item.kind === "video" && item.key && !item.url ? progressOf(getResume(item.key), item.duration) : 0
            return (
              <div
                key={item.id}
                role="option"
                aria-selected={selected === item.id}
                className={`mpRow ${item.kind === "video" ? "mpVideoRow " : ""}${selected === item.id ? "is-selected" : ""} ${item.id === current?.id ? "is-current" : ""}`}
                data-item={item.id}
                onPointerDown={() => setSelected(item.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  openMenu(item, e.clientX, e.clientY)
                }}
                {...openGesture(() => (unlockAudio(), load(item, true)))}
              >
                {item.kind === "video" ? <Poster item={item} /> : <span className="mpRowMark">{item.id === current?.id ? (playing ? "▶︎" : "■") : i + 1}</span>}
                <span className="mpRowTitle">
                  {item.title}
                  {item.kind === "video" && resume > 0 && (
                    <span className="mpResumeBar" title="Continue where you left off" data-progress={Math.round(resume * 100)}>
                      <span style={{ width: `${Math.round(resume * 100)}%` }} />
                    </span>
                  )}
                </span>
                {item.kind === "video" ? (
                  <span className="mpRowTime">{item.duration ? formatDuration(item.duration) : item.pending ? "..." : ""}</span>
                ) : (
                  <span className="mpRowFile">{item.kind === "sound" ? "Recording" : item.artist}</span>
                )}
                <button
                  type="button"
                  className="mpRowMore"
                  aria-label={`More for ${item.title}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    const r = e.currentTarget.getBoundingClientRect()
                    openMenu(item, r.left, r.bottom)
                  }}
                >
                  …
                </button>
              </div>
            )
          })}
          {!items.length && emptyLibrary && tab === "music" && (
            <div className="mpEmpty" data-media-empty>
              <p>No songs or recordings yet.</p>
              <p>Add your songs (they're kept whole, as they are), record something in Sound Recorder, or open a song from your device.</p>
              <div className="mpEmptyButtons">
                <button type="button" onClick={() => songsRef.current?.click()}>
                  Add Songs...
                </button>
                <button type="button" onClick={() => uploadRef.current?.click()}>
                  Open from Your Device...
                </button>
              </div>
            </div>
          )}
          {!items.length && emptyLibrary && tab === "videos" && (
            <div className="mpEmpty" data-media-empty="videos">
              <p>No videos yet.</p>
              <p>Add videos from your phone or computer: they're kept as they are in C:\My Videos, and each one picks up where you stopped it.</p>
              <div className="mpEmptyButtons">
                <button type="button" onClick={() => videosRef.current?.click()}>
                  Add Videos...
                </button>
              </div>
            </div>
          )}
          {!items.length && !emptyLibrary && <div className="mpEmpty">{query ? `Nothing matches "${query}".` : "This playlist has nothing here yet: use a row's … button > Add to Playlist."}</div>}
        </div>
      )}

      <div className="status-bar mpStatus">
        <p className="status-bar-field mpStatusState">{STATUS_TEXT[status]}</p>
        <p className="status-bar-field mpStatusSong">{current?.name || ""}</p>
        <p className="status-bar-field mpStatusTime">
          {formatTime(shown)} / {formatTime(duration)}
        </p>
      </div>

      {menu && <ContextMenu items={menu.items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}

      {dialog?.kind === "newPlaylist" && (
        <Dialog
          title="New Playlist"
          okLabel="Create"
          okDisabled={!dialog.name.trim()}
          onOk={() => {
            createPlaylist(dialog.name, dialog.keys)
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <label className="dialogText mpNameRow">
            Name:{" "}
            <input type="text" autoFocus value={dialog.name} maxLength={60} onChange={(e) => setDialog({ ...dialog, name: e.target.value })} />
          </label>
        </Dialog>
      )}

      {dialog?.kind === "alert" && (
        <Dialog title={dialog.title} onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}

      {dialog === "about" && (
        <Dialog title="About Media Player" onOk={() => setDialog(null)}>
          <div className="mpAbout">
            <img src="/assets/program_icons/mediaplayer.svg" alt="" width="48" height="48" />
            <div>
              <p className="dialogText">
                <b>98ish Media Player</b>
                <br />
                Version 6.4.98
              </p>
              <p className="dialogText">Your music and videos in one library: the songs in Music 98, your Sound Recorder recordings, and your videos (each picks up where you stopped it). Files are kept as they came.</p>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}

export default MediaPlayer
