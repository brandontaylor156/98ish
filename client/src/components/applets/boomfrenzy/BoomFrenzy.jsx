import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import GameStart from "../../shared/GameStart"
import Dialog from "../../shared/Dialog"
import { Check, HowToDialog, PausedPanel, QuickGameRoot, ScoresDialog, TitleScreen, useAutoPause, useGameLoop } from "../../shared/quickgame"
import { unlock } from "../../../utils/achievements"
import { helpItem } from "../../../utils/help"
import { createScores, fmtNum } from "../../../utils/gameKit"
import * as E from "./engine"
import * as S from "./sort"
import { Bomb, Boom, Heart, Mallet, WEAPON_ICONS } from "./art"
import { createSounds } from "./sounds"
import "./BoomFrenzy.css"

// Boom Frenzy: whack the bombs before their fuses burn down (after Bomb Panic, Orangenose
// Studios' 2012 iPhone game; the research and what's inferred: docs/games-new.md). 15 kinds
// of bomb, Panic Time, 3 weapons, 20 stages, Endless, and Sort Rush (drag colored bombs into
// their pens). Rules in engine.js and sort.js; this file draws them and reads fingers, the
// mouse and keys.

const ICON = "/assets/program_icons/boomfrenzy.svg"
const store = createScores("98ish.boomfrenzy", { defaults: { sound: true, tips: true } })
const MODE_LABEL = { stage: "Stages", endless: "Endless", sort: "Sort Rush" }
// keys for the holes: the number pad's layout, or three rows of letters
const HOLE_KEYS = { 7: 0, 8: 1, 9: 2, 4: 3, 5: 4, 6: 5, 1: 6, 2: 7, 3: 8, q: 0, w: 1, e: 2, a: 3, s: 4, d: 5, z: 6, x: 7, c: 8 }
const ARROW_KEYS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" }
const WEAPON_KEYS = { j: "mallet", k: "freeze", l: "snip", "!": "mallet", "@": "freeze", "#": "snip" }
const SWIPE_PX = 22

const dirOf = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up")

const BoomFrenzy = ({ mobile = false, paused = false, onClose }) => {
  const chatItem = useGameChatMenuItem("boomfrenzy")
  const rootRef = useRef(null)
  const fieldRef = useRef(null)
  const sounds = useMemo(() => createSounds(), [])
  const [data, setData] = useState(store.load)
  const prefs = data.prefs
  const unlocked = data.extra.unlocked || 1
  const stars = data.extra.stars || {}
  const [screen, setScreen] = useState("title") // title | play
  const gameRef = useRef(null)
  const [, setFrame] = useState(0)
  const [hold, setHold] = useState(false) // paused
  const [intro, setIntro] = useState(null) // a new bomb's card before the stage starts
  const [over, setOver] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [last, setLast] = useState(null) // the last result, for the title screen
  const [side, setSide] = useState(300)
  const [cellSize, setCellSize] = useState({ cw: 100, ch: 100 })
  const fx = useRef([])
  const fxId = useRef(0)
  const pointers = useRef(new Map())
  const selected = useRef(-1) // the hole a key picked (for an Arrow bomb's direction)
  const heldKeys = useRef(new Map())
  const g = gameRef.current

  useEffect(() => {
    sounds.setEnabled(prefs.sound)
  }, [prefs.sound])
  const setPref = (patch) => setData(store.setPrefs(patch))

  const running = screen === "play" && !!g && !g.over && !hold && !intro && !dialog
  useAutoPause(paused, () => {
    if (screen === "play" && gameRef.current && !gameRef.current.over) setHold(true)
  })

  // ---- sizing: Sort Rush's yard is the biggest square that fits; the holes' cells may be a
  // little taller (an upright phone) or wider (landscape) than square, to use the space ----
  useLayoutEffect(() => {
    const el = fieldRef.current
    if (!el) return
    const fit = () => {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return
      const w = r.width - 8
      const h = r.height - 8
      let cw = Math.floor(w / 3)
      let ch = Math.floor(h / 3)
      ch = Math.min(ch, Math.floor(cw * 1.35))
      cw = Math.min(cw, Math.floor(ch * 1.35))
      setSide(Math.floor(Math.min(w, h)))
      setCellSize({ cw, ch })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [screen])

  // ---- starting ----
  const start = (mode, stage = unlocked) => {
    const game = mode === "sort" ? S.newSort({ seed: Date.now() }) : E.newGame({ mode, stage, seed: Date.now() })
    gameRef.current = game
    fx.current = []
    pointers.current.clear()
    setOver(null)
    setHold(false)
    setScreen("play")
    const fresh = mode === "stage" ? E.newIn(game.stage) : null
    setIntro(prefs.tips && fresh ? { bomb: fresh, stage: game.stage } : mode === "endless" ? null : mode === "sort" && prefs.tips ? { sort: true } : null)
    setFrame((f) => f + 1)
    setTimeout(() => rootRef.current?.focus({ preventScroll: true }), 0)
  }
  const toTitle = () => {
    gameRef.current = null
    setOver(null)
    setHold(false)
    setIntro(null)
    setScreen("title")
  }

  const addFx = (kind, where, text) => {
    const id = ++fxId.current
    fx.current.push({ id, kind, ...where, text, until: performance.now() + (kind === "boom" ? 650 : 750) })
  }

  // ---- what happened this frame: sounds, effects, the end ----
  const handleEvents = (game, events) => {
    for (const e of events) {
      if (e.type === "pop") sounds.pop()
      else if (e.type === "whack") {
        if (e.bomb === "gold") sounds.gold()
        else sounds.whack(e.combo)
        addFx("whack", { hole: e.hole }, `+${e.points}`)
        if (e.mult >= 5) unlock("boomfrenzy-x5")
      } else if (e.type === "hit") sounds.hit()
      else if (e.type === "boom") {
        sounds.boom()
        addFx("boom", { hole: e.hole })
      } else if (e.type === "hurt") sounds.hurt()
      else if (e.type === "skull") {
        sounds.boom()
        addFx("boom", { hole: e.hole })
      } else if (e.type === "miss") sounds.miss()
      else if (e.type === "nudge") {
        sounds.nudge()
        addFx("nudge", { hole: e.hole }, e.why === "swipe" ? "Swipe!" : "Hold!")
      } else if (e.type === "jump") sounds.jump()
      else if (e.type === "split") sounds.split()
      else if (e.type === "freeze") sounds.freeze()
      else if (e.type === "heart") sounds.heart()
      else if (e.type === "slow") sounds.slow()
      else if (e.type === "panic") sounds.panic()
      else if (e.type === "weapon") sounds.weapon(e.weapon)
      else if (e.type === "sorted") {
        sounds.sort(e.combo)
        addFx("whack", { x: e.x, y: e.y }, `+${e.points}`)
      } else if (e.type === "won" || e.type === "lost") finish(game)
    }
  }

  const finish = (game) => {
    const mode = game.mode
    const won = game.over === "won"
    const key = mode === "stage" ? `stage${game.stage}` : mode
    const rec = store.record(key, { score: game.score, note: mode === "sort" ? `${game.sorted} sorted` : `${game.whacked} whacked` })
    let d = rec.data
    if (mode === "stage" && won) {
      const st = { ...(d.extra.stars || {}) }
      st[game.stage] = Math.max(st[game.stage] || 0, game.stars)
      d = store.setExtra({ stars: st, unlocked: Math.max(d.extra.unlocked || 1, Math.min(E.STAGES, game.stage + 1)) })
      if (game.stage >= 10) unlock("boomfrenzy-stage10")
      if (game.stage === E.STAGES) unlock("boomfrenzy-all")
    }
    if (mode === "endless" && game.score >= 5000) unlock("boomfrenzy-endless")
    setData(d)
    const result = { mode, won, stage: game.stage, score: game.score, stars: game.stars, best: rec.best, whacked: game.whacked ?? game.sorted, bestCombo: game.bestCombo }
    setOver(result)
    setLast(result)
    setTimeout(() => (won || rec.best ? sounds.won() : sounds.lost()), 350)
  }

  // ---- the loop ----
  useGameLoop((dt) => {
    const game = gameRef.current
    if (!game || game.over) return
    if (game.mode === "sort") S.step(game, dt)
    else E.step(game, dt)
    const events = game.events
    game.events = []
    handleEvents(game, events)
    const now = performance.now()
    if (fx.current.length && fx.current[0].until < now) fx.current = fx.current.filter((f) => f.until > now)
    setFrame((f) => (f + 1) % 1e9)
  }, running)

  // actions outside the loop (taps while it runs) still need their events handled at once
  const flush = () => {
    const game = gameRef.current
    if (!game) return
    const events = game.events
    game.events = []
    handleEvents(game, events)
    setFrame((f) => (f + 1) % 1e9)
  }

  // ---- fingers and the mouse on the field ----
  const holeAt = (e) => {
    const el = e.target.closest?.("[data-hole]")
    return el ? Number(el.dataset.hole) : -1
  }
  const onFieldDown = (e) => {
    const game = gameRef.current
    if (!running || !game || game.mode === "sort") return
    e.preventDefault()
    const hole = holeAt(e)
    if (hole < 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const b = game.holes[hole]
    const p = { hole, x: e.clientX, y: e.clientY, t: performance.now(), arrow: false, done: false }
    if (b && b.type === "arrow" && !E.isSnip(game)) p.arrow = true
    else {
      E.holdStart(game, hole)
      addFx("mallet", { hole })
    }
    pointers.current.set(e.pointerId, p)
    flush()
  }
  const onFieldMove = (e) => {
    const p = pointers.current.get(e.pointerId)
    const game = gameRef.current
    if (!p || !p.arrow || p.done || !game) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    if (Math.hypot(dx, dy) >= SWIPE_PX) {
      p.done = true
      E.swipe(game, p.hole, dirOf(dx, dy))
      addFx("swipe", { hole: p.hole })
      flush()
    }
  }
  const onFieldUp = (e) => {
    const p = pointers.current.get(e.pointerId)
    pointers.current.delete(e.pointerId)
    const game = gameRef.current
    if (!p || !game) return
    if (p.arrow && !p.done) {
      const dx = e.clientX - p.x
      const dy = e.clientY - p.y
      if (Math.hypot(dx, dy) >= SWIPE_PX * 0.6) E.swipe(game, p.hole, dirOf(dx, dy))
      else E.whack(game, p.hole)
    } else if (!p.arrow) E.holdEnd(game, p.hole)
    flush()
  }

  // ---- Sort Rush: drag and flick ----
  const sortDrag = useRef(null)
  const yardPoint = (e) => {
    const r = fieldRef.current.querySelector(".bfYard").getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  const onBombDown = (id) => (e) => {
    const game = gameRef.current
    if (!running || !game || sortDrag.current) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (!S.grab(game, id)) return
    const p = yardPoint(e)
    sortDrag.current = { id, pointerId: e.pointerId, samples: [{ ...p, t: performance.now() }], touch: e.pointerType !== "mouse" }
    flush()
  }
  const onBombMove = (e) => {
    const d = sortDrag.current
    const game = gameRef.current
    if (!d || d.pointerId !== e.pointerId || !game) return
    const p = yardPoint(e)
    const b = game.bombs.find((x) => x.id === d.id)
    if (b) {
      b.x = p.x
      b.y = p.y - (d.touch ? 0.06 : 0)
    }
    d.samples.push({ ...p, t: performance.now() })
    if (d.samples.length > 8) d.samples.shift()
  }
  const onBombUp = (e) => {
    const d = sortDrag.current
    const game = gameRef.current
    if (!d || d.pointerId !== e.pointerId || !game) return
    sortDrag.current = null
    const b = game.bombs.find((x) => x.id === d.id)
    if (!b) return
    // a flick: where it would slide to
    const s = d.samples
    const a = s.find((q) => s[s.length - 1].t - q.t <= 90) || s[0]
    const z = s[s.length - 1]
    const dt = Math.max(16, z.t - a.t) / 1000
    const vx = (z.x - a.x) / dt
    const vy = (z.y - a.y) / dt
    const land = Math.hypot(vx, vy) > 1.2 ? S.flickLanding(b.x, b.y, vx, vy) : { x: b.x, y: b.y }
    S.drop(game, d.id, land.x, land.y)
    flush()
  }

  // ---- keys ----
  const onKeyDown = (e) => {
    if (e.target.closest?.("input, select, textarea") || e.target.closest?.(".menuBar")) return
    const game = gameRef.current
    const used = () => (e.preventDefault(), e.stopPropagation())
    if (screen !== "play" || !game) return
    if (e.key === "Escape" || e.key === "p" || e.key === "P") {
      used()
      if (!game.over) setHold((h) => !h)
      return
    }
    if (!running || game.mode === "sort" || e.repeat) return
    const k = e.key.toLowerCase()
    if (WEAPON_KEYS[e.key] || (WEAPON_KEYS[k] && !e.shiftKey)) {
      used()
      E.useWeapon(game, WEAPON_KEYS[e.key] || WEAPON_KEYS[k])
      return flush()
    }
    if (ARROW_KEYS[e.key]) {
      used()
      let hole = selected.current
      if (!(game.holes[hole]?.type === "arrow")) {
        const arrows = game.holes.filter((b) => b && b.type === "arrow").sort((a, b) => a.left - b.left)
        hole = arrows[0]?.hole ?? -1
      }
      if (hole >= 0) E.swipe(game, hole, ARROW_KEYS[e.key])
      selected.current = -1
      return flush()
    }
    const code = e.code?.startsWith("Numpad") ? e.code.slice(6) : null
    const hole = HOLE_KEYS[code ?? k]
    if (hole === undefined) return
    used()
    const b = game.holes[hole]
    if (b && b.type === "arrow" && !E.isSnip(game)) {
      selected.current = hole
      E.whack(game, hole)
    } else {
      E.holdStart(game, hole)
      heldKeys.current.set(e.key, hole)
      addFx("mallet", { hole })
    }
    flush()
  }
  const onKeyUp = (e) => {
    const hole = heldKeys.current.get(e.key)
    if (hole === undefined || !gameRef.current) return
    heldKeys.current.delete(e.key)
    E.holdEnd(gameRef.current, hole)
    flush()
  }

  const fire = (w) => {
    const game = gameRef.current
    if (!running || !game) return
    E.useWeapon(game, w)
    flush()
  }

  // ---- dev hook for tests ----
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__boomfrenzy = {
      state: () => gameRef.current,
      put: (type, hole, extra) => {
        const game = gameRef.current
        if (!game || game.mode === "sort") return null
        game.holes[hole] = null
        const b = E.makeBomb(game, type, hole, extra)
        flush()
        return b.id
      },
      quiet: () => gameRef.current && (gameRef.current.nextSpawnAt = Infinity),
      spawnSort: (color) => {
        const game = gameRef.current
        if (!game || game.mode !== "sort") return null
        const b = S.spawn(game, color)
        b.x = 0.5
        b.y = 0.55
        b.vx = b.vy = 0
        flush()
        return b.id
      },
    }
    return () => delete window.__boomfrenzy
  }, [])

  // ---- menus ----
  const menus = [
    {
      label: "Game",
      items: [
        { label: `Play Stage ${unlocked}`, onClick: () => start("stage", unlocked) },
        { label: "Stage Select...", onClick: () => setDialog("stages") },
        { label: "Endless", onClick: () => start("endless") },
        { label: "Sort Rush", onClick: () => start("sort") },
        "-",
        { label: "Pause (P)", disabled: screen !== "play" || !g || !!g.over, onClick: () => setHold(true) },
        { label: "High Scores...", onClick: () => setDialog("scores") },
        { label: "Title Screen", onClick: toTitle },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    {
      label: "Options",
      items: [
        { label: "Sound", checked: prefs.sound, onClick: () => setPref({ sound: !prefs.sound }) },
        { label: "New Bomb Tips", checked: prefs.tips, onClick: () => setPref({ tips: !prefs.tips }) },
        chatItem,
      ],
    },
    { label: "Help", items: [helpItem({ program: "Boom Frenzy" }), "-", { label: "How to Play...", onClick: () => setDialog("howto") }, { label: "The Bombs...", onClick: () => setDialog("bombs") }] },
  ]

  // ---- drawing ----
  const totalStars = Object.values(stars).reduce((a, b) => a + b, 0)
  const title = (
    <TitleScreen>
      <GameStart
        id="boomfrenzy"
        title={
          <div className="qgLogo bfLogo">
            <div className="bfLogoBomb">
              <Bomb type="black" fuse={0.8} />
            </div>
            <div className="qgLogoText bfLogoText">Boom Frenzy</div>
            <div className="qgTagline">Whack the bombs before they blow!</div>
          </div>
        }
        play={{
          label: last?.mode === "endless" ? "Endless again" : `Stage ${unlocked}`,
          sub: last?.mode === "endless" ? `Best: ${fmtNum(store.best(data, "endless"))}` : `${E.goalFor(unlocked)} bombs to whack · ${totalStars} of ${E.STAGES * 3} stars`,
          onClick: () => (last?.mode === "endless" ? start("endless") : start("stage", unlocked)),
          autoFocus: true,
          "data-play": true,
        }}
        modes={[
          last?.mode === "endless" ? { key: "stage", label: `Stage ${unlocked}`, sub: `${E.goalFor(unlocked)} bombs to whack`, onClick: () => start("stage", unlocked) } : { key: "endless", label: "Endless", sub: `No goal, Panic Time every 30 s · Best ${fmtNum(store.best(data, "endless"))}`, onClick: () => start("endless"), "data-mode": "endless" },
          { key: "sort", label: "Sort Rush", sub: `Drag bombs into their pens · Best ${fmtNum(store.best(data, "sort"))}`, onClick: () => start("sort"), "data-mode": "sort" },
          { key: "select", label: "Stage Select...", sub: `${unlocked} of ${E.STAGES} stages open`, onClick: () => setDialog("stages") },
          { key: "scores", label: "High Scores...", sub: "Your best in every mode", onClick: () => setDialog("scores") },
        ]}
        optionsSummary={`Sound ${prefs.sound ? "on" : "off"} · New bomb tips ${prefs.tips ? "on" : "off"}`}
        options={
          <>
            <Check id="bf-opt1" checked={prefs.sound} onChange={() => setPref({ sound: !prefs.sound })}>
              Sound
            </Check>
            <Check id="bf-opt2" checked={prefs.tips} onChange={() => setPref({ tips: !prefs.tips })}>
              Show each new bomb before its stage
            </Check>
            <button type="button" onClick={() => setDialog("bombs")}>
              The 15 bombs...
            </button>
          </>
        }
      >
        {last && (
          <fieldset className="qgResult">
            <legend>{last.mode === "stage" ? `Stage ${last.stage}: ${last.won ? "cleared!" : "Boom!"}` : `${MODE_LABEL[last.mode]}: game over`}</legend>
            Score <b>{fmtNum(last.score)}</b>
            {last.best && <span className="qgNewBest"> New best!</span>}
          </fieldset>
        )}
      </GameStart>
    </TitleScreen>
  )

  const hud = g && (
    <div className="qgHud bfHud">
      <div className="qgCounter">
        <span className="qgLabel">Score</span>
        <span className="qgNum" data-score={g.score}>
          {fmtNum(g.score)}
        </span>
      </div>
      <div className="bfHearts" data-hearts={g.hearts} aria-label={`${g.hearts} hearts`}>
        {Array.from({ length: Math.max(g.hearts, g.mode === "sort" ? S.START_HEARTS : E.START_HEARTS) }, (_, i) => (
          <Heart key={i} full={i < g.hearts} />
        ))}
      </div>
      <div className="bfMult" data-mult={g.mode === "sort" ? S.multFor(g.combo) : E.multFor(g.combo)}>
        x{g.mode === "sort" ? S.multFor(g.combo) : E.multFor(g.combo)}
        <small>{g.combo} in a row</small>
      </div>
      <div className="qgCounter bfGoal">
        <span className="qgLabel">{g.mode === "stage" ? `Stage ${g.stage}` : g.mode === "sort" ? "Sorted" : "Whacked"}</span>
        <span className="qgNum">{g.mode === "stage" ? `${g.whacked}/${g.goal}` : g.mode === "sort" ? g.sorted : g.whacked}</span>
      </div>
      <button type="button" className="qgPauseBtn" onClick={() => setHold(true)} aria-label="Pause" title="Pause (P)">
        ||
      </button>
    </div>
  )

  const { cw, ch } = cellSize
  const cell = Math.min(cw, ch)
  const now = performance.now()
  const field = g && g.mode !== "sort" && (
    <div
      className={`bfField${E.isPanic(g) ? " is-panic" : ""}${E.isFrozen(g) ? " is-frozen" : ""}${E.isSnip(g) ? " is-snip" : ""}`}
      style={{ width: cw * 3, height: ch * 3, "--cw": `${cw}px`, "--ch": `${ch}px`, "--s": `${cell}px` }}
      data-touch-surface
      onPointerDown={onFieldDown}
      onPointerMove={onFieldMove}
      onPointerUp={onFieldUp}
      onPointerCancel={onFieldUp}
    >
      {g.holes.map((b, i) => (
        <div key={i} className="bfHole" data-hole={i} data-bomb={b ? b.type : ""} style={{ left: (i % 3) * cw, top: Math.floor(i / 3) * ch }}>
          <div className="bfDirt" />
          {b && (
            <div
              key={b.id}
              className={`bfBomb bfBomb-${b.type}${b.left < 0.7 && b.life === Infinity ? " is-hot" : ""}${b.type === "ghost" && !E.ghostVisible(b) ? " is-faded" : ""}${b.holding ? " is-held" : ""}`}
              data-id={b.id}
              data-dir={b.dir || undefined}
            >
              <Bomb type={b.type} fuse={b.life === Infinity ? b.left / b.fuse : 1} hits={b.hits} dir={b.dir} ring={b.held / E.HOLD_TIME} small={b.small} />
            </div>
          )}
          <div className="bfDirtFront" />
        </div>
      ))}
      {fx.current.map((f) => {
        const left = ((f.hole ?? 0) % 3) * cw + (cw - cell) / 2
        const top = Math.floor((f.hole ?? 0) / 3) * ch + (ch - cell)
        const life = 1 - (f.until - now) / 750
        if (f.kind === "boom") {
          return (
            <div key={f.id} className="bfFx bfFxBoom" style={{ left, top, width: cell, height: cell }}>
              <Boom />
            </div>
          )
        }
        if (f.kind === "mallet") {
          return (
            <div key={f.id} className="bfFx bfFxMallet" style={{ left: left + cell * 0.45, top: top - cell * 0.05, width: cell * 0.6, height: cell * 0.6 }}>
              <Mallet />
            </div>
          )
        }
        if (f.kind === "swipe") return <div key={f.id} className="bfFx bfFxSwipe" style={{ left, top, width: cell, height: cell }} />
        return (
          <div key={f.id} className={`bfFx bfFxText${f.kind === "nudge" ? " is-nudge" : ""}`} style={{ left: left + cell / 2, top: top + cell * 0.3 - life * 24 }}>
            {f.text}
          </div>
        )
      })}
    </div>
  )

  const yard = g && g.mode === "sort" && (
    <div className="bfYardWrap" style={{ width: side, height: side }}>
      <div className="bfYard" onPointerMove={onBombMove} onPointerUp={onBombUp} onPointerCancel={onBombUp}>
        <div className="bfPen bfPen-red" style={{ width: `${S.PEN_W * 100}%` }}>
          <span>{g.penned.red}</span>
        </div>
        <div className="bfPen bfPen-blue" style={{ width: `${S.PEN_W * 100}%` }}>
          <span>{g.penned.blue}</span>
        </div>
        <div className={`bfPen bfPen-green${g.t >= S.GREEN_AT ? "" : " is-closed"}`} style={{ height: `${S.PEN_TOP * 100}%`, left: `${S.PEN_W * 100}%`, right: `${S.PEN_W * 100}%` }}>
          <span>{g.t >= S.GREEN_AT ? g.penned.green : `Opens at ${S.GREEN_AT}s`}</span>
        </div>
        {g.bombs.map((b) => (
          <div
            key={b.id}
            className={`bfSortBomb bfSort-${b.color}${b.held ? " is-held" : ""}${b.left < 1.5 ? " is-hot" : ""}`}
            data-sort={b.id}
            data-color={b.color}
            style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%` }}
            onPointerDown={onBombDown(b.id)}
          >
            <Bomb type={b.color} fuse={b.left / b.fuse} />
          </div>
        ))}
        {fx.current.map((f) => (
          <div key={f.id} className="bfFx bfFxText" style={{ left: `${(f.x ?? 0.5) * 100}%`, top: `${(f.y ?? 0.5) * 100}%` }}>
            {f.text}
          </div>
        ))}
      </div>
    </div>
  )

  const weapons = g && g.mode !== "sort" && (
    <div className="bfWeapons">
      <div className="bfMeter" title={`Weapon meter: ${g.meter} of ${E.METER_MAX}`}>
        <div className="bfMeterFill" style={{ width: `${(g.meter / E.METER_MAX) * 100}%` }} />
      </div>
      <div className="bfWeaponRow">
        {E.WEAPON_IDS.map((w, i) => (
          <button key={w} type="button" className="bfWeapon" data-weapon={w} disabled={!E.canUse(g, w) || !running} onClick={() => fire(w)} title={`${E.WEAPONS[w].how} (${"JKL"[i]})`}>
            {WEAPON_ICONS[w]}
            <span>{E.WEAPONS[w].name}</span>
            <small>{E.WEAPONS[w].cost}</small>
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <QuickGameRoot ref={rootRef} className="bfRoot" mobile={mobile} onKeyDown={onKeyDown} onKeyUp={onKeyUp} data-screen={screen}>
      <MenuBar menus={menus} />
      <GameChat game="boomfrenzy" title="Boom Frenzy" />
      {screen === "title" ? (
        title
      ) : (
        <>
          {hud}
          <div className="bfBody">
          <div className={`qgStage bfStage${g && g.mode !== "sort" && E.isPanic(g) ? " is-panic" : ""}`} ref={fieldRef}>
            {g && g.mode !== "sort" && E.isPanic(g) && <div className="bfBanner">PANIC TIME! x2</div>}
            {g && g.mode !== "sort" && E.isFrozen(g) && <div className="bfBanner is-cool">FROZEN</div>}
            {g && g.mode !== "sort" && E.isSnip(g) && <div className="bfBanner is-snip">ONE-TAP SNIP</div>}
            {field}
            {yard}
            {intro && (
              <div className="qgOverlay">
                <div className="qgPanel window">
                  <div className="title-bar">
                    <div className="title-bar-text">{intro.sort ? "Sort Rush" : `Stage ${intro.stage}: new bomb!`}</div>
                  </div>
                  <div className="window-body qgPanelBody">
                    {intro.sort ? (
                      <p>Drag (or flick) each bomb into the pen of its color before its fuse burns down: red to the left, blue to the right. Green opens at the top after {S.GREEN_AT} seconds.</p>
                    ) : (
                      <>
                        <div className="bfIntroBomb">
                          <Bomb type={intro.bomb} dir="right" ring={0.6} />
                        </div>
                        <b>{E.BOMBS[intro.bomb].name}</b>
                        <p>{E.BOMBS[intro.bomb].how}</p>
                        <p className="bfGoalLine">Whack {E.goalFor(intro.stage)} bombs to clear the stage.</p>
                      </>
                    )}
                    <div className="qgPanelButtons">
                      <button type="button" className="qgBig" autoFocus onClick={() => (setIntro(null), rootRef.current?.focus({ preventScroll: true }))} data-go>
                        Go!
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {hold && !over && <PausedPanel onResume={() => (setHold(false), rootRef.current?.focus({ preventScroll: true }))} onQuit={toTitle} />}
            {over && (
              <div className="qgOverlay" data-over={over.won ? "won" : "lost"}>
                <div className="qgPanel window">
                  <div className="title-bar">
                    <div className="title-bar-text">{over.mode === "stage" ? (over.won ? `Stage ${over.stage} cleared!` : "Boom!") : "Game over"}</div>
                  </div>
                  <div className="window-body qgPanelBody">
                    {over.mode === "stage" && over.won && (
                      <div className="bfStars" aria-label={`${over.stars} stars`}>
                        {[1, 2, 3].map((n) => (
                          <span key={n} className={n <= over.stars ? "is-on" : ""}>
                            ★
                          </span>
                        ))}
                      </div>
                    )}
                    {!over.won && <p>{over.mode === "sort" ? "Out of hearts!" : "Out of hearts! The bombs got you."}</p>}
                    <p className="qgFinal">{fmtNum(over.score)}</p>
                    <p>
                      {over.whacked} {over.mode === "sort" ? "sorted" : "whacked"} · best streak {over.bestCombo}
                    </p>
                    {over.best && <p className="qgNewBest">New best score!</p>}
                    <div className="qgPanelButtons">
                      {over.mode === "stage" && over.won && over.stage < E.STAGES && (
                        <button type="button" className="qgBig" autoFocus onClick={() => start("stage", over.stage + 1)} data-next>
                          Next: Stage {over.stage + 1}
                        </button>
                      )}
                      <button type="button" className={over.won && over.stage < E.STAGES && over.mode === "stage" ? "" : "qgBig"} autoFocus={!(over.mode === "stage" && over.won)} onClick={() => start(over.mode, over.stage)} data-again>
                        {over.won ? "Play Again" : "Try Again"}
                      </button>
                      <button type="button" onClick={toTitle}>
                        Title Screen
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          {weapons}
          </div>
        </>
      )}

      {dialog === "stages" && (
        <Dialog title="Stage Select" onOk={() => setDialog(null)} okLabel="Close">
          <div className="bfStageGrid">
            {Array.from({ length: E.STAGES }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" disabled={n > unlocked} onClick={() => (setDialog(null), start("stage", n))} data-stage={n}>
                <b>{n}</b>
                <span className="bfStageStars">{"★".repeat(stars[n] || 0) || (n > unlocked ? "locked" : "-")}</span>
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {dialog === "scores" && (
        <ScoresDialog
          title="Boom Frenzy High Scores"
          onClose={() => setDialog(null)}
          tables={[
            { label: "Endless", rows: data.scores.endless },
            { label: "Sort Rush", rows: data.scores.sort },
            ...Array.from({ length: unlocked }, (_, i) => ({ label: `Stage ${i + 1}`, rows: data.scores[`stage${i + 1}`] })).filter((t) => t.rows?.length),
          ]}
        />
      )}
      {dialog === "howto" && (
        <HowToDialog title="How to Play Boom Frenzy" onClose={() => setDialog(null)}>
          <p>Bombs pop out of the nine holes with their fuses burning. Whack them before they go off! A bomb that goes off costs a heart; lose all your hearts and it's over.</p>
          <ul>
            <li>Whacks in a row build your multiplier: x2 at 5, x3 at 10, x4 at 20, x5 at 35. Missing (an empty hole) or a blast resets it.</li>
            <li>Some bombs need more than a tap: swipe Arrow bombs, hold Hold bombs, tap Helmets twice and Iron three times. Leave Skulls alone!</li>
            <li>Every whack charges the weapon meter: Big Mallet (40), Freeze Ray (25), Fuse Snipper (30).</li>
            <li>
              <b>Panic Time</b>: the sky turns red, bombs come three times as fast, and every whack scores double.
            </li>
          </ul>
          <p>
            Keys: 7 8 9 / 4 5 6 / 1 2 3 (or Q W E / A S D / Z X C) whack the holes; arrow keys swipe an Arrow bomb; hold the key on a Hold bomb; J K L fire the weapons; P pauses.
          </p>
          <p>
            <b>Sort Rush</b>: drag or flick each bomb into the pen of its color.
          </p>
        </HowToDialog>
      )}
      {dialog === "bombs" && (
        <HowToDialog title="The Bombs" onClose={() => setDialog(null)}>
          <div className="bfBombList">
            {E.UNLOCK.map((t, i) => (
              <div key={t} className="bfBombRow">
                <div className="bfBombRowArt">
                  <Bomb type={t} dir="right" ring={0.5} />
                </div>
                <div>
                  <b>
                    {E.BOMBS[t].name}
                    {E.BOMBS[t].points ? ` (${E.BOMBS[t].points})` : ""}
                  </b>
                  <br />
                  {E.BOMBS[t].how} <i>From stage {i + 1}.</i>
                </div>
              </div>
            ))}
          </div>
        </HowToDialog>
      )}
    </QuickGameRoot>
  )
}

export default BoomFrenzy
