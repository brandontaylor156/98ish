import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import { FILE_TYPE, fs, readContent } from "../../../utils/fs"
import { useFsVersion } from "../../../hooks/useFs"
import { useOpenGesture } from "../../../hooks/useMediaQuery"
import { unlockAudio } from "../../../utils/audio"
import { registerPlayer } from "./bus"
import MoreOptions from "../../shared/MoreOptions"
import { summarize } from "../../../utils/disclosure"
import { NextGlyph, PauseGlyph, PlayGlyph, PrevGlyph, RepeatGlyph, ShuffleGlyph, SpeakerGlyph, StopGlyph } from "./Glyphs"
import "./MediaPlayer.css"
import { masterGain, subscribeSettings } from "../../../utils/settings"
import { unlock } from "../../../utils/achievements"
import { helpItem } from "../../../utils/help"
import { getArt, listTracks } from "../music/musicStore"
import { artistOf, titleOf } from "../music/library"
import { launch } from "../../../utils/programs"

// Media Player, as in Windows 98, playing your own things: the songs in your Music 98
// library, the sounds you recorded (Sound Recorder's .wav files), and any song or video you
// open from your phone or computer (played here, not copied to the drive). The owner chose
// real files over the 8 built-in tunes it used to play, 2026-10-06. Space plays/pauses,
// arrows seek and change the volume.

const PREFS_KEY = "98ish.mediaPlayer"
const DEFAULT_PREFS = { volume: 80, muted: false, playlist: true, shuffle: false, repeat: false }

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

// the playlist: your songs (Music 98) and your recordings, plus anything opened from the device
const libraryItems = () => [
  ...listTracks().map((t) => ({ id: `song:${t.key}`, kind: "song", title: titleOf(t), artist: artistOf(t), file: t.file, name: t.name, songKey: t.key })),
  ...soundFiles().map((f) => ({ id: `sound:${fs.partsOf(f).join("/")}`, kind: "sound", title: f.name.replace(/\.wav$/i, ""), artist: "Sound Recorder", file: f, name: f.name })),
]

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

const MediaPlayer = ({ file: initialFile = null, windowIndex, onTitle, onClose, dispatch }) => {
  const fsVersion = useFsVersion()
  const [prefs, setPrefsState] = useState(loadPrefs)
  const [device, setDevice] = useState([]) // things opened from the phone/computer this session
  const items = useMemo(() => [...libraryItems(), ...device], [fsVersion, device])
  const [currentId, setCurrentId] = useState(null)
  const [status, setStatus] = useState("ready")
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [scrub, setScrub] = useState(null)
  const [error, setError] = useState(null)
  const [isVideo, setIsVideo] = useState(false)
  const [art, setArt] = useState(null)
  const [selected, setSelected] = useState(null)
  const [dialog, setDialog] = useState(null) // "about"
  const openGesture = useOpenGesture()
  const mediaRef = useRef(null)
  const urlRef = useRef(null)
  const uploadRef = useRef(null)
  const latest = useRef({})
  const current = items.find((i) => i.id === currentId) || null
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

  // ---- loading and playing ----

  const releaseUrl = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
  }

  const load = async (item, autoplay = true) => {
    const el = mediaRef.current
    if (!el || !item) return
    setCurrentId(item.id)
    setError(null)
    setPosition(0)
    setDuration(0)
    setStatus("loading")
    setArt(null)
    onTitle?.(`${item.title} - Media Player`)
    try {
      let url = item.url || null
      if (!url) {
        const data = await readContent(item.file)
        if (!data?.startsWith("data:")) throw new Error("empty")
        releaseUrl()
        url = urlRef.current = URL.createObjectURL(await (await fetch(data)).blob())
      }
      if (latest.current.current?.id !== item.id && latest.current.current) return // something else was chosen meanwhile
      el.src = url
      setIsVideo(item.kind === "video")
      applyVolume()
      if (item.songKey) getArt(item.songKey).then((a) => latest.current.current?.id === item.id && setArt(a || null)).catch(() => {})
      if (autoplay) {
        // Music 98 and Media Player don't play over each other
        import("../music/engine").then((m) => m.playerSnapshot().playing && m.pause()).catch(() => {})
        await el.play()
        setStatus("playing")
      } else setStatus("stopped")
    } catch {
      setStatus("stopped")
      setError("This file can't be played here.")
    }
  }

  const play = () => {
    unlockAudio()
    const el = mediaRef.current
    if (!el) return
    if (!current) return items.length && load(items[0])
    if (!el.src) return load(current)
    import("../music/engine").then((m) => m.playerSnapshot().playing && m.pause()).catch(() => {})
    el.play().then(() => setStatus("playing")).catch(() => setError("Press Play again to start the sound."))
  }
  const pause = () => {
    mediaRef.current?.pause()
    setStatus("paused")
  }
  const togglePlay = () => (status === "playing" ? pause() : play())
  const stop = () => {
    const el = mediaRef.current
    if (!el) return
    el.pause()
    el.currentTime = 0
    setPosition(0)
    setStatus("stopped")
  }
  const seek = (t) => {
    const el = mediaRef.current
    if (!el || !Number.isFinite(el.duration)) return
    el.currentTime = Math.min(Math.max(0, t), Math.max(0, el.duration - 0.2))
    setPosition(el.currentTime)
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
    const onTime = () => setPosition(el.currentTime)
    const onDur = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0)
    const onEnded = () => {
      unlock("full-song")
      const n = neighbor(1, true)
      if (n) load(n, true)
      else setStatus("stopped")
    }
    const onPause = () => !el.ended && latest.current.status === "playing" && setStatus("paused")
    el.addEventListener("timeupdate", onTime)
    el.addEventListener("durationchange", onDur)
    el.addEventListener("ended", onEnded)
    el.addEventListener("pause", onPause)
    return () => {
      el.removeEventListener("timeupdate", onTime)
      el.removeEventListener("durationchange", onDur)
      el.removeEventListener("ended", onEnded)
      el.removeEventListener("pause", onPause)
      el.pause()
      releaseUrl()
    }
  }, [])

  // a file to play when the window opens (My Computer, MS-DOS `start`), and later ones
  const playPath = (path) => {
    const item = latest.current.items.find((i) => i.file && fs.partsOf(i.file).join("/") === path)
    if (item) load(item, true)
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
    setTimeout(() => load(item, true), 0)
  }

  // ---- keyboard ----

  const onKeyDown = (e) => {
    if (dialog || e.altKey || e.ctrlKey || e.metaKey) return
    const tag = e.target.tagName
    if (e.key === " " || e.key === "Spacebar") {
      if (tag === "BUTTON" || tag === "INPUT") return
      e.preventDefault()
      togglePlay()
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (tag === "INPUT") return
      e.preventDefault()
      seek((mediaRef.current?.currentTime || 0) + (e.key === "ArrowLeft" ? -5 : 5))
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (tag === "INPUT") return
      e.preventDefault()
      setPrefs({ volume: Math.min(100, Math.max(0, prefs.volume + (e.key === "ArrowUp" ? 5 : -5))), muted: false })
    }
  }

  const openMusic = () => dispatch?.({ type: "open_window", payload: launch("Music 98") })

  const menus = [
    {
      label: "File",
      items: [{ label: "Open from Your Device...", onClick: () => uploadRef.current?.click() }, { label: "Add Songs in Music 98...", onClick: openMusic }, "-", { label: "Exit", onClick: () => onClose?.() }],
    },
    { label: "View", items: [{ label: "Playlist", checked: prefs.playlist, onClick: () => setPrefs({ playlist: !prefs.playlist }) }] },
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

  const shown = scrub ?? position
  const playing = status === "playing"

  return (
    <div className="mpRoot" tabIndex={-1} onKeyDown={onKeyDown} data-state={status} data-item={current?.id || ""}>
      <MenuBar menus={menus} />
      <input ref={uploadRef} type="file" accept="audio/*,video/*" hidden onChange={(e) => (openFromDevice(e.target.files?.[0]), (e.target.value = ""))} />

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
        <MoreOptions id="mediaplayer.more" inline className="mpMore" label="More" lessLabel="Less" summary={summarize(prefs.shuffle && "Shuffle", prefs.repeat && "Repeat", prefs.muted ? "Muted" : `Volume ${prefs.volume}%`)}>
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
        </MoreOptions>
      </div>

      <div className="mpInfo">
        <dl>
          <dt>Show:</dt>
          <dd className="mpTitle">{current?.title || ""}</dd>
          <dt>Clip:</dt>
          <dd>{current?.name || ""}</dd>
          <dt>Author:</dt>
          <dd>{current?.artist || ""}</dd>
        </dl>
        <div className="mpTime" aria-label="Time">
          <span className="mpElapsed">{formatTime(shown)}</span>
          <span className="mpTotal">/ {formatTime(duration)}</span>
        </div>
      </div>

      {prefs.playlist && (
        <div className="mpPlaylist" role="listbox" aria-label="Playlist">
          {items.map((item, i) => (
            <div
              key={item.id}
              role="option"
              aria-selected={selected === item.id}
              className={`mpRow ${selected === item.id ? "is-selected" : ""} ${item.id === current?.id ? "is-current" : ""}`}
              data-item={item.id}
              onPointerDown={() => setSelected(item.id)}
              {...openGesture(() => (unlockAudio(), load(item, true)))}
            >
              <span className="mpRowMark">{item.id === current?.id ? (playing ? "▶︎" : "■") : i + 1}</span>
              <span className="mpRowTitle">{item.title}</span>
              <span className="mpRowFile">{item.kind === "sound" ? "Recording" : item.kind === "video" ? "Video" : item.artist}</span>
            </div>
          ))}
          {!items.length && (
            <div className="mpEmpty" data-media-empty>
              <p>No songs or recordings yet.</p>
              <p>Add your songs in Music 98, record something in Sound Recorder, or open a song or video from your device.</p>
              <div className="mpEmptyButtons">
                <button type="button" onClick={openMusic}>
                  Open Music 98
                </button>
                <button type="button" onClick={() => uploadRef.current?.click()}>
                  Open from Your Device...
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="status-bar mpStatus">
        <p className="status-bar-field mpStatusState">{STATUS_TEXT[status]}</p>
        <p className="status-bar-field mpStatusSong">{current?.name || ""}</p>
        <p className="status-bar-field mpStatusTime">
          {formatTime(shown)} / {formatTime(duration)}
        </p>
      </div>

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
              <p className="dialogText">Plays the songs in your Music 98 library, your Sound Recorder recordings, and songs and videos you open from your device.</p>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}

export default MediaPlayer
