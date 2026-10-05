import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import GameStart from "../../shared/GameStart"
import Dialog from "../../shared/Dialog"
import { Check, HowToDialog, QuickGameRoot, ScoresDialog, TitleScreen, useAutoPause, useGameLoop } from "../../shared/quickgame"
import { Hit, PixelArt, PixelButton, PixelLed, PixelP, PixelScores, PixelText, RetroBanner, RetroPanel, RetroPaused, RetroStage, Sr, useRetroScreen } from "../../shared/retro"
import { unlock } from "../../../utils/achievements"
import { helpItem } from "../../../utils/help"
import { reducedMotion } from "../../../utils/settings"
import { blit, clear } from "../../../utils/retro"
import { createScores, fmtNum } from "../../../utils/gameKit"
import * as E from "./engine"
import * as S from "./sort"
import { bombCard, drawBanner, drawGame, layout, minSize, pal, starSprites } from "./pixels"
import { createSounds } from "./sounds"
import "./BoomFrenzy.css"

// Boom Frenzy: whack the bombs before their fuses burn down (after Bomb Panic, Orangenose
// Studios' 2012 iPhone game; the research and what's inferred: docs/games-new.md). 15 kinds
// of bomb, Panic Time, 3 weapons, 20 stages, Endless, and Sort Rush (drag colored bombs into
// their pens). Rules in engine.js and sort.js; the 256-colour pixel picture in pixels.js
// (drawn into a small canvas, blown up by whole pixels); this file reads fingers, the mouse
// and keys through invisible hit boxes laid over the picture.

const store = createScores("98ish.boomfrenzy", { defaults: { sound: true, tips: true } })
const MODE_LABEL = { stage: "Stages", endless: "Endless", sort: "Sort Rush" }
// keys for the holes: the number pad's layout, or three rows of letters
const HOLE_KEYS = { 7: 0, 8: 1, 9: 2, 4: 3, 5: 4, 6: 5, 1: 6, 2: 7, 3: 8, q: 0, w: 1, e: 2, a: 3, s: 4, d: 5, z: 6, x: 7, c: 8 }
const ARROW_KEYS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" }
const WEAPON_KEYS = { j: "mallet", k: "freeze", l: "snip", "!": "mallet", "@": "freeze", "#": "snip" }
const SWIPE_PX = 22

const dirOf = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up")

// what the hit boxes and the screen-reader line depend on (re-render only when it changes)
const signature = (g, running) => {
  if (!g) return ""
  if (g.mode === "sort") return `${g.bombs.map((b) => b.id).join(",")}|${g.score}|${g.hearts}|${g.over}|${g.t >= S.GREEN_AT}`
  return `${g.holes.map((b) => (b ? `${b.id}${b.type}` : "-")).join(",")}|${g.score}|${g.hearts}|${g.whacked}|${E.WEAPON_IDS.map((w) => E.canUse(g, w)).join()}|${running}|${g.over}|${E.isPanic(g)}${E.isFrozen(g)}${E.isSnip(g)}`
}

const Stars = ({ n }) => (
  <PixelArt
    w={33}
    h={11}
    palette={pal}
    k={`stars${n}`}
    scale={2}
    label={`${n} stars`}
    draw={(b) => [0, 1, 2].forEach((i) => blit(b, i < n ? starSprites.on : starSprites.off, i * 11 + 1, 0))}
  />
)
const BombPic = ({ type, scale = 1, px }) => <PixelArt w={40} h={40} palette={pal} k={type} scale={scale} px={px} draw={(b) => b.data.set(bombCard(type, 40).data)} />

const BoomFrenzy = ({ mobile = false, paused = false, onClose }) => {
  const chatItem = useGameChatMenuItem("boomfrenzy")
  const rootRef = useRef(null)
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
  const fx = useRef([])
  const hitAt = useRef({})
  const pointers = useRef(new Map())
  const selected = useRef(-1) // the hole a key picked (for an Arrow bomb's direction)
  const heldKeys = useRef(new Map())
  const pressed = useRef(null) // a drawn button held down (pause, a weapon)
  const sig = useRef("")
  const sortEls = useRef(new Map())
  const g = gameRef.current
  const mode = g?.mode || "stage"

  useEffect(() => {
    sounds.setEnabled(prefs.sound)
  }, [prefs.sound])
  const setPref = (patch) => setData(store.setPrefs(patch))

  const running = screen === "play" && !!g && !g.over && !hold && !intro && !dialog
  const runningRef = useRef(running)
  runningRef.current = running
  useAutoPause(paused, () => {
    if (screen === "play" && gameRef.current && !gameRef.current.over) setHold(true)
  })

  // ---- the picture ----
  const Lref = useRef(null)
  const scr = useRetroScreen({
    layout: (w, h) => minSize(w, h, gameRef.current?.mode || "stage"),
    palette: pal,
    deps: [mode],
    render: (b, fit) => {
      const game = gameRef.current
      const L = Lref.current
      if (!game || !L || L.W !== fit.w || L.H !== fit.h) return clear(b, pal.idx("black"))
      drawGame(b, game, L, { t: performance.now() / 1000, fx: fx.current, now: performance.now(), pressed: pressed.current, running: runningRef.current, reduced: reducedMotion(), hitAt: hitAt.current })
    },
  })
  const L = useMemo(() => (scr.fit ? layout(scr.fit.w, scr.fit.h, mode) : null), [scr.fit, mode])
  Lref.current = L
  // repaint after anything React changed (pause, a panel, a resize)
  useEffect(() => {
    if (screen === "play") scr.paint()
  })

  // ---- starting ----
  const start = (m, stage = unlocked) => {
    const game = m === "sort" ? S.newSort({ seed: Date.now() }) : E.newGame({ mode: m, stage, seed: Date.now() })
    gameRef.current = game
    fx.current = []
    hitAt.current = {}
    pointers.current.clear()
    setOver(null)
    setHold(false)
    setScreen("play")
    const fresh = m === "stage" ? E.newIn(game.stage) : null
    setIntro(prefs.tips && fresh ? { bomb: fresh, stage: game.stage } : m === "endless" ? null : m === "sort" && prefs.tips ? { sort: true } : null)
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

  const addFx = (kind, where, text, extra = {}) => {
    const now = performance.now()
    fx.current.push({ kind, ...where, text, ...extra, at: now, until: now + (kind === "boom" ? 600 : kind === "mallet" ? 220 : 750) })
  }

  // ---- what happened: sounds, effects, the end ----
  const handleEvents = (game, events) => {
    for (const e of events) {
      if (e.type === "pop") sounds.pop()
      else if (e.type === "whack") {
        if (e.bomb === "gold") sounds.gold()
        else sounds.whack(e.combo)
        addFx("text", { hole: e.hole }, `+${e.points}`, { gold: e.bomb === "gold", big: e.points >= 100 })
        if (e.mult >= 5) unlock("boomfrenzy-x5")
      } else if (e.type === "hit") {
        sounds.hit()
        const b = game.holes?.[e.hole]
        if (b) hitAt.current[b.id] = performance.now()
      } else if (e.type === "boom") {
        sounds.boom(e.chained)
        addFx("boom", e.hole != null ? { hole: e.hole } : { x: e.x, y: e.y })
      } else if (e.type === "hurt") sounds.hurt()
      else if (e.type === "skull") {
        sounds.boom()
        addFx("boom", { hole: e.hole })
      } else if (e.type === "miss") sounds.miss()
      else if (e.type === "nudge") {
        sounds.nudge()
        addFx("nudge", { hole: e.hole }, e.why === "swipe" ? "SWIPE!" : "HOLD!")
      } else if (e.type === "jump") sounds.jump()
      else if (e.type === "split") sounds.split()
      else if (e.type === "freeze") sounds.freeze()
      else if (e.type === "heart") sounds.heart()
      else if (e.type === "slow") sounds.slow()
      else if (e.type === "panic") sounds.panic()
      else if (e.type === "weapon") sounds.weapon(e.weapon)
      else if (e.type === "sorted") {
        sounds.sort(e.combo)
        addFx("text", { x: e.x, y: e.y }, `+${e.points}`)
      } else if (e.type === "newPen") sounds.heart()
      else if (e.type === "won" || e.type === "lost") finish(game)
    }
  }

  const finish = (game) => {
    const m = game.mode
    const won = game.over === "won"
    const key = m === "stage" ? `stage${game.stage}` : m
    const rec = store.record(key, { score: game.score, note: m === "sort" ? `${game.sorted} sorted` : `${game.whacked} whacked` })
    let d = rec.data
    if (m === "stage" && won) {
      const st = { ...(d.extra.stars || {}) }
      st[game.stage] = Math.max(st[game.stage] || 0, game.stars)
      d = store.setExtra({ stars: st, unlocked: Math.max(d.extra.unlocked || 1, Math.min(E.STAGES, game.stage + 1)) })
      if (game.stage >= 10) unlock("boomfrenzy-stage10")
      if (game.stage === E.STAGES) unlock("boomfrenzy-all")
    }
    if (m === "endless" && game.score >= 5000) unlock("boomfrenzy-endless")
    setData(d)
    const result = { mode: m, won, stage: game.stage, score: game.score, stars: game.stars, best: rec.best, place: rec.place, key, whacked: game.whacked ?? game.sorted, bestCombo: game.bestCombo }
    setOver(result)
    setLast(result)
    setTimeout(() => (won || rec.best ? sounds.won() : sounds.lost()), 350)
  }

  // Sort Rush's bomb hit boxes follow their bombs without a React render
  const placeSortBoxes = () => {
    const game = gameRef.current
    const LL = Lref.current
    if (!game || game.mode !== "sort" || !LL || !scr.fit) return
    const px = scr.fit.css
    for (const b of game.bombs) {
      const el = sortEls.current.get(b.id)
      if (!el) continue
      el.style.left = `${(b.x * LL.yard.w - 13) * px}px`
      el.style.top = `${(b.y * LL.yard.h - 16 - (b.held ? 6 : 0)) * px}px`
    }
  }

  // ---- the loop: the rules run while playing; the picture keeps moving (effects) until paused
  const animating = screen === "play" && !!g && !hold && !dialog
  useGameLoop((dt) => {
    const game = gameRef.current
    if (!game) return
    if (runningRef.current && !game.over) {
      if (game.mode === "sort") S.step(game, dt)
      else E.step(game, dt)
      const events = game.events
      game.events = []
      handleEvents(game, events)
    }
    const now = performance.now()
    if (fx.current.length && fx.current[0].until < now) fx.current = fx.current.filter((f) => f.until > now)
    scr.paint()
    placeSortBoxes()
    const s = signature(game, runningRef.current)
    if (s !== sig.current) {
      sig.current = s
      setFrame((f) => (f + 1) % 1e9)
    }
  }, animating)

  // actions outside the loop (taps while it runs) still need their events handled at once
  const flush = () => {
    const game = gameRef.current
    if (!game) return
    const events = game.events
    game.events = []
    handleEvents(game, events)
    scr.paint()
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
      if (!(b && b.type === "hold")) addFx("mallet", { hole })
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
      const dir = dirOf(dx, dy)
      E.swipe(game, p.hole, dir)
      addFx("swipe", { hole: p.hole }, null, { dir })
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
    const r = rootRef.current.querySelector(".bfYard").getBoundingClientRect()
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
      if (hole >= 0) {
        E.swipe(game, hole, ARROW_KEYS[e.key])
        addFx("swipe", { hole }, null, { dir: ARROW_KEYS[e.key] })
      }
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
      if (!(b && b.type === "hold")) addFx("mallet", { hole })
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
  // a drawn button looks pressed while a finger or the mouse is on it
  const pressProps = (id) => ({
    onPointerDown: () => ((pressed.current = id), scr.paint()),
    onPointerUp: () => ((pressed.current = null), scr.paint()),
    onPointerLeave: () => ((pressed.current = null), scr.paint()),
    onPointerCancel: () => ((pressed.current = null), scr.paint()),
  })

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

  // ---- the title screen ----
  const totalStars = Object.values(stars).reduce((a, b) => a + b, 0)
  const title = (
    <TitleScreen>
      <GameStart
        id="boomfrenzy"
        title={<RetroBanner className="bfBanner" palette={pal} minW={220} minH={88} aspect={2.5} paused={paused} label="Boom Frenzy: whack the bombs before they blow!" draw={(b, t) => drawBanner(b, t, { reduced: reducedMotion() })} />}
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

  // ---- the play screen: the picture + hit boxes + panels ----
  const fieldBoxes = g && L && g.mode !== "sort" && (
    <Hit x={L.field.x} y={L.field.y} w={L.field.w} h={L.field.h} className={`bfField${E.isPanic(g) ? " is-panic" : ""}`} onPointerDown={onFieldDown} onPointerMove={onFieldMove} onPointerUp={onFieldUp} onPointerCancel={onFieldUp}>
      {g.holes.map((b, i) => {
        const h = L.holes[i]
        return <Hit key={i} x={h.x - L.field.x} y={h.y - L.field.y} w={h.w} h={h.h} className="bfHole" data-hole={i} data-bomb={b ? b.type : ""} aria-label={b ? `Hole ${i + 1}: ${E.BOMBS[b.type].name}` : `Hole ${i + 1}: empty`} />
      })}
    </Hit>
  )
  const yardBoxes = g && L && g.mode === "sort" && (
    <Hit x={L.yard.x} y={L.yard.y} w={L.yard.w} h={L.yard.h} className="bfYard" onPointerMove={onBombMove} onPointerUp={onBombUp} onPointerCancel={onBombUp}>
      {g.bombs.map((b) => (
        <div
          key={b.id}
          ref={(el) => (el ? sortEls.current.set(b.id, el) : sortEls.current.delete(b.id))}
          className="bfSortBomb"
          data-sort={b.id}
          data-color={b.color}
          aria-label={`${b.color} bomb`}
          style={{ width: 26 * (scr.fit?.css || 2), height: 30 * (scr.fit?.css || 2), left: (b.x * L.yard.w - 13) * (scr.fit?.css || 2), top: (b.y * L.yard.h - 16) * (scr.fit?.css || 2) }}
          onPointerDown={onBombDown(b.id)}
        />
      ))}
    </Hit>
  )
  const weaponBoxes = g && L && L.weapons && (
    <Hit x={L.weapons.x} y={L.weapons.y} w={L.weapons.w} h={L.weapons.h} className="bfWeapons">
      {L.buttons.map((btn, i) => (
        <Hit
          key={btn.id}
          as="button"
          x={btn.x - L.weapons.x}
          y={btn.y - L.weapons.y}
          w={btn.w}
          h={btn.h}
          className="bfWeapon"
          data-weapon={btn.id}
          disabled={!E.canUse(g, btn.id) || !running}
          onClick={() => fire(btn.id)}
          title={`${E.WEAPONS[btn.id].how} (${"JKL"[i]})`}
          aria-label={`${E.WEAPONS[btn.id].name} (costs ${E.WEAPONS[btn.id].cost})`}
          {...pressProps(btn.id)}
        />
      ))}
    </Hit>
  )
  const mult = g ? (g.mode === "sort" ? S.multFor(g.combo) : E.multFor(g.combo)) : 1
  const play = g && (
    <div className="bfBody">
      <RetroStage screen={scr} data-touch-surface className={`qgStage bfStage${g.mode !== "sort" && E.isPanic(g) ? " is-panic" : ""}`}>
        {L && (
          <>
            {fieldBoxes}
            {yardBoxes}
            {weaponBoxes}
            <Hit as="button" x={L.pause.x} y={L.pause.y} w={L.pause.w} h={L.pause.h} className="qgPauseBtn" onClick={() => setHold(true)} aria-label="Pause" title="Pause (P)" {...pressProps("pause")} />
            <div className="rtSr" aria-live="polite">
              <span data-score={g.score}>Score {g.score}</span> <span data-hearts={g.hearts}>{g.hearts} hearts</span> <span className="bfMult" data-mult={mult}>times {mult}</span>{" "}
              <span>{g.mode === "stage" ? `Stage ${g.stage}: ${g.whacked} of ${g.goal}` : g.mode === "sort" ? `${g.sorted} sorted` : `${g.whacked} whacked`}</span>
              {g.mode !== "sort" && E.isPanic(g) && <span> Panic Time!</span>}
            </div>
          </>
        )}
        {intro && (
          <RetroPanel
            title={intro.sort ? "Sort Rush" : `Stage ${intro.stage}: new bomb!`}
            buttons={<PixelButton label="Go!" big autoFocus data-go onClick={() => (setIntro(null), rootRef.current?.focus({ preventScroll: true }))} />}
          >
            {intro.sort ? (
              <PixelP text={`Drag (or flick) each bomb into the pen of its colour before its fuse burns down: red to the left, blue to the right. Green opens at the top after ${S.GREEN_AT} seconds.`} />
            ) : (
              <>
                <BombPic type={intro.bomb} scale={2} />
                <PixelText text={E.BOMBS[intro.bomb].name.toUpperCase()} color="#000080" scale={2} />
                <Sr>{E.BOMBS[intro.bomb].name}</Sr>
                <PixelP text={E.BOMBS[intro.bomb].how} />
                <PixelP text={`Whack ${E.goalFor(intro.stage)} bombs to clear the stage.`} color="#800000" />
              </>
            )}
          </RetroPanel>
        )}
        {hold && !over && <RetroPaused onResume={() => (setHold(false), rootRef.current?.focus({ preventScroll: true }))} onQuit={toTitle} />}
        {over && (
          <RetroPanel
            data-over={over.won ? "won" : "lost"}
            title={over.mode === "stage" ? (over.won ? `Stage ${over.stage} cleared!` : "Boom!") : "Game over"}
            wide
            buttons={
              <>
                {over.mode === "stage" && over.won && over.stage < E.STAGES && <PixelButton label={`Next: Stage ${over.stage + 1}`} big autoFocus data-next onClick={() => start("stage", over.stage + 1)} />}
                <PixelButton label={over.won ? "Play Again" : "Try Again"} big={!(over.won && over.stage < E.STAGES && over.mode === "stage")} autoFocus={!(over.mode === "stage" && over.won)} data-again onClick={() => start(over.mode, over.stage)} />
                <PixelButton label="Title Screen" onClick={toTitle} />
              </>
            }
          >
            {over.mode === "stage" && over.won && <Stars n={over.stars} />}
            {!over.won && <PixelP text={over.mode === "sort" ? "Out of hearts!" : "Out of hearts! The bombs got you."} color="#800000" />}
            <PixelLed text={fmtNum(over.score).replace(/,/g, "")} />
            <p className="qgFinal rtSr">{fmtNum(over.score)}</p>
            <PixelP text={`${over.whacked} ${over.mode === "sort" ? "sorted" : "whacked"} · best streak ${over.bestCombo}`} />
            {over.best && <PixelP className="qgNewBest bfNewBest" text="NEW BEST SCORE!" color="#c00000" />}
            <PixelScores rows={data.scores[over.key] || []} mark={over.place} />
          </RetroPanel>
        )}
      </RetroStage>
    </div>
  )

  return (
    <QuickGameRoot ref={rootRef} className="bfRoot" mobile={mobile} onKeyDown={onKeyDown} onKeyUp={onKeyUp} data-screen={screen}>
      <MenuBar menus={menus} />
      <GameChat game="boomfrenzy" title="Boom Frenzy" />
      {screen === "title" || !g ? title : play}

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
                  <BombPic type={t} px={1} scale={1} />
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
