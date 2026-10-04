import React, { useEffect, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import { fs } from "../../../utils/fs"
import { useFsVersion } from "../../../hooks/useFs"
import { useOpenGesture } from "../../../hooks/useMediaQuery"
import { createEngine, unlockAudio } from "./engine"
import { compile } from "./sequencer"
import { SONGS, findSong } from "./songs"
import { registerPlayer } from "./bus"
import { NextGlyph, PauseGlyph, PlayGlyph, PrevGlyph, RepeatGlyph, ShuffleGlyph, SpeakerGlyph, StopGlyph } from "./Glyphs"
import "./MediaPlayer.css"
import { masterGain, useSettings } from "../../../utils/settings"
import { unlock } from "../../../utils/achievements"
import { helpItem } from "../../../utils/help"

// Media Player, as in Windows 98: plays the MIDI songs in C:\My Music (all original tunes,
// synthesized live, see songs/), with a spectrum analyzer or oscilloscope, a seek bar,
// shuffle/repeat and a playlist. Space plays/pauses, arrows seek and change the volume.

const PREFS_KEY = "98ish.mediaPlayer"
const DEFAULT_PREFS = { volume: 80, muted: false, viz: "spectrum", playlist: true, shuffle: false, repeat: false }
const BARS = 28

const loadPrefs = () => {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY)) }
  } catch {
    return DEFAULT_PREFS
  }
}

const durations = new Map()
export const durationOf = (song) => {
  if (!durations.has(song.id)) durations.set(song.id, compile(song).duration)
  return durations.get(song.id)
}

export const formatTime = (seconds) => {
  const s = Math.max(0, Math.floor(seconds || 0))
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
}

// volume slider (0-100) -> gain, on a curve that sounds even
const gainFor = (volume) => Math.pow(volume / 100, 2)

const STATUS_TEXT = { playing: "Playing", paused: "Paused", stopped: "Stopped", ready: "Ready" }

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

// File > Open...: the songs in C:\My Music
const OpenDialog = ({ onOpen, onCancel }) => {
  useFsVersion()
  const dir = fs.resolve(["C:", "My Music"])
  const files = dir?.isDirectory ? dir.content.filter((f) => f.type === "music") : []
  const fromDrive = files.map((f) => ({ name: f.name, song: findSong(f.textContent) || findSong(f.name) })).filter((x) => x.song)
  const items = fromDrive.length ? fromDrive : SONGS.map((s) => ({ name: s.file, song: s }))
  const [selected, setSelected] = useState(0)
  const pick = items[selected]

  return (
    <Dialog title="Open" okLabel="Open" onOk={() => pick && onOpen(pick.song)} onCancel={onCancel} okDisabled={!pick}>
      <div className="mpOpenLook">
        Look in:
        <span className="mpOpenFolder">
          <img src="/assets/directory_folder.png" alt="" /> My Music
        </span>
      </div>
      <ul className="mpOpenList" role="listbox" aria-label="Songs">
        {items.map((item, i) => (
          <li
            key={item.name}
            role="option"
            aria-selected={i === selected}
            className={i === selected ? "is-selected" : ""}
            onClick={() => setSelected(i)}
            onDoubleClick={() => onOpen(item.song)}
          >
            <img src="/assets/program_icons/midi.svg" alt="" />
            {item.name}
          </li>
        ))}
      </ul>
      <div className="mpOpenName">
        File name: <span>{pick?.name || ""}</span>
      </div>
    </Dialog>
  )
}

const MediaPlayer = ({ song: initialSong = null, windowIndex, onTitle, onClose }) => {
  const [prefs, setPrefsState] = useState(loadPrefs)
  const system = useSettings() // the taskbar's master volume
  const [current, setCurrent] = useState(() => findSong(initialSong) || SONGS[0])
  const [status, setStatus] = useState("ready") // ready | playing | paused | stopped
  const [position, setPosition] = useState(0)
  const [scrub, setScrub] = useState(null) // seek bar value while it's being dragged
  const [waiting, setWaiting] = useState(false) // playing, but the browser hasn't let audio start
  const [unsupported, setUnsupported] = useState(false)
  const [dialog, setDialog] = useState(null) // "open" | "about"
  const [selected, setSelected] = useState(null)
  const openGesture = useOpenGesture()
  const engineRef = useRef(null)
  const rootRef = useRef(null)
  const canvasRef = useRef(null)
  const latest = useRef({})

  const duration = durationOf(current)
  const playing = status === "playing"

  const setPrefs = (patch) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next))
      } catch {}
      return next
    })

  // ---- transport ----

  const load = (song, autoplay) => {
    const e = engineRef.current
    setCurrent(song)
    setPosition(0)
    setScrub(null)
    if (!e) return
    e.load(song)
    if (autoplay) {
      e.play()
      setStatus("playing")
    } else setStatus("stopped")
  }

  const play = () => {
    unlockAudio() // inside the click/tap: iOS only starts audio during a gesture
    const e = engineRef.current
    if (!e) return
    e.play()
    setStatus("playing")
  }

  const pause = () => {
    engineRef.current?.pause()
    setPosition(engineRef.current?.position || 0)
    setStatus("paused")
  }

  const togglePlay = () => (playing ? pause() : play())

  const stop = () => {
    engineRef.current?.stop()
    setPosition(0)
    setStatus("stopped")
  }

  const seek = (seconds) => {
    const e = engineRef.current
    if (!e) return
    const to = Math.min(Math.max(0, seconds), e.duration - 0.25)
    e.seek(to)
    setPosition(to)
  }

  // the song after (dir 1) or before (dir -1) this one; null when the playlist runs out
  const neighbor = (dir, auto = false) => {
    const { shuffle, repeat } = latest.current.prefs
    const i = SONGS.indexOf(latest.current.current)
    if (shuffle && SONGS.length > 1) {
      let j = i
      while (j === i) j = Math.floor(Math.random() * SONGS.length)
      return SONGS[j]
    }
    const j = i + dir
    if (j >= SONGS.length) return repeat || !auto ? SONGS[0] : null
    if (j < 0) return SONGS[SONGS.length - 1]
    return SONGS[j]
  }

  const next = () => {
    unlockAudio()
    load(neighbor(1), latest.current.status === "playing")
  }

  const prev = () => {
    unlockAudio()
    const e = engineRef.current
    if (e && e.position > 3) return seek(0)
    load(neighbor(-1), latest.current.status === "playing")
  }

  const choose = (song) => {
    unlockAudio()
    load(song, true)
  }

  // a song finished: on to the next one, or stop at the end of the playlist
  const ended = () => {
    unlock("full-song")
    const after = neighbor(1, true)
    if (after) load(after, true)
    else {
      engineRef.current?.stop()
      setPosition(0)
      setStatus("stopped")
    }
  }

  latest.current = { prefs, current, status, ended, togglePlay, play, pause, stop, next, prev, choose }

  // ---- the engine lives as long as the window ----

  useEffect(() => {
    const e = createEngine({
      onEnd: () => latest.current.ended(),
      // another player started and paused this one
      onState: () => {
        const eng = engineRef.current
        if (eng && !eng.playing && latest.current.status === "playing") {
          setStatus("paused")
          setPosition(eng.position)
        }
      },
    })
    engineRef.current = e
    if (!e) {
      setUnsupported(true)
      return
    }
    // test hook (dev server only): the sound tests compare what plays with the score
    if (import.meta.env.DEV) window.__mediaPlayer = e
    const { prefs: p, current: song } = latest.current
    e.setVolume(gainFor(p.volume) * masterGain())
    e.setMuted(p.muted)
    e.load(song)
    if (findSong(initialSong)) {
      e.play()
      setStatus("playing")
    }
    const unregister = registerPlayer({ index: windowIndex, play: (key) => {
      const s = findSong(key)
      if (s) latest.current.choose(s)
    } })
    rootRef.current?.focus({ preventScroll: true })
    return () => {
      unregister()
      e.destroy()
      engineRef.current = null
      if (import.meta.env.DEV && window.__mediaPlayer === e) delete window.__mediaPlayer
      if ("mediaSession" in navigator) {
        try {
          navigator.mediaSession.metadata = null
          for (const a of ["play", "pause", "stop", "previoustrack", "nexttrack"]) navigator.mediaSession.setActionHandler(a, null)
        } catch {}
      }
    }
  }, [])

  useEffect(() => {
    engineRef.current?.setVolume(gainFor(prefs.volume) * masterGain())
    engineRef.current?.setMuted(prefs.muted)
  }, [prefs.volume, prefs.muted, system.volume, system.muted])

  useEffect(() => onTitle?.(`${current.file} - Media Player`), [current])

  // keep the playing song's row in view (by hand: scrollIntoView would also scroll the window)
  useEffect(() => {
    const list = rootRef.current?.querySelector(".mpPlaylist")
    const row = list?.querySelector(`.mpRow[data-song="${current.id}"]`)
    if (!row) return
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight
  }, [current, prefs.playlist])

  // the clock and seek bar while playing
  useEffect(() => {
    if (!playing) return
    const tick = () => {
      const e = engineRef.current
      if (!e) return
      setPosition(e.position)
      setWaiting(e.suspended)
    }
    tick()
    const id = setInterval(tick, 200)
    return () => clearInterval(id)
  }, [playing, current])

  // lock screen / headset controls where the browser has them
  useEffect(() => {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: current.title, artist: current.artist, album: "98ish" })
      navigator.mediaSession.playbackState = playing ? "playing" : status === "paused" ? "paused" : "none"
      const on = (action, fn) => navigator.mediaSession.setActionHandler(action, fn)
      on("play", () => latest.current.play())
      on("pause", () => latest.current.pause())
      on("stop", () => latest.current.stop())
      on("previoustrack", () => latest.current.prev())
      on("nexttrack", () => latest.current.next())
    } catch {}
  }, [current, status])

  // ---- visualization (and a level meter on the root, for tests) ----

  useEffect(() => {
    let raf = 0
    let wave = null
    let freq = null
    const peaks = new Float32Array(BARS)
    const levels = new Float32Array(BARS)
    let scopeGain = 1

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const e = engineRef.current
      const root = rootRef.current
      const canvas = canvasRef.current
      if (!e || !root) return
      const an = e.analyser
      if (!wave || wave.length !== an.fftSize) {
        wave = new Uint8Array(an.fftSize)
        freq = new Uint8Array(an.frequencyBinCount)
      }
      an.getByteTimeDomainData(wave)
      let sum = 0
      let peak = 0
      for (let i = 0; i < wave.length; i++) {
        const v = (wave[i] - 128) / 128
        sum += v * v
        peak = Math.max(peak, Math.abs(v))
      }
      root.dataset.level = Math.sqrt(sum / wave.length).toFixed(4)
      // the scope zooms in on quiet passages, slowly, like an auto-ranging meter
      scopeGain += (Math.min(5, Math.max(1, 0.8 / Math.max(peak, 0.03))) - scopeGain) * 0.04

      if (!canvas || !canvas.offsetWidth) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = Math.round(canvas.offsetWidth * dpr)
      const h = Math.round(canvas.offsetHeight * dpr)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      const g = canvas.getContext("2d")
      g.fillStyle = "#000"
      g.fillRect(0, 0, w, h)

      if (latest.current.prefs.viz === "scope") {
        // faint graticule, then the trace
        g.strokeStyle = "#0b3a1a"
        g.lineWidth = 1
        g.beginPath()
        for (let i = 1; i < 8; i++) {
          const x = Math.round((w * i) / 8) + 0.5
          g.moveTo(x, 0)
          g.lineTo(x, h)
        }
        for (let i = 1; i < 4; i++) {
          const y = Math.round((h * i) / 4) + 0.5
          g.moveTo(0, y)
          g.lineTo(w, y)
        }
        g.stroke()
        // start on a rising zero crossing so the trace stands still
        let start = 0
        for (let i = 1; i < wave.length / 2; i++) {
          if (wave[i - 1] < 128 && wave[i] >= 128) {
            start = i
            break
          }
        }
        const span = Math.min(wave.length - start, Math.floor(wave.length / 2))
        g.strokeStyle = "#3dff7a"
        g.shadowColor = "#3dff7a"
        g.shadowBlur = 6 * dpr
        g.lineWidth = 2 * dpr
        g.beginPath()
        for (let i = 0; i < span; i++) {
          const x = (i / (span - 1)) * w
          const v = Math.max(-1, Math.min(1, ((wave[start + i] - 128) / 128) * scopeGain))
          const y = h / 2 - v * (h * 0.45)
          if (i) g.lineTo(x, y)
          else g.moveTo(x, y)
        }
        g.stroke()
        g.shadowBlur = 0
        return
      }

      // spectrum: LED columns on a log frequency scale with falling peak caps
      an.getByteFrequencyData(freq)
      const binHz = an.context.sampleRate / an.fftSize
      const lo = Math.log(40)
      const hi = Math.log(15000)
      const gap = Math.max(1, Math.round(2 * dpr))
      const barW = (w - gap * (BARS + 1)) / BARS
      const seg = Math.max(2, Math.round(3 * dpr))
      const rows = Math.max(4, Math.floor((h - gap * 2) / (seg + gap)))
      for (let b = 0; b < BARS; b++) {
        const f0 = Math.exp(lo + ((hi - lo) * b) / BARS)
        const f1 = Math.exp(lo + ((hi - lo) * (b + 1)) / BARS)
        const i0 = Math.max(1, Math.floor(f0 / binHz))
        const i1 = Math.max(i0 + 1, Math.ceil(f1 / binHz))
        let m = 0
        for (let i = i0; i < i1 && i < freq.length; i++) m = Math.max(m, freq[i])
        // tilt up the highs a little, the way the eye expects
        const v = Math.min(1, (m / 255) * (0.85 + (0.35 * b) / BARS))
        levels[b] = Math.max(v, levels[b] * 0.82)
        peaks[b] = Math.max(levels[b], peaks[b] - 0.012)
        const lit = Math.round(levels[b] * rows)
        const peakRow = Math.min(rows - 1, Math.round(peaks[b] * rows))
        const x = gap + b * (barW + gap)
        for (let r = 0; r < rows; r++) {
          const y = h - gap - (r + 1) * (seg + gap) + gap
          const t = r / rows
          if (r < lit) g.fillStyle = t > 0.82 ? "#ff3b30" : t > 0.6 ? "#ffd700" : "#2ee84a"
          else if (r === peakRow && peaks[b] > 0.02) g.fillStyle = "#c8fff0"
          else g.fillStyle = t > 0.82 ? "#2a0b0b" : t > 0.6 ? "#2a2608" : "#0b2410"
          g.fillRect(Math.round(x), y, Math.max(1, Math.round(barW)), seg)
        }
      }
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [])

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
      seek((engineRef.current?.position || 0) + (e.key === "ArrowLeft" ? -5 : 5))
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (tag === "INPUT") return
      e.preventDefault()
      setPrefs({ volume: Math.min(100, Math.max(0, prefs.volume + (e.key === "ArrowUp" ? 5 : -5))), muted: false })
    }
  }

  // ---- menus ----

  const menus = [
    {
      label: "File",
      items: [{ label: "Open...", onClick: () => setDialog("open") }, "-", { label: "Exit", onClick: () => onClose?.() }],
    },
    {
      label: "View",
      items: [
        { label: "Spectrum Analyzer", checked: prefs.viz === "spectrum", onClick: () => setPrefs({ viz: "spectrum" }) },
        { label: "Oscilloscope", checked: prefs.viz === "scope", onClick: () => setPrefs({ viz: "scope" }) },
        "-",
        { label: "Playlist", checked: prefs.playlist, onClick: () => setPrefs({ playlist: !prefs.playlist }) },
      ],
    },
    {
      label: "Play",
      items: [
        { label: playing ? "Pause" : "Play", onClick: togglePlay },
        { label: "Stop", onClick: stop, disabled: status === "stopped" || status === "ready" },
        "-",
        { label: "Previous", onClick: prev },
        { label: "Next", onClick: next },
        "-",
        { label: "Shuffle", checked: prefs.shuffle, onClick: () => setPrefs({ shuffle: !prefs.shuffle }) },
        { label: "Repeat", checked: prefs.repeat, onClick: () => setPrefs({ repeat: !prefs.repeat }) },
        "-",
        { label: "Mute", checked: prefs.muted, onClick: () => setPrefs({ muted: !prefs.muted }) },
      ],
    },
    {
      label: "Help",
      items: [helpItem({ program: "Media Player" }), "-", { label: "About Media Player...", onClick: () => setDialog("about") }],
    },
  ]

  const shown = scrub ?? position
  const stateText = waiting && playing ? "Waiting for audio - press Play" : STATUS_TEXT[status]

  return (
    <div
      className="mpRoot"
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-state={status}
      data-song={current.id}
      data-level="0"
    >
      <MenuBar menus={menus} />

      <div
        className="mpDisplay"
        title="Click to change the visualization"
        onClick={() => setPrefs({ viz: prefs.viz === "spectrum" ? "scope" : "spectrum" })}
      >
        <canvas ref={canvasRef} className="mpCanvas" />
        {unsupported && <div className="mpDisplayNote">This browser can't play sound.</div>}
        {!unsupported && status === "ready" && (
          <div className="mpDisplayNote">
            <span className="mpLogo">98ish Media Player</span>
            <span>Press Play</span>
          </div>
        )}
      </div>

      <div className="mpSeek">
        <input
          type="range"
          aria-label="Seek"
          min={0}
          max={Math.max(1, Math.floor(duration))}
          step={0.1}
          value={Math.min(shown, duration)}
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
          <Btn label="Play" onClick={play} on={playing}>
            <PlayGlyph />
          </Btn>
          <Btn label="Pause" onClick={pause} on={status === "paused"} disabled={!playing && status !== "paused"}>
            <PauseGlyph />
          </Btn>
          <Btn label="Stop" onClick={stop} disabled={status === "stopped" || status === "ready"}>
            <StopGlyph />
          </Btn>
          <span className="mpSep" />
          <Btn label="Previous" onClick={prev}>
            <PrevGlyph />
          </Btn>
          <Btn label="Next" onClick={next}>
            <NextGlyph />
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
          <input
            type="range"
            aria-label="Volume"
            min={0}
            max={100}
            value={prefs.muted ? 0 : prefs.volume}
            onChange={(e) => setPrefs({ volume: Number(e.target.value), muted: false })}
          />
        </div>
      </div>

      <div className="mpInfo">
        <dl>
          <dt>Show:</dt>
          <dd className="mpTitle">{current.title}</dd>
          <dt>Clip:</dt>
          <dd>{current.file}</dd>
          <dt>Author:</dt>
          <dd>{current.artist}</dd>
        </dl>
        <div className="mpTime" aria-label="Time">
          <span className="mpElapsed">{formatTime(shown)}</span>
          <span className="mpTotal">/ {formatTime(duration)}</span>
        </div>
      </div>

      {prefs.playlist && (
        <div className="mpPlaylist" role="listbox" aria-label="Playlist">
          {SONGS.map((song, i) => (
            <div
              key={song.id}
              role="option"
              aria-selected={selected === song.id}
              className={`mpRow ${selected === song.id ? "is-selected" : ""} ${song === current ? "is-current" : ""}`}
              data-song={song.id}
              onPointerDown={() => setSelected(song.id)}
              {...openGesture(() => choose(song))}
            >
              <span className="mpRowMark">{song === current ? (playing ? "\u25B6\uFE0E" : "\u25A0") : i + 1}</span>
              <span className="mpRowTitle">{song.title}</span>
              <span className="mpRowFile">{song.file}</span>
              <span className="mpRowTime">{formatTime(durationOf(song))}</span>
            </div>
          ))}
        </div>
      )}

      <div className="status-bar mpStatus">
        <p className="status-bar-field mpStatusState">{stateText}</p>
        <p className="status-bar-field mpStatusSong">{current.file}</p>
        <p className="status-bar-field mpStatusTime">
          {formatTime(shown)} / {formatTime(duration)}
        </p>
      </div>

      {dialog === "open" && (
        <OpenDialog
          onCancel={() => setDialog(null)}
          onOpen={(song) => {
            setDialog(null)
            choose(song)
          }}
        />
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
              <p className="dialogText">
                Every song is an original composition, played by a little synthesizer built on the Web Audio API. No
                sound files were harmed.
              </p>
              <p className="dialogText">{SONGS.length} songs in C:\My Music</p>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}

export default MediaPlayer
