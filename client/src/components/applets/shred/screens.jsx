import React, { useEffect, useMemo, useRef, useState } from "react"
import { TIERS, SONGS } from "./songs/index.js"
import { DIFFICULTIES, DIFF, chartStats, sectionsOf } from "./chart.js"
import { bestOf, songStars, starsToUnlock, tableOf, tierUnlocked, totalStars, DEFAULT_PREFS } from "./progress.js"
import { calibrate, CAL_RANGE } from "./timing.js"
import { PAD } from "./pad.js"

// Shred 98's menus: drawn in HTML over the stage, styled like a late-90s rock game. Every
// screen can be driven by the mouse, a touch, the keyboard (arrows, Enter, Escape) or a
// guitar controller (strum to move, green to pick, red to go back): Shred.jsx routes
// "up/down/left/right/ok/back" here through each screen's `nav` handler.

export const LANE_CSS = ["#2bd94f", "#ff3341", "#ffd21f", "#2a8cff", "#ff8a1a"]
export const DIFF_LABEL = Object.fromEntries(DIFFICULTIES.map((d) => [d, DIFF[d].label]))

const noFocus = (e) => e.preventDefault() // menu buttons never steal focus from the stage

export const Stars = ({ n, max = 5, size = "md", animate = false }) => (
  <span className={`shStars shStars--${size}${animate ? " is-animated" : ""}`} aria-label={`${n} of ${max} stars`}>
    {Array.from({ length: max }, (_, i) => (
      <span key={i} className={i < n ? "on" : ""} style={animate ? { animationDelay: `${0.35 + i * 0.28}s` } : undefined}>
        ★
      </span>
    ))}
  </span>
)

const Dots = ({ n, max = 6 }) => (
  <span className="shDots" aria-label={`intensity ${n} of ${max}`}>
    {Array.from({ length: max }, (_, i) => (
      <i key={i} className={i < n ? "on" : ""} />
    ))}
  </span>
)

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`
export const fmtScore = (n) => Math.round(n).toLocaleString("en-US")

// keyboard keys as people say them
export const keyName = (code) => {
  if (!code) return "-"
  if (code.startsWith("Key")) return code.slice(3)
  if (code.startsWith("Digit")) return code.slice(5)
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`
  if (code.startsWith("Arrow")) return code.slice(5)
  return { ShiftLeft: "L Shift", ShiftRight: "R Shift", ControlLeft: "L Ctrl", ControlRight: "R Ctrl", AltLeft: "L Alt", AltRight: "R Alt", Space: "Space", Backspace: "Bksp", Escape: "Esc" }[code] || code
}

// A vertical menu with a selection that moves with arrows / strums
const useMenu = (count, initial = 0) => {
  const [sel, setSel] = useState(initial)
  const move = (d) => setSel((s) => (s + d + count) % count)
  return [Math.min(sel, count - 1), setSel, move]
}

export const Panel = ({ title, children, className = "", onBack, wide }) => (
  <div className={`shPanel ${wide ? "shPanel--wide" : ""} ${className}`}>
    {title && (
      <div className="shPanelHead">
        {onBack && (
          <button type="button" className="shBack" tabIndex={-1} onMouseDown={noFocus} onClick={onBack} aria-label="Back">
            ◀
          </button>
        )}
        <h2>{title}</h2>
      </div>
    )}
    {children}
  </div>
)

export const Logo = ({ small }) => (
  <div className={small ? "shLogo is-small" : "shLogo"} aria-label="Shred 98">
    <span className="shLogoWord">SHRED</span>
    <span className="shLogoNum">98</span>
    {!small && <span className="shLogoTag">The Ultimate Six-String Simulator</span>}
  </div>
)

// ---------- title ----------

export const TitleScreen = ({ items, navRef, stars, maxStars, sel, setSel }) => {
  const move = (d) => setSel((s) => (s + d + items.length) % items.length)
  navRef.current = (a) => {
    if (a === "up") move(-1)
    else if (a === "down") move(1)
    else if (a === "ok") items[sel].onSelect()
    else return false
    return true
  }
  return (
    <div className="shCenter shTitleScreen">
      <Logo />
      <ul className="shMenu" role="menu">
        {items.map((it, i) => (
          <li key={it.label}>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={i === sel ? "is-sel" : ""}
              onMouseDown={noFocus}
              onMouseEnter={() => setSel(i)}
              onClick={it.onSelect}
            >
              {it.label}
              {it.note && <small>{it.note}</small>}
            </button>
          </li>
        ))}
      </ul>
      <div className="shCareerBar">
        <span>Career stars</span> <b>★ {stars}</b> / {maxStars}
      </div>
    </div>
  )
}

// ---------- the song list (career and practice) ----------

export const SongScreen = ({ mode, progress, prefs, setPrefs, onPlay, onBack, navRef, onPreview, selectedId, setSelectedId }) => {
  const practice = mode === "practice"
  const rows = useMemo(() => {
    const out = []
    for (const tier of TIERS) {
      const open = tierUnlocked(progress, tier, SONGS)
      for (const s of tier.songs) out.push({ song: SONGS.find((x) => x.id === s.id), tier, open })
    }
    return out
  }, [progress])
  const startIndex = Math.max(0, rows.findIndex((r) => r.song.id === selectedId))
  const [sel, setSel] = useState(startIndex)
  const row = rows[sel]
  const song = row.song
  const diff = prefs.difficulty
  const [rate, setRate] = useState(1)
  const [loop, setLoop] = useState(true)
  const sections = useMemo(() => sectionsOf(song), [song])
  const [sectionIdx, setSectionIdx] = useState(-1)
  const best = bestOf(progress, song.id, diff)
  const table = tableOf(progress, song.id, diff)

  useEffect(() => {
    setSelectedId(song.id)
    setSectionIdx(-1)
    if (row.open) onPreview(song)
  }, [song.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const setDiff = (d) => setPrefs({ difficulty: d })
  const shiftDiff = (k) => setDiff(DIFFICULTIES[Math.max(0, Math.min(3, DIFFICULTIES.indexOf(diff) + k))])
  const play = () => {
    if (!row.open) return
    onPlay({ song, difficulty: diff, practice: practice ? { rate, loop: loop && sectionIdx >= 0, section: sectionIdx >= 0 ? sections[sectionIdx] : null } : null })
  }
  navRef.current = (a) => {
    if (a === "up") setSel((s) => (s + rows.length - 1) % rows.length)
    else if (a === "down") setSel((s) => (s + 1) % rows.length)
    else if (a === "left") shiftDiff(-1)
    else if (a === "right") shiftDiff(1)
    else if (a === "ok") play()
    else if (a === "back") onBack()
    else return false
    return true
  }
  const listRef = useRef(null)
  useEffect(() => {
    listRef.current?.querySelector(".is-sel")?.scrollIntoView?.({ block: "nearest" })
  }, [sel])

  const seconds = (song.lengthBeats * 60) / song.bpm
  let lastTier = null
  return (
    <Panel title={practice ? "Practice" : "Set List"} onBack={onBack} wide className="shSongs">
      <div className="shSongsBody">
        <div className="shSongList" ref={listRef} role="listbox" aria-label="Songs">
          {rows.map((r, i) => {
            const header = r.tier !== lastTier
            lastTier = r.tier
            const b = bestOf(progress, r.song.id, diff)
            return (
              <React.Fragment key={r.song.id}>
                {header && (
                  <div className={`shTier ${r.open ? "" : "is-locked"}`}>
                    <span>{r.tier.name}</span>
                    {!r.open && <small>🔒 {starsToUnlock(progress, r.tier, SONGS)} more ★ to unlock</small>}
                  </div>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === sel}
                  tabIndex={-1}
                  className={`shSongRow ${i === sel ? "is-sel" : ""} ${r.open ? "" : "is-locked"}`}
                  onMouseDown={noFocus}
                  onClick={() => (i === sel ? play() : setSel(i))}
                  data-song={r.song.id}
                >
                  <span className="shSongName">
                    {r.open ? r.song.title : "Locked"}
                    <small>{r.open ? r.song.artist : `Earn ${r.tier.stars} stars`}</small>
                  </span>
                  <span className="shSongMeta">
                    {r.open ? <Stars n={songStars(progress, r.song.id)} size="sm" /> : <span className="shLock">🔒</span>}
                    {r.open && b && <small>{fmtScore(b.score)}</small>}
                  </span>
                </button>
              </React.Fragment>
            )
          })}
        </div>
        <div className="shSongInfo">
          {row.open ? (
            <>
              <div className="shSongTitle">{song.title}</div>
              <div className="shSongArtist">{song.artist}</div>
              <div className="shSongTags">
                <span>{song.genre}</span>
                <span>{song.bpm} BPM</span>
                <span>{fmtTime(seconds)}</span>
              </div>
              <div className="shDiffs" role="radiogroup" aria-label="Difficulty">
                {DIFFICULTIES.map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={d === diff}
                    tabIndex={-1}
                    className={d === diff ? "is-sel" : ""}
                    onMouseDown={noFocus}
                    onClick={() => setDiff(d)}
                  >
                    <b>{DIFF[d].label}</b>
                    <Dots n={chartStats(song, d).rating} />
                    <Stars n={progress.songs?.[song.id]?.[d]?.bestStars || 0} size="xs" />
                  </button>
                ))}
              </div>
              {practice ? (
                <div className="shPractice">
                  <label>
                    Section
                    <select value={sectionIdx} onChange={(e) => setSectionIdx(Number(e.target.value))}>
                      <option value={-1}>Whole song</option>
                      {sections.map((s, i) => (
                        <option key={i} value={i}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="shSeg" role="radiogroup" aria-label="Speed">
                    {[0.5, 0.75, 1].map((r) => (
                      <button key={r} type="button" tabIndex={-1} role="radio" aria-checked={rate === r} className={rate === r ? "is-sel" : ""} onMouseDown={noFocus} onClick={() => setRate(r)}>
                        {r * 100}%
                      </button>
                    ))}
                  </div>
                  <label className="shCheck">
                    <input type="checkbox" checked={loop} disabled={sectionIdx < 0} onChange={(e) => setLoop(e.target.checked)} /> Loop the section
                  </label>
                  <p className="shHint">Practice never fails you and doesn't count toward your career.</p>
                </div>
              ) : (
                <div className="shScores">
                  <div className="shScoresHead">
                    <span>Top scores &middot; {DIFF[diff].label}</span>
                    {best && <Stars n={best.stars} size="sm" />}
                  </div>
                  {table.length ? (
                    <ol>
                      {table.map((e, i) => (
                        <li key={i}>
                          <span>{fmtScore(e.score)}</span>
                          <Stars n={e.stars} size="xs" />
                          <small>{e.fullCombo ? "FC" : `${e.accuracy}%`}</small>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="shHint">No scores yet. Be the first!</p>
                  )}
                </div>
              )}
              <button type="button" className="shBig" tabIndex={-1} onMouseDown={noFocus} onClick={play} data-testid="shred-play">
                {practice ? "Practice!" : "Rock!"}
              </button>
            </>
          ) : (
            <div className="shLocked">
              <div className="shLockBig">🔒</div>
              <p>
                <b>{row.tier.name}</b> opens once you've earned <b>{row.tier.stars} stars</b>.
              </p>
              <p>
                You have <b>★ {totalStars(progress, SONGS)}</b>. Your best star rating on each song counts, on any difficulty.
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="shFoot">
        <span>↑↓ song</span>
        <span>←→ difficulty</span>
        <span>Enter play</span>
        <span>Esc back</span>
      </div>
    </Panel>
  )
}

// ---------- options ----------

const BINDINGS = [
  ...[0, 1, 2, 3, 4].map((lane) => ({ id: `fret${lane}`, label: `${["Green", "Red", "Yellow", "Blue", "Orange"][lane]} fret`, get: (k) => k.frets[lane], set: (k, v) => ({ ...k, frets: k.frets.map((c, i) => (i === lane ? v : c)) }), lane })),
  { id: "strum", label: "Strum", get: (k) => k.strum, set: (k, v) => ({ ...k, strum: v }) },
  { id: "star", label: "Star power", get: (k) => k.star, set: (k, v) => ({ ...k, star: v }) },
  { id: "whammy", label: "Whammy", get: (k) => k.whammy, set: (k, v) => ({ ...k, whammy: v }) },
]

export const OptionsScreen = ({ prefs, setPrefs, onBack, navRef, unlockAll, setUnlockAll, inGame }) => {
  const [binding, setBinding] = useState(null)
  navRef.current = (a) => {
    if (binding) return true
    if (a === "back") onBack()
    else return false
    return true
  }
  useEffect(() => {
    if (!binding) return
    const onKey = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === "Escape") return setBinding(null)
      const b = BINDINGS.find((x) => x.id === binding)
      // a key can only do one thing: take it off anything else first
      let keys = prefs.keys
      for (const other of BINDINGS) keys = other.set(keys, other.get(keys).filter((c) => c !== e.code))
      keys = b.set(keys, [e.code, ...b.get(keys).filter((c) => c !== e.code)].slice(0, 3))
      setPrefs({ keys })
      setBinding(null)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [binding, prefs.keys]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key, label, hint) => (
    <label className="shCheck">
      <input type="checkbox" checked={!!prefs[key]} onChange={(e) => setPrefs({ [key]: e.target.checked })} />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
  return (
    <Panel title="Options" onBack={onBack} wide className="shOptions">
      <div className="shOptionsBody">
        <section>
          <h3>Gameplay</h3>
          {toggle("easyStrum", "Easy strum", "Pressing a fret plays the note. No strum key needed.")}
          {toggle("noFail", "No-Fail mode", "The crowd can boo, but the song goes on.")}
          {toggle("lefty", "Lefty flip", "Mirror the highway: green on the right.")}
          {toggle("shake", "Screen shake", "Shake the stage when star power kicks in.")}
          <label className="shRange">
            Note speed <b>{prefs.speed}</b>
            <input type="range" min={1} max={5} step={1} value={prefs.speed} onChange={(e) => setPrefs({ speed: Number(e.target.value) })} />
          </label>
          <h3>Sound</h3>
          <label className="shRange">
            Music <b>{Math.round(prefs.music * 100)}%</b>
            <input type="range" min={0} max={1} step={0.05} value={prefs.music} onChange={(e) => setPrefs({ music: Number(e.target.value) })} />
          </label>
          {toggle("sfx", "Crowd and effects")}
          {!inGame && (
            <>
              <h3>Career</h3>
              <label className="shCheck">
                <input type="checkbox" checked={!!unlockAll} onChange={(e) => setUnlockAll(e.target.checked)} />
                <span>
                  Unlock every venue
                  <small>Skip the career and play anything.</small>
                </span>
              </label>
            </>
          )}
        </section>
        <section>
          <h3>Keyboard</h3>
          <table className="shKeys">
            <tbody>
              {BINDINGS.map((b) => (
                <tr key={b.id}>
                  <th>
                    {b.lane !== undefined && <i className="shKeyDot" style={{ background: LANE_CSS[b.lane] }} />}
                    {b.label}
                  </th>
                  <td>{b.get(prefs.keys).map(keyName).join(", ") || "-"}</td>
                  <td>
                    <button type="button" className={binding === b.id ? "is-sel" : ""} onClick={() => setBinding(b.id)}>
                      {binding === b.id ? "Press a key..." : "Set"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="shSmall" onClick={() => setPrefs({ keys: DEFAULT_PREFS.keys })}>
            Reset keys
          </button>
          <h3>Guitar controller / gamepad</h3>
          <p className="shHint">
            Frets: buttons {PAD.frets.join(", ")} (A, B, Y, X, LB). Strum: d-pad up/down. Star power: Back/Select. Whammy: right stick. Pause: Start.
            In menus, strum to move, green to pick, red to go back. Playing on a guitar controller? Turn off Easy strum so notes play when you strum.
          </p>
        </section>
      </div>
    </Panel>
  )
}

// ---------- calibration ----------

const CLICKS = 16
const CLICK_GAP = 0.6

export const CalibrateScreen = ({ audio, cal, setCal, onBack, navRef, touch }) => {
  const [mode, setMode] = useState(null) // null | "audio" | "video"
  const [count, setCount] = useState(0)
  const [result, setResult] = useState(null)
  const [draft, setDraft] = useState(cal)
  const taps = useRef([])
  const beats = useRef([])
  const timer = useRef(null)
  const gemRef = useRef(null)
  const flashRef = useRef(null)

  const stop = () => {
    clearTimeout(timer.current)
    cancelAnimationFrame(timer.current)
    setMode(null)
  }
  useEffect(() => stop, []) // eslint-disable-line react-hooks/exhaustive-deps

  const finish = (which) => {
    const r = calibrate(taps.current, beats.current, { min: which === "audio" ? 8 : 6 })
    setResult(r ? { ...r, which } : { which, failed: true })
    if (r) setDraft((d) => ({ ...d, [which]: r.offset }))
    setMode(null)
  }

  // Audio: clicks on the audio clock; taps are converted to "heard" audio time
  const startAudio = () => {
    audio.unlock()
    taps.current = []
    setResult(null)
    setCount(0)
    const t0 = audio.ctx.currentTime + 0.8
    beats.current = []
    for (let i = 0; i < CLICKS; i++) {
      audio.clickAt(t0 + i * CLICK_GAP, i % 4 === 0)
      beats.current.push((t0 + i * CLICK_GAP) * 1000)
    }
    setMode("audio")
    const tick = () => {
      const heard = audio.contextAt(performance.now())
      const n = beats.current.filter((b) => b <= heard * 1000).length
      setCount(n)
      if (heard * 1000 > beats.current.at(-1) + 500) finish("audio")
      else timer.current = setTimeout(tick, 30)
    }
    audio.sampleClock()
    tick()
  }

  // Video: a silent gem drops onto a line; flashes are timed off the frames shown
  const startVideo = () => {
    taps.current = []
    beats.current = []
    setResult(null)
    setCount(0)
    setMode("video")
    const begin = performance.now() + 900
    const period = 750
    const total = 12
    const frame = (now) => {
      const t = now - begin
      const k = Math.floor(t / period)
      const phase = (t % period) / period
      if (gemRef.current) gemRef.current.style.transform = `translateY(${t < 0 ? -10 : phase * 100}%)`
      if (t >= 0 && k < total) {
        const hitAt = begin + (k + 1) * period
        if (!beats.current.includes(hitAt)) beats.current.push(hitAt)
        if (flashRef.current) flashRef.current.style.opacity = phase > 0.9 || phase < 0.08 ? 1 : 0
        setCount(k)
      }
      if (k >= total) return finish("video")
      timer.current = requestAnimationFrame(frame)
    }
    timer.current = requestAnimationFrame(frame)
  }

  const tap = (e) => {
    if (!mode) return
    const at = e.timeStamp
    if (mode === "audio") taps.current.push(audio.contextAt(at) * 1000)
    else taps.current.push(at)
  }
  // any key is a tap while a test runs
  useEffect(() => {
    if (!mode) return
    const onKey = (e) => {
      if (e.repeat || e.key === "Escape") return
      e.preventDefault()
      e.stopPropagation()
      tap(e)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps
  navRef.current = (a) => {
    if (a === "back") {
      stop()
      onBack()
      return true
    }
    if (a === "tap") return true
    return false
  }

  const nudge = (which, d) => setDraft((x) => ({ ...x, [which]: Math.max(CAL_RANGE[0], Math.min(CAL_RANGE[1], (x[which] || 0) + d)) }))
  const dirty = draft.audio !== cal.audio || draft.video !== cal.video

  return (
    <Panel title="Calibrate Lag" onBack={() => (stop(), onBack())} wide className="shCal">
      <div className="shCalBody" onPointerDown={tap} data-testid="shred-cal-pad">
        <p className="shHint">
          Speakers, Bluetooth headphones and TVs all add delay. Tap along so Shred 98 can line the notes up with what you hear and see.
          {touch ? " Tap anywhere in this box." : " Press any key (or click) in this box."}
        </p>
        <div className="shCalSteps">
          <div className={`shCalStep ${mode === "audio" ? "is-on" : ""}`}>
            <h3>1. Audio</h3>
            <p>Tap on every click you hear.</p>
            <div className="shCalBeat" aria-hidden="true">
              {Array.from({ length: CLICKS }, (_, i) => (
                <i key={i} className={i < count && mode === "audio" ? "on" : ""} />
              ))}
            </div>
            <button type="button" className="shSmall" tabIndex={-1} onMouseDown={noFocus} onClick={startAudio} disabled={!!mode}>
              {mode === "audio" ? "Listening..." : "Start audio test"}
            </button>
            <div className="shCalValue">
              <button type="button" tabIndex={-1} onMouseDown={noFocus} onClick={() => nudge("audio", -5)} aria-label="Less audio delay">
                −
              </button>
              <b>{draft.audio} ms</b>
              <button type="button" tabIndex={-1} onMouseDown={noFocus} onClick={() => nudge("audio", 5)} aria-label="More audio delay">
                +
              </button>
            </div>
          </div>
          <div className={`shCalStep ${mode === "video" ? "is-on" : ""}`}>
            <h3>2. Video</h3>
            <p>Tap when the gem hits the line. (No sound.)</p>
            <div className="shCalLane" aria-hidden="true">
              <div className="shCalGem" ref={gemRef} />
              <div className="shCalLine" ref={flashRef} />
            </div>
            <button type="button" className="shSmall" tabIndex={-1} onMouseDown={noFocus} onClick={startVideo} disabled={!!mode}>
              {mode === "video" ? "Watching..." : "Start video test"}
            </button>
            <div className="shCalValue">
              <button type="button" tabIndex={-1} onMouseDown={noFocus} onClick={() => nudge("video", -5)} aria-label="Less video delay">
                −
              </button>
              <b>{draft.video} ms</b>
              <button type="button" tabIndex={-1} onMouseDown={noFocus} onClick={() => nudge("video", 5)} aria-label="More video delay">
                +
              </button>
            </div>
          </div>
        </div>
        {result && (
          <p className={`shCalResult ${result.failed ? "is-bad" : ""}`} role="status">
            {result.failed
              ? "Not enough taps landed near the beat. Give it another go!"
              : `${result.which === "audio" ? "Audio" : "Video"}: you're ${Math.abs(result.offset)} ms ${result.offset >= 0 ? "behind" : "ahead"} (steady within ±${result.spread} ms).`}
          </p>
        )}
        <div className="shCalButtons">
          <button type="button" className="shBig" tabIndex={-1} onMouseDown={noFocus} disabled={!dirty} onClick={() => setCal(draft)}>
            Save
          </button>
          <button type="button" className="shSmall" tabIndex={-1} onMouseDown={noFocus} onClick={() => setDraft({ audio: 0, video: 0 })}>
            Reset to 0
          </button>
        </div>
      </div>
    </Panel>
  )
}

// ---------- how to play ----------

export const HowToScreen = ({ onBack, navRef, prefs, touch }) => {
  navRef.current = (a) => {
    if (a === "back" || a === "ok") onBack()
    else return false
    return true
  }
  const k = prefs.keys
  return (
    <Panel title="How to Play" onBack={onBack} wide className="shHowTo">
      <div className="shHowBody">
        <section>
          <h3>The highway</h3>
          <p>
            Gems scroll down five lanes toward the frets at the bottom. Play each one as it crosses the line. Hit notes keep the guitar
            playing; miss one and it cuts out until you're back on track.
          </p>
          <div className="shHowFrets" aria-hidden="true">
            {LANE_CSS.map((c, i) => (
              <span key={i} style={{ "--c": c }}>
                <i />
                <b>{touch ? ["Tap", "", "lanes", "", ""][i] : keyName(k.frets[i][0])}</b>
              </span>
            ))}
          </div>
          <h3>Playing</h3>
          {touch ? (
            <p>Tap the lanes at the bottom of the screen. Two fingers for two-note chords. Hold your finger down on long notes, and wiggle it for whammy.</p>
          ) : (
            <p>
              With <b>Easy strum</b> on (it's on to start), pressing a fret plays the note: <b>{k.frets.map((f) => keyName(f[0])).join(" ")}</b>. Turn it off in Options
              for the real thing: hold the frets, then strum with <b>{keyName(k.strum[0])}</b> or <b>{keyName(k.strum[2])}</b>/<b>{keyName(k.strum[3])}</b>.
              Gems with a white top are <b>hammer-ons</b>: no strum needed while your streak is going.
            </p>
          )}
          <p>
            <b>Chords</b> are two or three gems side by side: play them together. <b>Sustains</b> have a tail: hold the fret until the tail ends for bonus
            points.
          </p>
        </section>
        <section>
          <h3>Streaks and the multiplier</h3>
          <p>Every 10 notes in a row bumps your multiplier, up to 4x. Any miss resets it.</p>
          <h3>Star power</h3>
          <p>
            Glowing star-shaped gems are a <b>star power phrase</b>. Hit every one to charge your meter. With half a meter, unleash it
            {touch ? " with the ⚡ button" : <> with <b>{keyName(k.star[0])}</b></>} to double your multiplier and win over the crowd. Whammy a star power
            sustain for extra charge.
          </p>
          <h3>The rock meter</h3>
          <p>Hits push it toward green; misses and wrong notes push it toward red. Bottom out and you're booed off stage. (Unless No-Fail is on.)</p>
          <h3>Career</h3>
          <p>Finish songs to earn 1 to 5 stars. Stars open new venues. Your best on any difficulty counts.</p>
          <p className="shHint">
            Timing feel off? Try <b>Calibrate Lag</b>. Pause anytime with {touch ? "the pause button" : <b>Esc</b>}.
          </p>
        </section>
      </div>
    </Panel>
  )
}

// ---------- pause, results, failed ----------

export const PauseScreen = ({ items, navRef, practice }) => {
  const [sel, setSel, move] = useMenu(items.length)
  navRef.current = (a) => {
    if (a === "up") move(-1)
    else if (a === "down") move(1)
    else if (a === "ok") items[sel].onSelect()
    else if (a === "back") items[0].onSelect()
    else return false
    return true
  }
  return (
    <div className="shCenter shDim">
      <Panel title={practice ? "Practice Paused" : "Paused"} className="shPause">
        <ul className="shMenu shMenu--small" role="menu">
          {items.map((it, i) => (
            <li key={it.label}>
              <button type="button" role="menuitem" tabIndex={-1} className={i === sel ? "is-sel" : ""} onMouseDown={noFocus} onMouseEnter={() => setSel(i)} onClick={it.onSelect}>
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}

const CountUp = ({ value, ms = 1400 }) => {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const start = performance.now()
    let raf = 0
    const step = (now) => {
      const k = Math.min(1, (now - start) / ms)
      setShown(value * (1 - Math.pow(1 - k, 3)))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return <>{fmtScore(shown)}</>
}

export const ResultsScreen = ({ data, items, navRef }) => {
  const { results: r, song, difficulty, newBest, unlockedTier, practice } = data
  const [sel, setSel, move] = useMenu(items.length)
  navRef.current = (a) => {
    if (a === "up" || a === "left") move(-1)
    else if (a === "down" || a === "right") move(1)
    else if (a === "ok") items[sel].onSelect()
    else if (a === "back") items[0].onSelect() // Escape continues
    else return false
    return true
  }
  const headline = practice ? "Practice Complete" : r.fullCombo ? "Full Combo!" : r.stars >= 5 ? "Legendary!" : r.stars >= 4 ? "You Rock!" : "Song Complete"
  return (
    <div className="shCenter shDim">
      <Panel className="shResults">
        <div className="shResultsHead">
          <div className="shHeadline">{headline}</div>
          <div className="shResultsSong">
            {song.title} &middot; {DIFF_LABEL[difficulty]}
            {practice?.rate && practice.rate !== 1 ? ` · ${practice.rate * 100}% speed` : ""}
          </div>
        </div>
        {!practice && <Stars n={r.stars} size="lg" animate />}
        <div className="shResultsScore" data-testid="shred-score">
          <CountUp value={r.score} />
          {newBest && <span className="shNewBest">New best!</span>}
        </div>
        <div className="shResultsGrid">
          <div>
            <b>{r.accuracy}%</b>
            <span>notes hit</span>
          </div>
          <div>
            <b>
              {r.hit}/{r.total}
            </b>
            <span>notes</span>
          </div>
          <div>
            <b>{r.longest}</b>
            <span>best streak</span>
          </div>
        </div>
        <div className="shBreakdown">
          <span className="p">Perfect {r.counts.perfect}</span>
          <span className="g">Great {r.counts.great}</span>
          <span className="o">Good {r.counts.good}</span>
          <span className="m">Missed {r.counts.miss}</span>
          {r.counts.wrong > 0 && <span className="w">Wrong {r.counts.wrong}</span>}
        </div>
        {unlockedTier && <div className="shUnlocked">Unlocked: {unlockedTier}!</div>}
        <div className="shResultButtons">
          {items.map((it, i) => (
            <button key={it.label} type="button" tabIndex={-1} className={`shBig ${i === sel ? "is-sel" : ""}`} onMouseDown={noFocus} onMouseEnter={() => setSel(i)} onClick={it.onSelect}>
              {it.label}
            </button>
          ))}
        </div>
      </Panel>
    </div>
  )
}

export const FailedScreen = ({ data, items, navRef }) => {
  const [sel, setSel, move] = useMenu(items.length)
  navRef.current = (a) => {
    if (a === "up" || a === "left") move(-1)
    else if (a === "down" || a === "right") move(1)
    else if (a === "ok") items[sel].onSelect()
    else if (a === "back") items.at(-1).onSelect()
    else return false
    return true
  }
  return (
    <div className="shCenter shDim shDim--red">
      <Panel className="shResults shFailed">
        <div className="shHeadline is-bad">Song Failed</div>
        <div className="shResultsSong">
          {data.song.title} &middot; {DIFF_LABEL[data.difficulty]}
        </div>
        <div className="shFailBar" aria-label={`${Math.round(data.results.progress * 100)}% of the song`}>
          <i style={{ width: `${Math.round(data.results.progress * 100)}%` }} />
          <span>{Math.round(data.results.progress * 100)}% through the song</span>
        </div>
        <p className="shHint">The crowd booed you off. Try Practice mode, an easier difficulty, or No-Fail in Options.</p>
        <div className="shResultButtons">
          {items.map((it, i) => (
            <button key={it.label} type="button" tabIndex={-1} className={`shBig ${i === sel ? "is-sel" : ""}`} onMouseDown={noFocus} onMouseEnter={() => setSel(i)} onClick={it.onSelect}>
              {it.label}
            </button>
          ))}
        </div>
      </Panel>
    </div>
  )
}
