import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import TouchControls, { GLYPHS, fromPx, useTouchControlsMenuItem, useTouchControlsVisible } from "../../shared/controls"
import PlayOnline, { OnlineResultBar, useOnlineRoom } from "../../shared/online"
import { unlock } from "../../../utils/achievements"
import { RulesPrimer } from "./RulesPrimer"
import { TitleMenu, QuickMenu, PlayersMenu, TourMenu, PracticeMenu, VersusMenu, SettingsMenu, ControlsMenu, LEVEL_NAMES, TIMING } from "./menus"
import { ScoreBug, Banner, HintLine, shotBanner, Meter, ReplayBug, DrillPanel, TutorialPanel, OverScreen } from "./hud"
import { clearBanners, emptyBanners, nextBannerAt, pushBanner, tickBanners } from "./banner.js"
import { layoutKey, touchControlsFor, touchPrefs } from "./touchplay.js"
import { SchemeChooser } from "./SchemeChooser"
import { CHARACTERS, VENUE_INFO, characterById, lookFor, pickOpponents } from "./looks.js"
import { freshTour, nextMatch, recordResult, tourState, unlocks } from "./career.js"
import { TUTORIAL, practiceMatch } from "./drills.js"
import { characterLook, lookForPlayer, lookPayload, validateLook, validateLooks } from "./locker.js"
import { LockerRoom } from "./LockerRoom"
import { bindingsFor, keyName } from "./input.js"
import "./Pickleball.css"
import "./Overlay.css"
import { helpItem } from "../../../utils/help"

// Pickleball 98: React draws the menus and the broadcast-style overlays. The venue, the
// players and the ball are three.js (engine.js, loaded on first open with three.js); the game
// itself is match.js and friends. Online play goes through the shared room system
// (shared/online, server/arcade/games/pickleball.js) in relay mode: see netplay.js.

const PREFS_KEY = "98ish.pickleball"
const TOUR_KEY = "98ish.pickleball.tour"
const ICON = "/assets/program_icons/pickleball.svg"
const DEFAULTS = {
  character: "maya",
  outfit: "home",
  p2: { character: "dex", outfit: "away" },
  doubles: false,
  level: "intermediate",
  opponent: "random",
  partner: "random",
  venue: "park",
  scoring: "sideout",
  target: 11,
  sound: true,
  voice: true,
  camera: "broadcast",
  // touch screens: how you hit ("classic" | "swipe"; null: asked the first time you play) and
  // which side the move pad is on. Nothing ever moves your player for you.
  scheme: null,
  padSide: "left",
  // the paddle's path drawn through each of your swings
  trail: true,
  // the one hint line shows for your first few points
  hintPoints: 0,
  // Medium shows the skinned athletes; phones can drop to Low (the old figures) in Settings
  quality: "medium",
  athletes: 1,
  aid: true,
  // (the reflex block and the rules guard only: never moves you; not a setting any more)
  assist: "reflex",
  timing: "normal",
  replays: true,
  // TV camera cuts to the server between points (optional; off unless you turn it on)
  cuts: false,
  hints: true,
  // slow motion while a hard ball comes at you at the net: "auto" (Rookie and practice), on, off
  focus: "auto",
  keys: {},
  best: {},
  // the Locker Room: saved looks by player, computer players' kits ("own" | "random"), kits
  // that follow the venue
  looks: {},
  aiLooks: "own",
  autoVenue: false,
}
const ONLINE_DEFAULTS = { format: "singles", target: 11, scoring: "sideout", venue: "stadium" }

const load = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}
const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable: lasts for this visit
  }
}
const readPrefs = () => {
  const p = { ...DEFAULTS, ...load(PREFS_KEY, {}) }
  if (typeof p.assist === "boolean") p.assist = p.assist ? "light" : "off" // older saves
  if (!["broadcast", "tv", "side", "player"].includes(p.camera)) p.camera = "broadcast"
  // once (pb7): back to the clean broadcast view, TV cuts off (the owner's phone showed the
  // old cut and the "behind you" view filling the screen with a body)
  if (!(p.v >= 7)) {
    p.camera = "broadcast"
    p.cuts = false
    p.v = 7
  }
  p.assist = "reflex"
  Object.assign(p, touchPrefs(p))
  p.trail = p.trail !== false
  p.hintPoints = Number(p.hintPoints) || 0
  p.looks = validateLooks(p.looks)
  if (!["own", "random"].includes(p.aiLooks)) p.aiLooks = "own"
  p.autoVenue = !!p.autoVenue
  // saves from before the skinned athletes kept phones on Low: move them up once
  if (!p.athletes) {
    if (p.quality === "low") p.quality = "medium"
    p.athletes = 1
  }
  return p
}
const engineSettings = (p) => ({ sound: p.sound, voice: p.voice, camera: p.camera, aid: p.aid, trail: p.trail, assist: p.assist, quality: p.quality, cuts: p.cuts, replays: p.replays, keys: p.keys, focus: p.focus || "auto", window: TIMING[p.timing] || TIMING.normal })

// on-screen controls (touchplay.js): the move pad bottom-left or bottom-right, the hit area
// everywhere else, and Pause. Camera and the controls' gear are in the pause menu.
const CAMERA_NAMES = { broadcast: "Broadcast", tv: "TV high", side: "Sideline", player: "Behind you" }
const TONE = { good: "good", bad: "bad", call: "warn", info: "ok" }

let uid = 0

// the line-up for a match against the computer
const rosterFor = ({ doubles, level, me, outfit, opponent, partner, p2, humans = 1 }) => {
  const rand = Math.random
  const exclude = [me, p2?.character].filter(Boolean)
  const pick = (id) => (id && id !== "random" ? characterById(id) : pickOpponents(rand, exclude, 1)[0])
  const cpu = (c, team, id) => {
    exclude.push(c.id)
    return { id, team, ctrl: "cpu", level, style: c.style, name: c.nick, character: c.id }
  }
  const meC = characterById(me)
  const roster = [{ id: "you", team: 0, ctrl: "human", slot: 0, name: humans > 1 ? `P1 ${meC.nick}` : meC.nick, character: me, outfit, stats: meC.stats }]
  if (doubles) roster.push(cpu(pick(partner), 0, "partner"))
  if (humans > 1) {
    const c = characterById(p2.character)
    roster.push({ id: "opp1", team: 1, ctrl: "human", slot: 1, name: `P2 ${c.nick}`, character: c.id, outfit: p2.outfit, stats: c.stats })
  } else roster.push(cpu(pick(opponent), 1, "opp1"))
  if (doubles) roster.push(cpu(pick(null), 1, "opp2"))
  return roster
}

const Pickleball = ({ onClose, mobile }) => {
  const stageRef = useRef(null)
  const canvasRef = useRef(null)
  const engineRef = useRef(null)
  const meterRefs = [useRef(null), useRef(null)]
  const timers = useRef(new Set())
  const [phase, setPhase] = useState("loading") // loading | error | title | playing | paused | over | showcase
  const [screen, setScreen] = useState("main") // main | quick | tour | practice | versus | players | settings | controls | online
  const [playersFor, setPlayersFor] = useState("p1")
  const [lockerFor, setLockerFor] = useState(null) // who the Locker Room opens on (and where it goes back to)
  const [prefs, setPrefsState] = useState(readPrefs)
  const [tour, setTourState] = useState(() => tourState(load(TOUR_KEY, freshTour())))
  const [session, setSession] = useState(null)
  const [hud, setHud] = useState(null)
  const [banners, setBanners] = useState(emptyBanners)
  const [chooser, setChooser] = useState(null) // "How do you want to play?": { go } (what starts after)
  const [result, setResult] = useState(null)
  const [reward, setReward] = useState(null)
  const [replay, setReplay] = useState(false)
  const [drill, setDrill] = useState(null) // { made, attempts, total, done, results }
  const [dialog, setDialog] = useState(null)
  const [editing, setEditing] = useState(false)
  const [stickUi, setStickUi] = useState(null)
  const [zoneHint, setZoneHint] = useState(null)
  const [toast, setToast] = useState(null)
  const touchVisible = useTouchControlsVisible()
  const controlsMenuItem = useTouchControlsMenuItem()
  const chatItem = useGameChatMenuItem("pickleball")
  const online = useOnlineRoom("pickleball")
  const showPad = mobile || touchVisible
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const sessionRef = useRef(session)
  sessionRef.current = session
  const onlineRef = useRef(online)
  onlineRef.current = online
  const pendingStart = useRef(null)
  const hellos = useRef(new Map())
  const netStarted = useRef(null)

  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.current.delete(id)
      fn()
    }, ms)
    timers.current.add(id)
  }
  // everything the overlay says goes through the one banner slot (banner.js)
  const say = (item) => setBanners((b) => pushBanner(b, item, performance.now()))
  const callout = (text, tone = "info", ms, kind = "play") => say({ kind, text, tone: TONE[tone] || "ok", ms })
  const flash = (text) => {
    const id = ++uid
    setToast({ id, text })
    later(() => setToast((t) => (t?.id === id ? null : t)), 1400)
  }

  const setPrefs = (patch) => {
    const next = { ...prefsRef.current, ...patch }
    prefsRef.current = next
    setPrefsState(next)
    save(PREFS_KEY, next)
    engineRef.current?.setSettings(engineSettings(next))
  }
  const setTour = (t) => {
    setTourState(t)
    save(TOUR_KEY, t)
  }

  // ---- engine events ----
  const onEngineEvent = (e) => {
    const s = sessionRef.current
    switch (e.type) {
      case "hit":
        if (e.mine) say(shotBanner(e))
        // they attacked: hands up
        else if (e.theirs && (e.tag === "speedup" || e.tag === "counter")) callout("Hands up!", "bad", 650, "line")
        break
      case "whiff":
        callout("Swing and a miss!", "bad", 1000)
        break
      case "line":
        callout(e.call === "In" ? "IN!" : "OUT!", e.call === "In" ? "good" : "bad", 900, "line")
        break
      case "fault":
        callout(e.call.replace(/!$/, "").toUpperCase() + "!", "call", 1500)
        break
      case "rally":
        if (e.kind === "ace") later(() => callout("ACE!", e.yours ? "good" : "bad", 1300), 300)
        else if (e.kind === "winner" && e.shots >= 3) later(() => callout(e.last?.kind === "smash" ? "PUT AWAY!" : e.last?.kind === "speedup" || e.last?.kind === "counter" ? "TOO FAST!" : "WINNER!", e.yours ? "good" : "bad", 1300), 300)
        break
      case "point": {
        if (s?.kind === "practice" || s?.kind === "tutorial") break
        // (the hint line is for your first few points only)
        if ((prefsRef.current.hintPoints || 0) < 3) setPrefs({ hintPoints: (prefsRef.current.hintPoints || 0) + 1 })
        const what = e.outcome === "side-out" ? "Side out" : e.outcome === "second-server" ? "Second server" : null
        if (what) later(() => callout(what, "info", 1200), 900)
        break
      }
      case "call":
        if (s?.kind === "practice" || s?.kind === "tutorial") break
        say({ kind: "call", over: e.server ? `${e.server} to serve` : null, text: e.call, tone: "call" })
        break
      case "replay":
        setReplay(e.on)
        break
      case "drill":
        setDrill((d) => ({ ...e, results: [...(d?.results || []), ...(e.ok === null ? [] : [e.ok])] }))
        break
      case "camera":
        flash(`Camera: ${CAMERA_NAMES[e.camera]}`)
        setPrefs({ camera: e.camera })
        break
      case "gameover":
        onGameOver(e)
        break
      default:
    }
  }
  const eventRef = useRef(onEngineEvent)
  eventRef.current = onEngineEvent

  const onGameOver = (e) => {
    const s = sessionRef.current
    setResult(e)
    setReward(null)
    if (s?.kind === "online") {
      const o = onlineRef.current
      const eng = engineRef.current
      if (o.isHost && eng) {
        // the final score reliably first: once finished, the room stops relaying snapshots
        o.sendRelay({ type: "final", winner: e.winner, score: e.score, stats: e.stats })
        o.finish({ winners: eng.seatsOf(e.winner), reason: `${e.score[e.winner]}-${e.score[1 - e.winner]}`, scores: e.score })
      }
      if (e.youWon) unlock("pickleball-online")
      return
    }
    if (s?.kind === "versus") return
    if (e.youWon) {
      unlock("pickleball-win")
      if (s?.level === "pro" || s?.level === "legend") unlock("pickleball-pro")
    }
    if (s?.kind === "tour") {
      const r = recordResult(tour, s.tour.index, e.youWon, e.score)
      setTour(r.state)
      if (r.reward) setReward(r.reward.text)
      if (r.state.champion && e.youWon) unlock("pickleball-champion")
    }
  }

  // ---- the engine (three.js loads here, on first open) ----
  useEffect(() => {
    let cancelled = false
    let engine = null
    let warm = false // ("Loading the court..." stays up while the shaders compile)
    import("./engine")
      .then(({ createEngine }) => {
        if (cancelled) return
        try {
          engine = createEngine({
            canvas: canvasRef.current,
            container: stageRef.current,
            settings: engineSettings(prefsRef.current),
            onStatus: (st) => warm && setPhase(st),
            onHud: setHud,
            onEvent: (e) => eventRef.current(e),
          })
        } catch (error) {
          console.error(error)
          setPhase("error")
          return
        }
        engineRef.current = engine
        meterRefs.forEach((r, i) => r.current && engine.setMeterEl(r.current, i))
        if (pendingStart.current) {
          const p = pendingStart.current
          pendingStart.current = null
          engine.startOnline(p)
        }
        engine.ready.then(() => {
          if (cancelled) return
          warm = true
          setPhase(engine.status)
        })
      })
      .catch((error) => {
        console.error(error)
        if (!cancelled) setPhase("error")
      })
    return () => {
      cancelled = true
      for (const id of timers.current) clearTimeout(id)
      timers.current.clear()
      engine?.dispose()
      engineRef.current = null
    }
  }, [])
  useEffect(() => {
    const e = engineRef.current
    if (e) meterRefs.forEach((r, i) => e.setMeterEl(r.current, i))
  })

  const reset = () => {
    setResult(null)
    setReward(null)
    setBanners(clearBanners)
    setDrill(null)
    setReplay(false)
  }

  // ---- starting matches ----
  // everyone's look for this match: saved Locker Room looks, computer players' kits, the venue
  const dress = (roster, venue) => roster.map((r) => (r.character ? { ...r, look: lookForPlayer(prefsRef.current, { character: r.character, outfit: r.outfit, ai: r.ctrl === "cpu" }, venue) } : r))
  const startQuick = () => {
    const p = prefsRef.current
    const venues = unlocks(tour).venues
    const venue = venues.includes(p.venue) ? p.venue : "park"
    reset()
    const roster = rosterFor({ doubles: p.doubles, level: p.level, me: p.character, outfit: p.outfit, opponent: p.opponent, partner: p.partner })
    setSession({ kind: "quick", level: p.level })
    setScreen("main")
    engineRef.current?.newMatch({ doubles: p.doubles, level: p.level, scoring: p.scoring, target: p.target, venue, roster: dress(roster, venue), humans: 1 })
  }
  const startTour = (t) => {
    const p = prefsRef.current
    reset()
    const roster = rosterFor({ doubles: false, level: t.level, me: p.character, outfit: p.outfit, opponent: t.opponent })
    setSession({ kind: "tour", tour: t, level: t.level })
    setScreen("main")
    engineRef.current?.newMatch({ doubles: false, level: t.level, scoring: "sideout", target: t.target, venue: t.venue, roster: dress(roster, t.venue), humans: 1 })
  }
  const startVersus = () => {
    const p = prefsRef.current
    reset()
    const venues = unlocks(tour).venues
    const roster = rosterFor({ doubles: p.doubles, level: "intermediate", me: p.character, outfit: p.outfit, p2: p.p2, humans: 2 })
    setSession({ kind: "versus" })
    setScreen("main")
    const venue = venues.includes(p.venue) ? p.venue : "park"
    engineRef.current?.newMatch({ doubles: p.doubles, level: "intermediate", scoring: p.scoring, target: p.target, venue, roster: dress(roster, venue), humans: 2 })
  }
  const startDrill = (d) => {
    const p = prefsRef.current
    reset()
    setSession({ kind: "practice", drill: d })
    setScreen("main")
    const pm = practiceMatch(d, { character: p.character, outfit: p.outfit })
    engineRef.current?.newMatch({ ...pm, roster: dress(pm.roster, "park"), venue: "park", humans: 1 })
  }
  const startTutorial = (i = 0) => {
    const p = prefsRef.current
    const step = TUTORIAL[i]
    reset()
    setSession({ kind: "tutorial", step: i })
    setScreen("main")
    if (!step) return quitToMenu()
    if (!step.card) engineRef.current?.newMatch({ ...practiceMatch(step, { character: p.character, outfit: p.outfit }), venue: "park", humans: 1 })
    else engineRef.current?.pause() // a card to read: the court waits
  }
  const again = () => {
    const s = sessionRef.current
    if (!s) return
    if (s.kind === "quick") startQuick()
    else if (s.kind === "tour") startTour(s.tour)
    else if (s.kind === "versus") startVersus()
    else if (s.kind === "practice") startDrill(s.drill)
  }
  const quitToMenu = () => {
    if (sessionRef.current?.kind === "online") onlineRef.current.leave()
    reset()
    setSession(null)
    setScreen("main")
    engineRef.current?.quit()
  }
  const togglePause = () => {
    const e = engineRef.current
    if (!e) return
    if (e.status === "playing") e.pause()
    else if (e.status === "paused") e.resume()
  }

  // the banner slot's clock: the next change, then look again
  useEffect(() => {
    const at = nextBannerAt(banners)
    if (at === null) return
    const id = setTimeout(() => setBanners((b) => tickBanners(b, performance.now())), Math.max(16, at - performance.now() + 5))
    return () => clearTimeout(id)
  }, [banners])
  // a replay or a pause clears what was being said
  useEffect(() => {
    if (replay || phase !== "playing") setBanners((b) => (b.current || b.queue.length ? clearBanners(b) : b))
  }, [replay, phase])

  // touch screens: how you hit is asked once, before the first match
  const withScheme = (go) => {
    if (showPad && !prefsRef.current.scheme) return setChooser({ go })
    go()
  }

  // drill bests
  useEffect(() => {
    if (!drill?.done || session?.kind !== "practice") return
    const id = session.drill.id
    const best = prefsRef.current.best || {}
    if (!(best[id] >= drill.made)) setPrefs({ best: { ...best, [id]: drill.made } })
  }, [drill?.done])

  // ---- online ----
  const onlinePlaying = online.room && (online.phase === "playing" || online.phase === "over")
  useEffect(() => {
    if (online.room && screen !== "online") setScreen("online")
  }, [online.room?.id])
  const startOnlineEngine = (opts) => {
    const e = engineRef.current
    reset()
    setSession({ kind: "online" })
    if (e) e.startOnline(opts)
    else pendingStart.current = opts
  }
  const hostStart = () => {
    const o = onlineRef.current
    const room = o.room
    if (!room || !o.isHost || room.phase !== "playing") return
    const key = `${room.id}:${room.round}`
    if (netStarted.current === key) return
    netStarted.current = key
    const people = room.seats.map((s, seat) => (s && !s.bot ? { seat, name: s.name, ...(hellos.current.get(seat) || {}) } : null)).filter(Boolean)
    const settings = { ...ONLINE_DEFAULTS, ...room.settings }
    const start = { people, settings: { doubles: settings.format === "doubles", target: settings.target, scoring: settings.scoring, venue: settings.venue }, seed: (Math.random() * 1e9) | 0 }
    netStarted.start = start
    o.sendRelay({ type: "start", ...start })
    startOnlineEngine({ role: "host", seat: room.you, ...start, send: { snap: o.sendSnap, relay: (d, to) => o.sendRelay(d, to) } })
  }
  const roundKey = online.room && online.phase === "playing" ? `${online.room.id}:${online.room.round}` : null
  useEffect(() => {
    if (!roundKey) return
    const p = prefsRef.current
    // (your look for this room's venue, checked again by the server and the host)
    const myLook = lookPayload(lookForPlayer(p, { character: p.character, outfit: p.outfit }, online.room?.settings?.venue || null))
    // (a guest's hello can beat this effect here: keep this round's hellos, start fresh only for a
    // new round)
    if (hellos.key !== roundKey) {
      hellos.current = new Map()
      hellos.key = roundKey
    }
    hellos.current.set(online.seat, { character: p.character, outfit: p.outfit, look: myLook })
    if (online.isHost) {
      // wait a moment for everyone's "this is me" (their player and outfit), then go
      const humans = online.room.seats.filter((s) => s && !s.bot).length
      if (humans <= 1) hostStart()
      else later(hostStart, 1600)
    } else online.sendRelay({ type: "hello", character: p.character, outfit: p.outfit, look: myLook })
  }, [roundKey])
  // the relay: snapshots, inputs, hellos, starts and hits
  useEffect(() => {
    const offSnap = online.onSnap((d) => engineRef.current?.netSnap(d))
    const offInput = online.onInput((d, from) => engineRef.current?.netInput(d, from))
    const offRelay = online.onRelay((d, from) => {
      const o = onlineRef.current
      if (!d || typeof d !== "object") return
      if (d.type === "hello" && o.isHost) {
        const round = o.room ? `${o.room.id}:${o.room.round}` : null
        if (hellos.key !== round) {
          hellos.current = new Map()
          hellos.key = round
        }
        const character = CHARACTERS.some((c) => c.id === d.character) ? d.character : null
        const outfit = typeof d.outfit === "string" ? d.outfit : "home"
        hellos.current.set(from, { character, outfit, look: d.look && typeof d.look === "object" ? lookPayload(validateLook(d.look, characterLook(character || "maya", outfit))) : null })
        const key = o.room ? `${o.room.id}:${o.room.round}` : null
        if (netStarted.current === key && netStarted.start) o.sendRelay({ type: "start", ...netStarted.start }, from) // a late (re)joiner
        else {
          const humans = o.room?.seats.filter((s) => s && !s.bot).length || 0
          if (hellos.current.size >= humans) hostStart()
        }
      } else if (d.type === "start" && !o.isHost && o.seat !== null && Array.isArray(d.people)) {
        const key = o.room ? `${o.room.id}:${o.room.round}` : null
        if (netStarted.current === key && engineRef.current?.online) return
        netStarted.current = key
        startOnlineEngine({ role: "guest", seat: o.seat, people: d.people, settings: d.settings || {}, seed: d.seed, send: { input: o.sendInput, relay: (x) => o.sendRelay(x) } })
      } else if (d.type === "hit") engineRef.current?.netRelay(d, from)
      else if (d.type === "final" && !o.isHost) engineRef.current?.netFinal(d)
    })
    return () => {
      offSnap()
      offInput()
      offRelay()
    }
  }, [])
  // someone's connection dropped: everyone waits (the server keeps their seat 30 seconds)
  const awayNames = online.room && online.phase === "playing" ? online.room.seats.filter((s, i) => s && s.away && i !== online.seat).map((s) => s.name) : []
  const netWait = online.phase === "playing" ? (!online.connected ? "Reconnecting to the game server..." : awayNames.length ? `Waiting for ${awayNames.join(" and ")} to reconnect...` : null) : null
  useEffect(() => {
    engineRef.current?.setNetWait(netWait)
  }, [netWait])
  // back in the lobby (someone left) or out of the room: stop the online match
  useEffect(() => {
    if (session?.kind === "online" && (!online.room || online.phase === "lobby")) {
      netStarted.current = null
      reset()
      setSession(null)
      engineRef.current?.quit()
    }
  }, [online.phase, online.room?.id])

  const onKeyDown = (e) => {
    if (e.key === "F2") {
      e.preventDefault()
      if (session && session.kind !== "online") withScheme(again)
      else withScheme(startQuick)
    }
  }

  // ---- the joystick: the "move" zone of the on-screen controls (and aiming in the hit zones) ----
  const stick = useRef(null)
  const knobRef = useRef(null)
  const aimTouch = useRef(null)
  const swipeTouch = useRef(null) // Swipe: { id, pts: [{ x, y, t }] }
  const schemeRef = useRef(prefs.scheme)
  schemeRef.current = prefs.scheme || "swipe"
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !showPad) return
    const R = 48
    const down = (e) => {
      // the hit zones: the finger aims (on their court: right there; elsewhere: drag)
      if (!aimTouch.current && !swipeTouch.current && e.target.closest?.('[data-control="hit"], [data-control="hitTop"]')) {
        if (schemeRef.current === "swipe") {
          swipeTouch.current = { id: e.pointerId, pts: [{ x: e.clientX, y: e.clientY, t: performance.now() }] }
          engineRef.current?.swipe("start", swipeTouch.current.pts)
          return
        }
        aimTouch.current = e.pointerId
        engineRef.current?.touchAim("start", e.clientX, e.clientY)
        return
      }
      if (stick.current || !e.target.closest?.('[data-control="move"]')) return
      const r = stage.getBoundingClientRect()
      stick.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY }
      setStickUi({ x: e.clientX - r.left, y: e.clientY - r.top })
    }
    const move = (e) => {
      const sw = swipeTouch.current
      if (sw && sw.id === e.pointerId) {
        sw.pts.push({ x: e.clientX, y: e.clientY, t: performance.now() })
        if (sw.pts.length > 64) sw.pts.splice(1, 1)
        engineRef.current?.swipe("move", sw.pts)
        return
      }
      if (aimTouch.current === e.pointerId) {
        engineRef.current?.touchAim("move", e.clientX, e.clientY)
        return
      }
      const s = stick.current
      if (!s || s.id !== e.pointerId) return
      let dx = e.clientX - s.x0
      let dy = e.clientY - s.y0
      const d = Math.hypot(dx, dy)
      if (d > R) {
        dx = (dx / d) * R
        dy = (dy / d) * R
      }
      const live = d > 6
      engineRef.current?.setStick(live ? dx / R : 0, live ? -dy / R : 0)
      // (the knob moves straight in the page: a React render per finger move cost frames)
      if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`
    }
    const up = (e) => {
      const sw = swipeTouch.current
      if (sw && sw.id === e.pointerId) {
        swipeTouch.current = null
        sw.pts.push({ x: e.clientX, y: e.clientY, t: performance.now() })
        engineRef.current?.swipe(e.type === "pointercancel" ? "cancel" : "end", sw.pts)
        return
      }
      if (aimTouch.current === e.pointerId) {
        aimTouch.current = null
        engineRef.current?.touchAim("end")
        return
      }
      if (!stick.current || stick.current.id !== e.pointerId) return
      stick.current = null
      engineRef.current?.setStick(0, 0)
      setStickUi(null)
    }
    stage.addEventListener("pointerdown", down, true)
    stage.addEventListener("pointermove", move, true)
    stage.addEventListener("pointerup", up, true)
    stage.addEventListener("pointercancel", up, true)
    const measure = () => {
      const zone = stage.querySelector('[data-control="move"]')
      if (!zone) return setZoneHint(null)
      const r = stage.getBoundingClientRect()
      const z = zone.getBoundingClientRect()
      setZoneHint((h) => {
        const next = { x: z.left - r.left + z.width / 2, y: z.top - r.top + z.height / 2 }
        return h && Math.abs(h.x - next.x) < 1 && Math.abs(h.y - next.y) < 1 ? h : next
      })
    }
    const t = setInterval(measure, 600)
    measure()
    return () => {
      clearInterval(t)
      stage.removeEventListener("pointerdown", down, true)
      stage.removeEventListener("pointermove", move, true)
      stage.removeEventListener("pointerup", up, true)
      stage.removeEventListener("pointercancel", up, true)
    }
  }, [showPad])

  const padSide = prefs.padSide
  const scheme = prefs.scheme || "swipe"
  const controls = useMemo(() => touchControlsFor(padSide, fromPx, scheme).map((c) => (c.id === "pause" ? { ...c, icon: GLYPHS.pause } : c)), [padSide, scheme])
  const padPress = (action) => {
    const e = engineRef.current
    if (!e || action === "move") return
    if (action === "pause") return e.online ? setDialog("menu") : togglePause()
    if (replay) return e.skipReplay()
    // (Swipe: the stage's own listeners read the finger's path)
    if (action === "hit" && schemeRef.current !== "swipe") e.shotDown("hit")
  }
  const padRelease = (action) => {
    if (action === "hit" && schemeRef.current !== "swipe") engineRef.current?.shotUp("hit")
  }
  useEffect(() => {
    if (editing && engineRef.current?.status === "playing") engineRef.current.pause()
  }, [editing])
  const setEditingAndFocus = (value) => {
    setEditing(value)
    if (!value) stageRef.current?.focus({ preventScroll: true })
  }

  // the players screen shows the character in 3D
  const preview = (id, outfit) => engineRef.current?.showcase(prefsRef.current.looks?.[id] ? validateLook(prefsRef.current.looks[id], characterLook(id)) : lookFor(id, outfit))
  const closePlayers = (to = playersFor === "p2" || playersFor === "p1v" ? "versus" : "main") => {
    engineRef.current?.showcase(null)
    setScreen(to)
  }

  const inGame = phase === "playing" || phase === "paused" || phase === "over"
  const atMenu = !inGame && phase !== "loading" && phase !== "error"
  const isOnline = session?.kind === "online"
  const b = bindingsFor(prefs.keys)
  const keyText = (s) =>
    s
      .replace("{move}", showPad ? `the pad (drag on the ${padSide})` : `${keyName(b.solo.up[0])}${keyName(b.solo.left[0])}${keyName(b.solo.down[0])}${keyName(b.solo.right[0])} or the arrows`)
      .replace(/\{hit\}/g, showPad ? (scheme === "swipe" ? "swiping up (anywhere off the pad; a tap is soft)" : "touching the screen (anywhere off the pad)") : `${keyName(b.solo.hit[0])} or the left mouse button`)
      .replace(/\{aim\}/g, showPad ? (scheme === "swipe" ? "the swipe: its direction is where, its length how deep" : "your finger: touch their court where you want it (or drag)") : "the mouse: point at their court")

  const menus = [
    {
      label: "Game",
      items: [
        { label: "Quick Match (F2)", onClick: startQuick },
        { label: "World Tour...", onClick: () => (quitToMenu(), setScreen("tour")) },
        { label: "Practice...", onClick: () => (quitToMenu(), setScreen("practice")) },
        { label: "2 Players...", onClick: () => (quitToMenu(), setScreen("versus")) },
        { label: "Locker Room...", onClick: () => (session?.kind !== "online" && quitToMenu(), setLockerFor(null), setScreen("locker")) },
        { label: "Play Online...", onClick: () => (session?.kind !== "online" && quitToMenu(), setScreen("online")) },
        "-",
        { label: phase === "paused" ? "Resume (P)" : "Pause (P)", disabled: (phase !== "playing" && phase !== "paused") || isOnline, onClick: togglePause },
        { label: "Quit to Main Menu", disabled: !session, onClick: quitToMenu },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    {
      label: "Options",
      items: [
        { label: "Sound", checked: prefs.sound, onClick: () => setPrefs({ sound: !prefs.sound }) },
        { label: "Umpire Voice", checked: prefs.voice, onClick: () => setPrefs({ voice: !prefs.voice }) },
        { label: "Shot Guides", checked: prefs.aid, onClick: () => setPrefs({ aid: !prefs.aid }) },
        { label: "Swing Trail", checked: prefs.trail, onClick: () => setPrefs({ trail: !prefs.trail }) },
        { label: "Instant Replays", checked: prefs.replays, onClick: () => setPrefs({ replays: !prefs.replays }) },
        "-",
        ...[
          ["broadcast", "Camera: Broadcast"],
          ["tv", "Camera: TV High"],
          ["side", "Camera: Sideline"],
          ["player", "Camera: Behind You"],
        ].map(([v, l]) => ({ label: l, checked: prefs.camera === v, onClick: () => setPrefs({ camera: v }) })),
        "-",
        ...[
          ["low", "Graphics: Low"],
          ["medium", "Graphics: Medium"],
          ["high", "Graphics: High"],
        ].map(([v, l]) => ({ label: l, checked: prefs.quality === v, onClick: () => setPrefs({ quality: v }) })),
        "-",
        { label: "Settings...", onClick: () => setDialog("settings") },
        { label: "Controls...", onClick: () => setDialog("controls") },
        { label: "Touch: Classic (aim + hold)", checked: showPad && scheme === "classic", disabled: !showPad, onClick: () => setPrefs({ scheme: "classic" }) },
        { label: "Touch: Swipe", checked: showPad && scheme === "swipe", disabled: !showPad, onClick: () => setPrefs({ scheme: "swipe" }) },
        { label: "Move Pad on the Right", checked: padSide === "right", disabled: !showPad, onClick: () => setPrefs({ padSide: padSide === "right" ? "left" : "right" }) },
        controlsMenuItem,
        { label: "Customize Touch Controls...", disabled: !showPad, onClick: () => setEditing(true) },
        "-",
        chatItem,
      ],
    },
    {
      label: "Help",
      items: [helpItem({ program: "Pickleball 98" }), "-",
        { label: "Tutorial", onClick: () => startTutorial(0) },
        { label: "Rules Primer...", onClick: () => setDialog("rules") },
        { label: "Controls...", onClick: () => setDialog("controls") },
        "-",
        { label: "About Pickleball 98...", onClick: () => setDialog("about") },
      ],
    },
  ]

  const tutorialStep = session?.kind === "tutorial" ? TUTORIAL[session.step] : null
  const cycleCam = () => engineRef.current?.cycleCamera()
  const dimPress = useRef(false)
  const onlineText = isOnline && online.room ? `${online.room.code ? `Room ${online.room.code} · ` : ""}online` : null
  const serveTime = !!hud?.yourServe || (hud?.serveSlot !== null && hud?.serveSlot !== undefined)
  const hintText = showPad
    ? scheme === "swipe"
      ? serveTime
        ? "Your serve: swipe up toward their box"
        : "Swipe up toward the target · tap = dink"
      : serveTime
        ? "Your serve: touch where it goes, hold, let go in the green"
        : "Touch their court to aim · tap soft, hold hard"
    : (hud?.humans || 1) >= 2
      ? "Hold hit for pace, let go as the ball comes · move keys steer the aim · P pause"
      : serveTime
        ? `Hold ${keyName(b.solo.hit[0])} (or click) to serve, let go in the green`
        : `Point at their court · ${keyName(b.solo.hit[0])} or click: tap soft, hold hard · C camera · P pause`

  return (
    <div className={`pkRoot${mobile ? " is-mobile" : ""}`} onKeyDown={onKeyDown}>
      <MenuBar menus={menus} />
      <GameChat game="pickleball" title="Pickleball 98" room={online.chatRoom} />
      <div className="pkStage" ref={stageRef} tabIndex={0} data-phase={phase} data-screen={screen}>
        <canvas className="pkCanvas" ref={canvasRef} aria-label="Pickleball court" />

        {phase === "loading" && <div className="pkCenter pkLoading">Loading the court...</div>}
        {phase === "error" && (
          <div className="pkCenter">
            <div className="pkPanel">
              <b>Can't start Pickleball 98</b>
              <p>This game needs WebGL graphics, which this browser or device doesn't have available right now. Try turning on hardware acceleration in your browser's settings, or another browser.</p>
            </div>
          </div>
        )}

        {/* ---------- in a match ---------- */}
        {inGame && hud && !tutorialStep?.card && session?.kind !== "practice" && session?.kind !== "tutorial" && <ScoreBug hud={hud} online={onlineText} />}
        {inGame && <Banner banner={banners.current} />}
        <Meter ref={meterRefs[0]} slot={0} />
        <Meter ref={meterRefs[1]} slot={1} />
        {phase === "playing" && replay && <ReplayBug touch={showPad} />}
        {phase === "playing" && prefs.hints && (prefs.hintPoints || 0) < 3 && !replay && session && session.kind !== "tutorial" && session.kind !== "practice" && <HintLine text={hintText} />}
        {toast && <div key={toast.id} className="pkToast">{toast.text}</div>}
        {inGame && hud?.netWait && (
          <div className="pkCenter pkDim">
            <div className="pkPanel">
              <b>Paused</b>
              <p>{hud.netWait}</p>
              <p className="pkMuted">The game picks up right where it left off.</p>
            </div>
          </div>
        )}
        {inGame && session?.kind === "practice" && <DrillPanel drill={session.drill} progress={drill} onQuit={() => (quitToMenu(), setScreen("practice"))} onRetry={() => startDrill(session.drill)} />}
        {tutorialStep && (
          <TutorialPanel
            step={tutorialStep}
            index={session.step}
            total={TUTORIAL.length}
            text={keyText(tutorialStep.text)}
            progress={drill}
            onNext={() => (session.step + 1 >= TUTORIAL.length ? (setPrefs({ tutorialDone: true }), quitToMenu()) : startTutorial(session.step + 1))}
            onQuit={quitToMenu}
          />
        )}

        {phase === "paused" && !editing && !dialog && !tutorialStep?.card && (
          // (a tap outside the panel resumes, but only a tap that started there: the press on
          // Pause that brought this up mustn't let go on it and resume at once)
          <div className="pkCenter pkDim" onPointerDown={(e) => (dimPress.current = e.target === e.currentTarget)} onClick={(e) => dimPress.current && e.target === e.currentTarget && engineRef.current?.resume()}>
            <div className="pkPanel pkPause" onClick={(e) => e.stopPropagation()}>
              <b>Paused</b>
              <div className="pkPauseMenu">
                <button type="button" className="pkPrimary" onClick={() => engineRef.current?.resume()} autoFocus>
                  Resume
                </button>
                {session && session.kind !== "tutorial" && (
                  <button type="button" onClick={again}>
                    Restart
                  </button>
                )}
                <button type="button" onClick={cycleCam} data-action="camera">
                  Camera: {CAMERA_NAMES[prefs.camera] || "Broadcast"}
                </button>
                <button type="button" onClick={() => setDialog("settings")}>
                  Settings
                </button>
                {!showPad && (
                  <button type="button" onClick={() => setDialog("controls")}>
                    Controls
                  </button>
                )}
                {showPad && (
                  <button type="button" onClick={() => setEditing(true)}>
                    Move Touch Buttons
                  </button>
                )}
                <button type="button" onClick={quitToMenu}>
                  Quit to Menu
                </button>
              </div>
            </div>
          </div>
        )}

        {phase === "over" && result && !isOnline && (
          <OverScreen
            result={result}
            session={session}
            reward={reward}
            onAgain={session?.kind === "tour" && result.youWon ? null : again}
            onNext={session?.kind === "tour" && result.youWon && nextMatch(tour) ? () => startTour(nextMatch(tour)) : null}
            onMenu={quitToMenu}
          />
        )}
        {isOnline && online.phase === "over" && result && (
          <OverScreen result={result} session={{ kind: "online" }}>
            <OnlineResultBar online={online} />
          </OverScreen>
        )}
        {isOnline && online.phase === "over" && !result && <OnlineResultBar online={online} />}

        {/* ---------- menus ---------- */}
        {atMenu && screen === "main" && phase === "title" && <TitleMenu onPick={(s) => (s === "rules" ? setDialog("rules") : s === "settings" ? setDialog("settings") : s === "controls" ? setDialog("controls") : (setPlayersFor("p1"), setScreen(s)))} onOnline={() => setScreen("online")} tour={tour} showPad={showPad} />}
        {atMenu && screen === "quick" && <QuickMenu prefs={prefs} setPrefs={setPrefs} tour={tour} onStart={() => withScheme(startQuick)} onBack={() => setScreen("main")} onPlayers={() => (setPlayersFor("p1q"), setScreen("players"))} />}
        {(atMenu || phase === "showcase") && screen === "locker" && (
          <LockerRoom
            prefs={prefs}
            setPrefs={setPrefs}
            engine={() => engineRef.current}
            initial={lockerFor?.who || prefs.character}
            onBack={() => {
              engineRef.current?.showcase(null)
              setScreen(lockerFor?.back || "main")
              setLockerFor(null)
            }}
          />
        )}
        {(atMenu || phase === "showcase") && screen === "players" && (
          <PlayersMenu
            prefs={prefs}
            setPrefs={setPrefs}
            tour={tour}
            slot={playersFor === "p2" ? "p2" : "p1"}
            title={playersFor === "p2" ? "Player 2: Choose Your Player" : "Choose Your Player"}
            onPreview={preview}
            onLocker={(who) => (setLockerFor({ who, back: "players" }), setScreen("locker"))}
            onBack={() => closePlayers(playersFor === "p1q" ? "quick" : playersFor === "p2" || playersFor === "p1v" ? "versus" : "main")}
          />
        )}
        {atMenu && screen === "tour" && <TourMenu tour={tour} onPlay={(t) => withScheme(() => startTour(t))} onBack={() => setScreen("main")} onReset={() => setTour(freshTour())} />}
        {atMenu && screen === "practice" && <PracticeMenu best={prefs.best} onTutorial={() => withScheme(() => startTutorial(0))} onDrill={(d) => withScheme(() => startDrill(d))} onBack={() => setScreen("main")} />}
        {atMenu && screen === "versus" && <VersusMenu prefs={prefs} setPrefs={setPrefs} tour={tour} showPad={showPad} onStart={startVersus} onBack={() => setScreen("main")} onPlayers={(who) => (setPlayersFor(who === "p2" ? "p2" : "p1v"), setScreen("players"))} />}
        {screen === "online" && !onlinePlaying && phase !== "loading" && (
          <div className="pkOnline">
            <PlayOnline
              online={online}
              title="Pickleball 98"
              icon={ICON}
              blurb="Singles or doubles against people anywhere: Quick Match, a private room with a code, or invite someone. You play your own player; everyone else's moves come over the network."
              defaultSettings={ONLINE_DEFAULTS}
              quickSettings
              renderSettings={(s, set, { disabled }) => (
                <div className="pkOnlineSettings">
                  <label>
                    Format{" "}
                    <select disabled={disabled} value={s.format} onChange={(e) => set({ ...s, format: e.target.value })}>
                      <option value="singles">Singles (1 v 1)</option>
                      <option value="doubles">Doubles (2 v 2, computer partners fill in)</option>
                    </select>
                  </label>
                  <label>
                    Game to{" "}
                    <select disabled={disabled} value={s.target} onChange={(e) => set({ ...s, target: Number(e.target.value) })}>
                      {[7, 11, 15].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Scoring{" "}
                    <select disabled={disabled} value={s.scoring} onChange={(e) => set({ ...s, scoring: e.target.value })}>
                      <option value="sideout">Side-out</option>
                      <option value="rally">Rally</option>
                    </select>
                  </label>
                  <label>
                    Venue{" "}
                    <select disabled={disabled} value={s.venue} onChange={(e) => set({ ...s, venue: e.target.value })}>
                      {Object.values(VENUE_INFO).map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} ({v.time})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              onBack={() => {
                online.leave()
                setScreen("main")
              }}
              extra={
                <span className="pkMuted">
                  Playing as <b>{characterById(prefs.character).nick}</b>{" "}
                  <button type="button" onClick={() => (setPlayersFor("p1"), setScreen("players"))} disabled={!!online.room}>
                    Change
                  </button>
                </span>
              }
            />
          </div>
        )}

        {showPad && stickUi && (
          <div className="pkStick" style={{ left: stickUi.x, top: stickUi.y }} aria-hidden="true">
            <div className="pkKnob" ref={knobRef} />
          </div>
        )}
        {showPad && !stickUi && zoneHint && phase === "playing" && !editing && (
          <div className="pkStick pkStick--hint" style={{ left: zoneHint.x, top: zoneHint.y }} aria-hidden="true">
            <div className="pkKnob" />
          </div>
        )}
        {showPad && phase !== "loading" && phase !== "error" && (
          <TouchControls
            key={layoutKey(padSide)}
            game={layoutKey(padSide)}
            gear={false}
            controls={controls}
            onPress={padPress}
            onRelease={padRelease}
            show={phase === "playing" && !tutorialStep?.card && !(isOnline && online.phase === "over")}
            editing={editing}
            onEditingChange={setEditingAndFocus}
          />
        )}
      </div>

      {chooser && (
        <SchemeChooser
          padSide={padSide}
          current={prefs.scheme}
          onPadSide={(v) => setPrefs({ padSide: v })}
          onCancel={chooser.go ? null : () => setChooser(null)}
          onPick={(v) => {
            setPrefs({ scheme: v })
            const go = chooser.go
            setChooser(null)
            go?.()
          }}
        />
      )}
      {dialog === "rules" && <RulesPrimer onClose={() => setDialog(null)} />}
      {dialog === "settings" && (
        <div className="pkDialogLayer">
          <SettingsMenu prefs={prefs} setPrefs={setPrefs} showPad={showPad} onChooseScheme={() => (setDialog(null), setChooser({ go: null }))} onBack={() => setDialog(null)} onControls={() => setDialog("controls")} onTouchEdit={() => (setDialog(null), setEditing(true))} />
        </div>
      )}
      {dialog === "controls" && (
        <div className="pkDialogLayer">
          <ControlsMenu prefs={prefs} setPrefs={setPrefs} showPad={showPad} onBack={() => setDialog(null)} />
        </div>
      )}
      {dialog === "menu" && (
        <Dialog title="Pickleball 98" onOk={() => setDialog(null)}>
          <p className="dialogText">Online matches don't pause. Leave the match?</p>
          <div className="pkRow pkRowCenter">
            <button type="button" onClick={cycleCam}>
              Camera: {CAMERA_NAMES[prefs.camera] || "Broadcast"}
            </button>
            <button type="button" onClick={() => (setDialog(null), quitToMenu())}>
              Leave Match
            </button>
          </div>
        </Dialog>
      )}
      {dialog === "about" && (
        <Dialog title="About Pickleball 98" onOk={() => setDialog(null)}>
          <p className="dialogText">
            Pickleball 98 plays on a regulation 20 x 44 ft court with a 34 in net at the center. The ball is a 26 g, 74 mm
            outdoor ball with real drag, spin and bounce; every player (you, the computer, and people online) uses the same
            physics and the same USA Pickleball rules.
            <br />
            <br />
            One hit control: aim at their court, tap for touch (dinks, drops, resets), hold for pace (drives, speed-ups, counters), and let go on the beat. Every player here is made up.
            <br />
            <br />
            Character models, eyes, brows and hairstyles: MakeHuman (makehumancommunity.org) base mesh, targets, proxies and
            system assets, CC0 public domain. Older character models and motion clips: Universal Base Characters and Universal
            Animation Library by Quaternius (quaternius.com), CC0 public domain. Clothes, shoes, hats, paddles and swings are
            made in the game.
            <br />
            <br />
            Footwork and gestures are motion capture: the 100STYLE dataset by Ian Mason, Sebastian Starke and Taku Komura
            (zenodo.org/records/8127870, CC BY 4.0; retargeted and trimmed) and the CMU Graphics Lab Motion Capture Database
            (mocap.cs.cmu.edu; the database was created with funding from NSF EIA-0196217).
          </p>
        </Dialog>
      )}
    </div>
  )
}

export { LEVEL_NAMES }
export default Pickleball
