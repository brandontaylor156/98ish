import React, { useEffect, useMemo, useRef, useState } from "react"
import Combo from "../../shared/select/Combo"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import TouchControls, { GLYPHS, fromPx, useTouchControlsMenuItem, useTouchControlsVisible } from "../../shared/controls"
import PlayOnline, { OnlineResultBar, useOnlineRoom } from "../../shared/online"
import { unlock } from "../../../utils/achievements"
import { RulesPrimer } from "./RulesPrimer"
import { TitleMenu, QuickMenu, PlayersMenu, TourMenu, VersusMenu, SettingsMenu, ControlsMenu, LEVEL_NAMES, TIMING } from "./menus"
import { ScoreBug, Banner, HintLine, shotBanner, Meter, ReplayBug, TutorialPanel, OverScreen } from "./hud"
import { clearBanners, emptyBanners, nextBannerAt, pushBanner, tickBanners } from "./banner.js"
import { layoutKey, readSwipe, touchControlsFor, touchPrefs } from "./touchplay.js"
import { createTrailCanvas } from "./trailcanvas.js"
import { SHOT_COLORS, bandOf, swipeLook } from "./swipetrail.js"
import { paceOf } from "./shots.js"
import { SchemeChooser } from "./SchemeChooser"
import { PracticeHub, FirstTimeOffer } from "./practice/PracticeHub"
import { PracticeHud } from "./practice/PracticeHud"
import { machineSpec, trainMatch } from "./practice/session.js"
import { DRILLS, drillById, drillStars } from "./practice/drillbook.js"
import { LESSONS, lessonById, nextLesson } from "./practice/lessons.js"
import { CHARACTERS, VENUE_INFO, characterById, lookFor, pickOpponents } from "./looks.js"
import { freshTour, nextMatch, recordResult, tourState, unlocks } from "./career.js"
import { TUTORIAL, practiceMatch } from "./drills.js"
import { characterLook, lookForPlayer, lookPayload, validateLook, validateLooks } from "./locker.js"
import { LockerRoom } from "./LockerRoom"
import { bindingsFor, keyName } from "./input.js"
import "./Pickleball.css"
import "./Overlay.css"
import { helpItem } from "../../../utils/help"
import { getClone } from "./twin/clone/store.js"
import { cloneLevel } from "./twin/clone/profile.js"
// Real Games (the pickleball you play in real life: sessions, scorekeeper, matches, ladder; applets/pbclub, server/pbclub)
const RealGames = React.lazy(() => import("../pbclub/PbClub"))
import ParkLoading from "./park/ParkLoading"
// let the browser paint (the loading screen) before a step that blocks the page
const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
import { ParkHud, ParkIntro, ParkMenu, ParkResult, ParkTurn, RealFriendsBar, VoiceChip } from "./park/ParkHud"
import { useParkVoice } from "./park/useParkVoice.js"
import { badgeText, friendsAt } from "./park/presence.js"
import { useLiveCourt } from "./twin/live/useLiveCourt.js"
import { useLocate } from "../../../utils/locate"
import { useAim } from "../aim/AimContext"
// Venue Finder: any pickleball venue on Earth (park/live/)
import { FinderPanel } from "./park/live/FinderPanel"
import { isLiveId } from "./park/live/liveVenue.js"
import { VENUE_LIST } from "./park/venues/index.js"
import { usePark } from "./park/usePark"
import { recordGame, validRep } from "./park/rep.js"
import { COURTS as PARK_COURTS, LEVEL_NAMES as PARK_LEVELS } from "./park/layout.js"
// Twin Replay: film a real game, watch it here (twin/; loaded when opened)
const TwinReplay = React.lazy(() => import("./twin/TwinReplay.jsx"))
// Live Broadcast (twin/live/): go live from the fence, or watch a friend's game live in 3D
const GoLive = React.lazy(() => import("./twin/live/GoLive.jsx"))
const LiveWatch = React.lazy(() => import("./twin/live/LiveWatch.jsx"))

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
  // touch: your finger's swipe drawn on the screen (Classic: a ripple where you touch)
  swipeTrail: true,
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
  p.swipeTrail = p.swipeTrail !== false
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
const rosterFor = ({ doubles, level, me, outfit, opponent, opponent2 = null, partner, p2, humans = 1 }) => {
  const rand = Math.random
  const exclude = [me, p2?.character].filter(Boolean)
  const pick = (id) => (id && id !== "random" && !String(id).startsWith("clone:") ? characterById(id) : pickOpponents(rand, exclude, 1)[0])
  // a Twin Clone (twin/clone/): "clone:<id>" plays with the level measured from that person
  const cloneEntry = (id, team, rid) => {
    const prof = getClone(String(id).slice(6))
    if (!prof) return null
    const c = prof.character ? characterById(prof.character) : pick(null)
    exclude.push(c.id)
    return { id: rid, team, ctrl: "cpu", level: cloneLevel(prof), name: prof.name, character: c.id, hand: prof.hand, clone: prof.id }
  }
  const cpu = (c, team, id, want = null) => {
    if (want && String(want).startsWith("clone:")) {
      const e = cloneEntry(want, team, id)
      if (e) return e
    }
    exclude.push(c.id)
    return { id, team, ctrl: "cpu", level, style: c.style, name: c.nick, character: c.id }
  }
  const meC = characterById(me)
  const roster = [{ id: "you", team: 0, ctrl: "human", slot: 0, name: humans > 1 ? `P1 ${meC.nick}` : meC.nick, character: me, outfit, stats: meC.stats }]
  if (doubles) roster.push(cpu(pick(partner), 0, "partner", partner))
  if (humans > 1) {
    const c = characterById(p2.character)
    roster.push({ id: "opp1", team: 1, ctrl: "human", slot: 1, name: `P2 ${c.nick}`, character: c.id, outfit: p2.outfit, stats: c.stats })
  } else roster.push(cpu(pick(opponent), 1, "opp1", opponent))
  if (doubles) roster.push(cpu(pick(opponent2), 1, "opp2", opponent2))
  return roster
}

const Pickleball = ({ onClose, mobile, handoff }) => {
  const stageRef = useRef(null)
  const canvasRef = useRef(null)
  const engineRef = useRef(null)
  const meterRefs = [useRef(null), useRef(null)]
  const timers = useRef(new Set())
  const [phase, setPhase] = useState("loading") // loading | error | title | playing | paused | over | showcase
  const [screen, setScreen] = useState("main") // main | quick | tour | practice | versus | players | settings | controls | online | club
  const [twinBack, setTwinBack] = useState("main") // where Twin Replay goes back to (Real Games opens it too)
  const [twinView, setTwinView] = useState(null) // Twin Replay opening straight on Coach
  const [clubHandoff, setClubHandoff] = useState(null) // a Real Games session/match to show (a notification or deep link)
  const [watchFor, setWatchFor] = useState(null) // { id, code } a live game to watch (Live Broadcast)
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
  const [drill, setDrill] = useState(null) // the tutorial's progress: { made, attempts, total, done, results }
  // practice sessions (practice/): the session's latest report, the lesson tip card, the hub
  // screen to go back to, and whether this is the first time Pickleball 98 has been opened
  const [train, setTrain] = useState(null) // { snap, result, cue }
  const [trainIntro, setTrainIntro] = useState(false)
  const [hubView, setHubView] = useState("hub")
  const [firstTime] = useState(() => {
    try {
      return localStorage.getItem(PREFS_KEY) === null
    } catch {
      return false
    }
  })
  const layerRef = useRef(null)
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
  // My Park (park/): the world (kept while you're in the park, also through a game or the
  // Locker Room), what its HUD shows, and the cards over it
  const parkRef = useRef(null)
  const parkLabelsRef = useRef(null)
  const parkGameRef = useRef(null) // { court, kind: "solo" | "room" | "machine" | "locker", level }
  const parkEventRef = useRef(null)
  const [parkWorld, setParkWorld] = useState(null)
  const [parkHud, setParkHud] = useState(null)
  const [parkUi, setParkUi] = useState({ menu: false, intro: false, turn: null, result: null })
  const myParkInfo = () => {
    const p = prefsRef.current
    return { name: online.me?.name || characterById(p.character).nick, look: lookForPlayer(p, { character: p.character, outfit: p.outfit }, "park"), rep: validRep(p.parkRep) }
  }
  const parkNet = usePark({ world: parkWorld, active: !!parkWorld, me: parkWorld ? myParkInfo() : null })
  // spatial voice in My Park (park menu > Voice; utils/voice)
  const parkVoice = useParkVoice({ world: parkWorld, joined: parkNet.joined, park: parkNet.park })
  // Live Venue Presence (park/presence.js): Buddy Locator friends physically at a real venue.
  // The server decides who's where ({ id, area }: a venue and a court, nothing finer) and only
  // for friends who share their location with you; they stand in My Park "here for real".
  const loc = useLocate()
  const aim = useAim()
  const parkVenueId = parkWorld?.venue || null
  const realHere = React.useMemo(() => (parkVenueId ? friendsAt(loc.friends, parkVenueId) : { here: [], nearby: [] }), [loc.friends, parkVenueId])
  useEffect(() => {
    parkWorld?.setReal?.(realHere.here.map((f) => ({ key: f.key, name: f.name, area: f.venue.area })))
  }, [parkWorld, realHere])
  // Live Broadcast (twin/live): a buddy live on a court here is on that court in My Park
  const liveCourt = useLiveCourt({ world: parkWorld, venue: parkVenueId })
  const [parkCounts, setParkCounts] = useState({}) // people in each real venue's online parks (the picker's badges)

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
    // practice: the session's labels say it all (no IN/OUT, WINNER or score callouts)
    if (s?.kind === "train" && (e.type === "line" || e.type === "rally" || e.type === "point" || e.type === "call")) return
    switch (e.type) {
      case "hit":
        if (e.mine && e.slot === 0) trailApi.current?.resolve(e.kind)
        // (a practice drill labels each shot itself)
        if (e.mine) !(s?.kind === "train" && !s.plan?.spec?.play) && say(shotBanner(e))
        // they attacked: hands up
        else if (e.theirs && (e.tag === "speedup" || e.tag === "counter")) callout("Hands up!", "bad", 650, "line")
        break
      case "whiff":
        if (e.slot === 0) trailApi.current?.resolve(null, true)
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
        if (e.train) {
          setTrain((t) => ({ snap: e.snap, result: e.result ? { ...e.result, id: e.id } : t?.result || null, cue: e.cue ? e.id : t?.cue || null }))
          break
        }
        setDrill((d) => ({ ...e, results: [...(d?.results || []), ...(e.ok === null ? [] : [e.ok])] }))
        break
      case "camera":
        flash(`Camera: ${CAMERA_NAMES[e.camera]}`)
        setPrefs({ camera: e.camera })
        break
      case "gameover":
        onGameOver(e)
        break
      case "worldMenu":
        parkEventRef.current?.(e)
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
    // a game in My Park: your park rep, then back to the park
    const pg = parkGameRef.current
    if (pg && (pg.kind === "solo" || pg.kind === "room") && !pg.done) {
      pg.done = true
      const rep = recordGame(prefsRef.current.parkRep, !!e.youWon, { level: pg.level })
      const { earned, ...kept } = rep
      setPrefs({ parkRep: kept })
      if (e.youWon) unlock("pickleball-win")
      if (s?.kind === "online" && onlineRef.current.isHost) {
        onlineRef.current.sendRelay({ type: "final", winner: e.winner, score: e.score, stats: e.stats })
        onlineRef.current.finish({ winners: engineRef.current?.seatsOf(e.winner) || [], reason: `${e.score[e.winner]}-${e.score[1 - e.winner]}`, scores: e.score })
      }
      const mine = e.youWon ? e.score[e.winner] : e.score[1 - e.winner]
      const theirs = e.youWon ? e.score[1 - e.winner] : e.score[e.winner]
      setParkUi((u) => ({ ...u, result: { won: !!e.youWon, score: [mine, theirs], earned, rep: kept } }))
      return
    }
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
  // a match against Twin Clones (Twin Replay's clones list or Rematch): spec { doubles,
  // partner, opponents: [clone ids | null], venue, court } at that game's venue and court
  const startClones = async (spec) => {
    const p = prefsRef.current
    const ids = (spec.opponents || []).map((id) => (id ? `clone:${id}` : null))
    const roster = rosterFor({ doubles: !!spec.doubles, level: p.level, me: p.character, outfit: p.outfit, opponent: ids[0], opponent2: ids[1] || null, partner: spec.partner ? `clone:${spec.partner}` : null })
    let venue = "park"
    if (spec.venue) {
      const { twinVenue } = await import("./twin/venues.js")
      venue = await twinVenue(spec.venue, spec.court).catch(() => "park")
    }
    reset()
    setSession({ kind: "clones", spec, level: p.level })
    setScreen("main")
    engineRef.current?.newMatch({ doubles: !!spec.doubles, level: p.level, scoring: p.scoring, target: p.target, venue, roster: dress(roster, typeof venue === "string" ? venue : "park"), humans: 1 })
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
  // practice (practice/): the ball machine, a drill or a lesson. A lesson opens on its tip
  // card (the court waits, paused) unless intro is false (Again)
  const planFor = (p) => {
    if (p.kind === "machine") return { ...p, title: "Ball Machine", spec: machineSpec(p.settings) }
    if (p.kind === "drill") {
      const d = drillById(p.id) || DRILLS[0]
      // (a Coach plan can ask for more balls)
      return { kind: "drill", id: d.id, title: d.name, drill: d, spec: { id: d.id, ...d.spec, ...(p.balls ? { balls: p.balls } : {}) } }
    }
    const l = lessonById(p.id) || LESSONS[0]
    return { kind: "lesson", id: l.id, title: l.title, lesson: l, index: LESSONS.indexOf(l), count: LESSONS.length, spec: { id: l.id, ...l.spec } }
  }
  const putLayer = () => {
    const e = engineRef.current
    if (!e?.setLayer) return
    if (layerRef.current) return e.setLayer(layerRef.current)
    import("./practice/layer.js").then(({ createLayer }) => {
      if (engineRef.current !== e || layerRef.current) return
      layerRef.current = createLayer()
      e.setLayer(layerRef.current)
    })
  }
  const startTrain = (p0, { intro = true } = {}) => {
    const p = prefsRef.current
    const plan = planFor(p0)
    reset()
    setTrain(null)
    const card = !!plan.lesson && intro
    setTrainIntro(card)
    setSession({ kind: "train", plan })
    setScreen("main")
    setHubView(plan.kind === "machine" ? "machine" : plan.kind === "drill" ? "drills" : "lessons")
    const tm = trainMatch(plan.spec, { character: p.character, outfit: p.outfit })
    engineRef.current?.newMatch({ ...tm, roster: dress(tm.roster, "park"), venue: "park", humans: 1 })
    putLayer()
    if (card) engineRef.current?.pause()
  }
  const startTask = () => {
    setTrainIntro(false)
    engineRef.current?.resume()
  }
  const trainNext = () => {
    const plan = sessionRef.current?.plan
    if (plan?.lesson) {
      const n = nextLesson(plan.lesson.id)
      return n ? startTrain({ kind: "lesson", id: n.id }) : null
    }
    if (plan?.drill) {
      const i = DRILLS.indexOf(plan.drill)
      return i >= 0 && i + 1 < DRILLS.length ? startTrain({ kind: "drill", id: DRILLS[i + 1].id }) : null
    }
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
    else if (s.kind === "clones") startClones(s.spec)
    else if (s.kind === "tour") startTour(s.tour)
    else if (s.kind === "versus") startVersus()
    else if (s.kind === "train") startTrain(s.plan, { intro: false })
  }
  // ---- My Park (park/) ----
  // a venue's layout: Riverside (built in) or a real venue (its spec loaded, then generated)
  const loadParkLayout = async (id) => {
    const L = await import("./park/layout.js")
    if (!id || id === "riverside") return L.RIVERSIDE_LAYOUT
    // a Venue Finder venue: built by the server from OpenStreetMap (or the device's copy)
    if (isLiveId(id)) {
      const [{ fetchLiveSpec }, { venueLayoutSpec }] = await Promise.all([import("./park/live/liveVenue.js"), import("./park/venuegen.js")])
      const { spec } = await fetchLiveSpec(id, prefsRef.current.parkPlaces?.[id]?.shard)
      return L.makeLayout(venueLayoutSpec(spec))
    }
    const [{ loadVenueSpec }, { venueLayoutSpec }] = await Promise.all([import("./park/venues/index.js"), import("./park/venuegen.js")])
    const spec = await loadVenueSpec(id)
    if (!spec) return L.RIVERSIDE_LAYOUT
    const layout = L.makeLayout(venueLayoutSpec(spec))
    // every court as the venue file has them (Live Venue Presence places real friends by court)
    layout.rawCourts = spec.courts || []
    return layout
  }
  const courtVenueRef = useRef(null)
  const getEngine = React.useCallback(() => engineRef.current, [])
  // the engine's venue for a game on court `court` in the park you're in (that court, its surroundings)
  const parkCourtVenue = (court) => {
    const w = parkRef.current
    const make = courtVenueRef.current
    if (!w?.layout || !make || court === null || court === undefined) return "park"
    const layout = w.layout
    const hour = w.hour
    return { key: `park:${layout.id}:${court}`, build: (scene, o) => make(scene, { layout, courtId: court, quality: o.quality, hour }), room: layout.spec.indoor ? "hall" : "park" }
  }
  const [parkPick, setParkPick] = useState(false)
  const [parkLoading, setParkLoading] = useState(null)
  const parkLoadingRef = useRef(null)
  const [parkStep, setParkStep] = useState(null) // the loading screen's step: { label, pct }
  const [parkErr, setParkErr] = useState(null) // Venue Finder couldn't build a venue: why
  // the picker's badges: how many are in each real venue's online parks (numbers only)
  useEffect(() => {
    if (!parkPick || !parkNet.request) return
    let live = true
    Promise.resolve(parkNet.request("park:counts", {}))
      .then((r) => live && r?.ok && setParkCounts(r.counts || {}))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [parkPick])
  // a Venue Finder venue you picked or starred: kept (small) so it shows without the index
  const keepPlace = (id, place) => {
    if (!place) return
    const cur = prefsRef.current.parkPlaces || {}
    const { id: _id, km, score, why, near, ...rest } = place
    const next = { ...cur, [id]: { ...rest, id, short: place.title, at: Date.now() } }
    const keys = Object.keys(next).sort((a, b) => (next[b].at || 0) - (next[a].at || 0)).slice(0, 30)
    setPrefs({ parkPlaces: Object.fromEntries(keys.map((k) => [k, next[k]])) })
  }
  const pickPark = () => {
    if (session?.kind !== "park") quitToMenu()
    setParkPick(true)
  }
  const startPark = async (venueId = prefsRef.current.parkVenue || "riverside") => {
    const e = engineRef.current
    if (!e) return
    let w = parkRef.current
    // (a different venue: the old park goes)
    if (w && w.venue !== venueId) {
      parkRef.current = null
      setParkWorld(null)
      setParkHud(null)
      e.setWorld(null)
      w.dispose()
      w = null
    }
    if (!w) {
      setParkLoading(venueId)
      parkLoadingRef.current = venueId
      setParkStep({ label: "Finding the courts", pct: 8 })
    }
    reset()
    setSession({ kind: "park" })
    setScreen("park")
    setParkUi({ menu: false, intro: !prefsRef.current.parkIntro, turn: null, result: null })
    if (!w) {
      try {
        await nextPaint()
        const [{ createWorld }, layout, cv] = await Promise.all([import("./park/world.js"), loadParkLayout(venueId), import("./park/courtvenue.js")])
        courtVenueRef.current = cv.buildCourtVenue
        if (engineRef.current !== e) return
        setParkStep({ label: "Building the courts, buildings and trees", pct: 35 })
        await nextPaint()
        w = createWorld({ ...e.worldContext(), layout, phone: !!mobile, me: myParkInfo(), labelsEl: parkLabelsRef.current, onHud: setParkHud, onEvent: (ev) => parkEventRef.current?.(ev) })
      } catch (error) {
        console.error(error)
        parkLoadingRef.current = null
        setParkStep(null)
        setParkLoading(null)
        setScreen("main")
        setSession(null)
        // (a Venue Finder venue that couldn't be built: say why, back to the list)
        if (isLiveId(venueId)) {
          setParkErr(error?.message || "That venue couldn't be built right now.")
          setParkPick(true)
        }
        return
      }
      parkRef.current = w
      setParkWorld(w)
    }
    if (parkLoadingRef.current) {
      // the first picture: shaders compile and textures upload behind the loading screen
      setParkStep({ label: "Lighting it up", pct: 75 })
      await nextPaint()
      w.resume()
      e.setWorld(w)
      await Promise.race([e.ready, new Promise((r) => setTimeout(r, 8000))])
      setParkStep({ label: "Here we go", pct: 100 })
      await nextPaint()
      parkLoadingRef.current = null
      setParkLoading(null)
      setParkStep(null)
      return
    }
    setParkLoading(null)
    w.resume()
    e.setWorld(w)
  }
  // back to the park after a game, the Locker Room or the ball machine
  const backToPark = ({ court = null } = {}) => {
    const w = parkRef.current
    const e = engineRef.current
    if (!w || !e) return
    parkGameRef.current = null
    reset()
    setTrain(null)
    setTrainIntro(false)
    e.showcase(null)
    setSession({ kind: "park" })
    setScreen("park")
    setParkUi({ menu: false, intro: false, turn: null, result: null })
    w.setMe(myParkInfo())
    w.resume({ court })
    e.setWorld(w)
  }
  const leavePark = () => {
    const w = parkRef.current
    parkRef.current = null
    parkGameRef.current = null
    setParkWorld(null)
    setParkHud(null)
    setParkUi({ menu: false, intro: false, turn: null, result: null })
    engineRef.current?.setWorld(null)
    w?.dispose()
    reset()
    setSession(null)
    setScreen("main")
    engineRef.current?.quit()
  }
  // your turn on a court: a solo game here against the park's players (an online room game
  // starts by itself: the server seats everyone)
  const startParkGame = (t) => {
    const e = engineRef.current
    const w = parkRef.current
    if (!e || !w) return
    setParkUi((u) => ({ ...u, turn: null }))
    const p = prefsRef.current
    const level = t.level || "intermediate"
    const me0 = myParkInfo()
    const roster = t.lineup.map((x) => (x.me ? { id: "you", team: x.team, ctrl: "human", slot: 0, name: me0.name, character: p.character, outfit: p.outfit, look: me0.look } : { id: x.id, team: x.team, ctrl: "cpu", level, name: x.name, look: x.look }))
    parkGameRef.current = { court: t.court, kind: "solo", level }
    reset()
    setSession({ kind: "parkgame", level, court: t.court })
    w.suspend()
    e.setWorld(null)
    // (played on that very court, with the venue all round it)
    e.newMatch({ doubles: true, level, scoring: "sideout", target: 11, venue: parkCourtVenue(t.court), roster, humans: 1 })
  }
  parkEventRef.current = (ev) => {
    const w = parkRef.current
    const e = engineRef.current
    if (!w || !e) return
    if (ev.type === "turn") {
      if (ev.kind === "room") {
        // (the room's own state starts the game: startOnlineEngine)
        parkGameRef.current = { court: ev.court, kind: "room", level: ev.level }
        return
      }
      setParkUi((u) => ({ ...u, menu: false, turn: { ...ev, name: PARK_COURTS[ev.court]?.name || "court", levelName: PARK_LEVELS[ev.level] || "Club" } }))
    } else if (ev.type === "locker") {
      parkGameRef.current = { kind: "locker" }
      w.suspend()
      e.setWorld(null)
      setLockerFor({ who: prefsRef.current.character, back: "park" })
      setScreen("locker")
    } else if (ev.type === "machine") {
      parkGameRef.current = { kind: "machine" }
      w.suspend()
      e.setWorld(null)
      setSession(null)
      setHubView("machine")
      setScreen("practice")
    } else if (ev.type === "worldMenu") setParkUi((u) => ({ ...u, menu: !u.menu }))
  }
  // the score of your park game, for everyone in the park (their court boards)
  // (a room game: the host tells the park)
  const parkScore = (session?.kind === "parkgame" || (session?.kind === "online" && parkGameRef.current?.kind === "room" && online.isHost)) && hud?.score ? hud.score.join("-") : null
  useEffect(() => {
    if (!parkScore || !parkNet.joined || !parkNet.request) return
    const g = parkGameRef.current
    if (g?.court !== undefined && g?.court !== null) parkNet.request("park:score", { court: g.court, score: hud.score })
  }, [parkScore])
  // the engine's "Escape" in the park (no React key handler sees it first)
  useEffect(() => () => parkRef.current?.dispose(), [])

  const quitToMenu = () => {
    const pg = parkGameRef.current
    // (in My Park: out of a game, the ball machine or the Locker Room goes back to the park)
    if (sessionRef.current?.kind === "parkgame" || (pg && pg.kind === "room" && sessionRef.current?.kind === "online")) {
      if (sessionRef.current?.kind === "online") onlineRef.current.leave()
      return backToPark({ court: pg?.court ?? null })
    }
    if (sessionRef.current?.kind === "park") return leavePark()
    if (pg?.kind === "machine" && sessionRef.current?.kind === "train") {
      reset()
      setSession(null)
      setTrain(null)
      setTrainIntro(false)
      setScreen("practice")
      engineRef.current?.quit()
      return
    }
    if (sessionRef.current?.kind === "online") onlineRef.current.leave()
    // (out of a practice session: back to the practice screen it came from)
    const back = sessionRef.current?.kind === "train" ? "practice" : "main"
    reset()
    setSession(null)
    setTrain(null)
    setTrainIntro(false)
    setScreen(back)
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

  // practice progress: lessons done, a drill's best stars
  useEffect(() => {
    const s = sessionRef.current
    if (!train?.snap?.done || s?.kind !== "train") return
    const { plan } = s
    const p = prefsRef.current
    if (plan.lesson && train.snap.made >= plan.spec.need) setPrefs({ lessons: { ...(p.lessons || {}), [plan.lesson.id]: true } })
    if (plan.drill) {
      const n = drillStars(plan.drill, train.snap)
      const best = p.drillStars || {}
      if (!(best[plan.drill.id] >= n)) setPrefs({ drillStars: { ...best, [plan.drill.id]: n } })
    }
  }, [train?.snap?.done])
  // anyone who has started something has been welcomed (the first-time offer goes away)
  useEffect(() => {
    if (session && !prefsRef.current.welcomed) setPrefs({ welcomed: true })
  }, [session])

  // ---- online ----
  const onlinePlaying = online.room && (online.phase === "playing" || online.phase === "over")
  useEffect(() => {
    if (online.room && screen !== "online") setScreen("online")
  }, [online.room?.id])
  const startOnlineEngine = (opts) => {
    const e = engineRef.current
    reset()
    setSession({ kind: "online" })
    // (a game called from My Park: the park waits while you play)
    if (parkRef.current && !parkRef.current.suspended) {
      parkRef.current.suspend()
      setParkUi((u) => ({ ...u, menu: false, turn: null }))
    }
    if (parkRef.current && !parkGameRef.current) parkGameRef.current = { court: null, kind: "room", level: "intermediate" }
    // (a room game called from My Park: on that court, at that venue)
    if (parkRef.current && parkGameRef.current?.kind === "room" && opts?.settings) opts = { ...opts, settings: { ...opts.settings, venueBuild: parkCourtVenue(parkGameRef.current.court) } }
    e?.setWorld(null)
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
      // (a park game: back to the park, unless the result is still up)
      if (parkRef.current && parkGameRef.current?.kind === "room") {
        if (!parkUi.result) backToPark({ court: parkGameRef.current.court })
        return
      }
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
  const trailRef = useRef(null) // the swipe trail's canvas (swipetrail.js)
  const trailApi = useRef(null)
  const classicDown = useRef(0) // Classic: when the finger went down (for the release ripple's pace)
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
          trailApi.current?.start(swipeTouch.current.pts[0])
          engineRef.current?.swipe("start", swipeTouch.current.pts)
          return
        }
        classicDown.current = performance.now()
        trailApi.current?.ripple(e.clientX, e.clientY)
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
        // the trail: every coalesced point (a fast flick between frames still draws its
        // curve), tinted by the pace swiped so far
        if (trailApi.current) {
          const r = stage.getBoundingClientRect()
          const tint = swipeLook(readSwipe(sw.pts, { width: r.width, height: r.height })).color
          const evs = e.getCoalescedEvents?.() || []
          for (const c of evs.length ? evs : [e]) trailApi.current.move({ x: c.clientX, y: c.clientY, t: performance.now() }, tint)
        }
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
        const last = { x: e.clientX, y: e.clientY, t: performance.now() }
        sw.pts.push(last)
        if (e.type === "pointercancel") trailApi.current?.cancel()
        else {
          const r = stage.getBoundingClientRect()
          trailApi.current?.end(last, readSwipe(sw.pts, { width: r.width, height: r.height }))
        }
        engineRef.current?.swipe(e.type === "pointercancel" ? "cancel" : "end", sw.pts)
        return
      }
      if (aimTouch.current === e.pointerId) {
        aimTouch.current = null
        // (the release: a bigger ripple in the color of the pace you held)
        if (e.type !== "pointercancel") trailApi.current?.ripple(e.clientX, e.clientY, SHOT_COLORS[bandOf(paceOf((performance.now() - classicDown.current) / 1000))], true)
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

  // the swipe trail's canvas (touch screens only)
  useEffect(() => {
    if (!showPad || !trailRef.current) return
    const t = createTrailCanvas(trailRef.current)
    trailApi.current = t
    trailRef.current.__trail = t // (tests)
    return () => {
      t.dispose()
      if (trailApi.current === t) trailApi.current = null
    }
  }, [showPad])
  useEffect(() => trailApi.current?.setEnabled(prefs.swipeTrail !== false), [prefs.swipeTrail, showPad])
  // Swipe on a touch screen: no aim dot on the court (the trail is the feedback)
  const swipeAim = showPad && (prefs.scheme || "swipe") === "swipe"
  useEffect(() => {
    engineRef.current?.setSettings({ swipeAim })
  }, [swipeAim, phase])

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
  // a notification or deep link into Real Games (a session invite, a match to confirm): open it unless a game is on
  useEffect(() => {
    // "Brandon is live at Los Cab": watch it (unless a game is on here)
    if (handoff?.id && handoff.live) {
      setWatchFor({ id: handoff.live, code: handoff.code || null })
      if (!inGame) setScreen("watch")
      return
    }
    if (handoff?.id && handoff.floppy) return void (floppyGo.current = handoff.floppy)
    if (!handoff?.id || !(handoff.session || handoff.match || handoff.venue)) return
    setClubHandoff(handoff)
    if (!inGame) setScreen("club")
  }, [handoff?.id])
  // Floppy asked for a mode ("start pickleball practice"): once the game is up, unless one is on
  const floppyGo = useRef(null)
  useEffect(() => {
    const f = floppyGo.current
    if (!f || phase === "loading" || phase === "error" || inGame) return
    floppyGo.current = null
    if (f.mode === "quick") setScreen("quick")
    else if (f.mode === "practice") (setHubView("hub"), setScreen("practice"))
    else if (f.mode === "park") f.venue ? startPark(f.venue) : pickPark()
    else if (f.mode === "real") setScreen("club")
    else if (f.mode === "online") setScreen("online")
    else if (f.mode === "tour") setScreen("tour")
  }, [handoff?.id, phase])
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
        { label: "Practice...", onClick: () => (quitToMenu(), setHubView("hub"), setScreen("practice")) },
        { label: "My Park...", onClick: pickPark },
        { label: "Real Games...", onClick: () => (session?.kind !== "online" && quitToMenu(), setScreen("club")) },
        { label: "2 Players...", onClick: () => (quitToMenu(), setScreen("versus")) },
        { label: "Locker Room...", onClick: () => (session?.kind !== "online" && quitToMenu(), setLockerFor(null), setScreen("locker")) },
        { label: "Play Online...", onClick: () => (session?.kind !== "online" && quitToMenu(), setScreen("online")) },
        { label: "Twin Replay (film a real game)...", onClick: () => (session?.kind !== "online" && quitToMenu(), setScreen("twin")) },
        { label: "Go Live (friends watch in 3D)...", onClick: () => (session?.kind !== "online" && quitToMenu(), setScreen("live")) },
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
        { label: "Show Swipe Trail", checked: prefs.swipeTrail, disabled: !showPad, onClick: () => setPrefs({ swipeTrail: !prefs.swipeTrail }) },
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
        { label: "Learn to Play (Lessons)...", onClick: () => (quitToMenu(), setHubView("lessons"), setScreen("practice")) },
        { label: "Controls Tutorial", onClick: () => startTutorial(0) },
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
        {showPad && <canvas className="pkSwipeTrail" ref={trailRef} aria-hidden="true" />}

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
        {inGame && hud && !tutorialStep?.card && session?.kind !== "practice" && session?.kind !== "tutorial" && session?.kind !== "train" && <ScoreBug hud={hud} online={onlineText} />}
        {/* (the one banner slot; a practice drill labels each shot itself: practice/PracticeHud.jsx) */}
        {inGame && <Banner banner={banners.current} />}
        <Meter ref={meterRefs[0]} slot={0} />
        <Meter ref={meterRefs[1]} slot={1} />
        {phase === "playing" && replay && <ReplayBug touch={showPad} />}
        {phase === "playing" && prefs.hints && (prefs.hintPoints || 0) < 3 && !replay && session && session.kind !== "tutorial" && session.kind !== "practice" && session.kind !== "train" && <HintLine text={hintText} />}
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
        {inGame && session?.kind === "train" && (
          <PracticeHud
            plan={session.plan}
            train={train}
            intro={trainIntro}
            touch={showPad}
            onStartTask={startTask}
            onPause={togglePause}
            onAgain={again}
            onNext={(session.plan.lesson && nextLesson(session.plan.lesson.id)) || (session.plan.drill && DRILLS.indexOf(session.plan.drill) + 1 < DRILLS.length) ? trainNext : null}
            onDone={quitToMenu}
          />
        )}
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

        {phase === "paused" && !editing && !dialog && !tutorialStep?.card && !(session?.kind === "train" && trainIntro) && (
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

        {phase === "over" && result && !isOnline && !parkUi.result && session?.kind !== "parkgame" && (
          <OverScreen
            result={result}
            session={session}
            reward={reward}
            onAgain={session?.kind === "tour" && result.youWon ? null : again}
            onNext={session?.kind === "tour" && result.youWon && nextMatch(tour) ? () => startTour(nextMatch(tour)) : null}
            onMenu={quitToMenu}
          />
        )}
        {isOnline && online.phase === "over" && result && !parkUi.result && (
          <OverScreen result={result} session={{ kind: "online" }}>
            <OnlineResultBar online={online} />
          </OverScreen>
        )}
        {isOnline && online.phase === "over" && !result && <OnlineResultBar online={online} />}

        {/* ---------- My Park ---------- */}
        {screen === "park" && <div className="pkParkLabels" ref={parkLabelsRef} aria-hidden="true" style={{ display: phase === "world" ? "" : "none" }} />}
        {screen === "park" && phase === "world" && parkWorld && !parkUi.menu && !parkUi.turn && (
          <ParkHud
            hud={parkHud}
            showPad={showPad}
            padSide={padSide}
            onAction={() => parkRef.current?.action()}
            onCam={() => parkRef.current?.cycleCam()}
            onMenu={() => setParkUi((u) => ({ ...u, menu: true }))}
          />
        )}
        {screen === "park" && phase === "world" && parkWorld && liveCourt && !parkUi.menu && !parkUi.turn && !parkUi.intro && (
          <div className="pkPanel window pkParkLive" data-park-live>
            <span>
              <b>● LIVE</b> {liveCourt.host}'s game{liveCourt.courtName ? ` on ${liveCourt.courtName}` : ""}
            </span>
            <button type="button" onClick={() => (leavePark(), setWatchFor({ id: liveCourt.id, code: null }), setScreen("watch"))} data-action="park-watch-live">
              Watch
            </button>
          </div>
        )}
        {screen === "park" && phase === "world" && parkWorld && !parkUi.menu && !parkUi.turn && !parkUi.intro && (
          <RealFriendsBar
            here={realHere.here.map((f) => ({ key: f.key, name: f.name, area: f.venue.area }))}
            nearby={realHere.nearby.map((f) => ({ key: f.key, name: f.name, area: null }))}
            venueName={VENUE_LIST.find((v) => v.id === parkVenueId)?.short || "here"}
            courtName={(area) => {
              const m = /^c(\d+)$/.exec(area || "")
              const c = m ? parkWorld.layout?.rawCourts?.[Number(m[1])] : null
              return c ? `Court ${c.n ?? Number(m[1]) + 1}` : ""
            }}
            canIm={aim?.status === "online"}
            onHi={(f) => aim?.sendIm?.(f.name, `I see you at ${VENUE_LIST.find((v) => v.id === parkVenueId)?.short || "the courts"}! Saving you a spot in the virtual park too: Pickleball 98 > My Park.`)}
            onPlan={() => {
              const id = parkVenueId
              leavePark()
              setClubHandoff({ id: Date.now(), venue: id })
              setScreen("club")
            }}
          />
        )}
        {screen === "park" && phase === "world" && parkUi.intro && <ParkIntro showPad={showPad} onDone={() => (setPrefs({ parkIntro: true }), setParkUi((u) => ({ ...u, intro: false })))} />}
        {screen === "park" && parkUi.turn && !parkUi.menu && <ParkTurn key={parkUi.turn.court} turn={parkUi.turn} onGo={() => withScheme(() => startParkGame(parkUi.turn))} />}
        {screen === "park" && phase === "world" && parkUi.menu && (
          <ParkMenu
            courts={parkRef.current?.courts || []}
            rep={validRep(prefs.parkRep)}
            online={parkHud?.online}
            onResume={() => (setParkUi((u) => ({ ...u, menu: false })), stageRef.current?.focus({ preventScroll: true }))}
            onWatch={(id) => (parkRef.current?.watch(id), setParkUi((u) => ({ ...u, menu: false })))}
            onSay={(i) => (parkRef.current?.say(i), setParkUi((u) => ({ ...u, menu: false })))}
            onEmote={(id) => (parkRef.current?.emote(id), setParkUi((u) => ({ ...u, menu: false })))}
            onLocker={() => (setParkUi((u) => ({ ...u, menu: false })), parkEventRef.current?.({ type: "locker" }))}
            venueName={parkWorld?.layout?.name || "My Park"}
            onVenues={() => (setParkUi((u) => ({ ...u, menu: false })), setParkPick(true))}
            onLeave={leavePark}
            voice={{ ...parkVoice, names: parkWorld?.voicePlace?.().names || {} }}
          />
        )}
        {parkWorld && parkVoice.state.status !== "off" && !parkUi.menu && <VoiceChip voice={parkVoice} />}
        {parkUi.result && (phase === "over" || online.phase === "over") && (
          <ParkResult
            result={parkUi.result}
            onBack={() => {
              const pg = parkGameRef.current
              if (sessionRef.current?.kind === "online") onlineRef.current.leave()
              backToPark({ court: pg?.court ?? null })
            }}
          />
        )}

        {parkPick && (
          <FinderPanel
            list={VENUE_LIST}
            badges={Object.fromEntries(
              VENUE_LIST.map((v) => {
                const friends = badgeText(friendsAt(loc.friends, v.id))
                const n = parkCounts[v.id] || 0
                return [v.id, [friends, n ? `${n} playing in 98ish` : ""].filter(Boolean).join(" · ")]
              })
            )}
            places={prefs.parkPlaces || {}}
            current={prefs.parkVenue || "riverside"}
            favs={Array.isArray(prefs.parkFavs) ? prefs.parkFavs : []}
            loading={parkLoading}
            error={parkErr}
            onPick={(id, place) => {
              keepPlace(id, place)
              setParkErr(null)
              setPrefs({ parkVenue: id })
              setParkPick(false)
              startPark(id)
            }}
            onFav={(id, place) => {
              keepPlace(id, place)
              const f = Array.isArray(prefsRef.current.parkFavs) ? prefsRef.current.parkFavs : []
              setPrefs({ parkFavs: f.includes(id) ? f.filter((x) => x !== id) : [...f, id].slice(0, 20) })
            }}
            onClose={() => (setParkPick(false), setParkErr(null))}
          />
        )}
        {parkLoading && screen === "park" && !parkPick && <ParkLoading venue={VENUE_LIST.find((v) => v.id === parkLoading)?.short || prefs.parkPlaces?.[parkLoading]?.short || (isLiveId(parkLoading) ? "A court from the map" : "Riverside Park")} step={parkStep} />}

        {/* ---------- Twin Replay (twin/): a real game, filmed, replayed here ---------- */}
        {screen === "twin" && phase !== "loading" && phase !== "error" && (
          <React.Suspense fallback={<div className="pkCenter pkDim"><div className="pkPanel window">Opening Twin Replay...</div></div>}>
            <TwinReplay key={twinView || "twin"} getEngine={getEngine} initialView={twinView} onExit={() => (setScreen(twinBack), setTwinBack("main"), setTwinView(null))} onPlayClones={(spec) => withScheme(() => startClones(spec))} onDrill={(it) => (setTwinView(null), setTwinBack("main"), withScheme(() => startTrain(it.kind === "machine" ? { kind: "machine", settings: it.settings } : { kind: "drill", id: it.drill, balls: it.balls })))} />
          </React.Suspense>
        )}

        {/* ---------- Live Broadcast (twin/live/): go live, or watch a friend's game ---------- */}
        {screen === "live" && phase !== "loading" && phase !== "error" && (
          <React.Suspense fallback={<div className="pkCenter pkDim"><div className="pkPanel window">Opening Go Live...</div></div>}>
            <GoLive onExit={() => setScreen("club")} onOpenTwin={() => (setTwinBack("club"), setScreen("twin"))} />
          </React.Suspense>
        )}
        {screen === "watch" && watchFor && phase !== "loading" && phase !== "error" && (
          <React.Suspense fallback={<div className="pkCenter pkDim"><div className="pkPanel window">Joining the game...</div></div>}>
            <LiveWatch key={watchFor.id || watchFor.code} getEngine={getEngine} id={watchFor.id} code={watchFor.code} onExit={() => (setWatchFor(null), setScreen("club"))} />
          </React.Suspense>
        )}

        {/* ---------- menus ---------- */}
        {atMenu && screen === "main" && phase === "title" && (
          <TitleMenu
            onPick={(s) => (s === "park" ? pickPark() : s === "rules" ? setDialog("rules") : s === "settings" ? setDialog("settings") : s === "controls" ? setDialog("controls") : (setPlayersFor("p1"), s === "practice" && setHubView("hub"), setScreen(s)))}
            onOnline={() => setScreen("online")}
            tour={tour}
            showPad={showPad}
            offer={firstTime && !prefs.welcomed && !prefs.tutorialDone ? <FirstTimeOffer onLesson={() => withScheme(() => startTrain({ kind: "lesson", id: "basics" }))} onPlay={() => withScheme(startQuick)} /> : null}
          />
        )}
        {atMenu && screen === "club" && (
          <div className="pkClubHost" data-screen="club">
            <React.Suspense fallback={<div className="pkCenter pkDim"><div className="pkPanel window">Loading Real Games...</div></div>}>
              <RealGames embedded mobile={mobile} handoff={clubHandoff} onClose={() => setScreen("main")} onTwin={() => (setTwinBack("club"), setTwinView(null), setScreen("twin"))} onCoach={() => (setTwinBack("club"), setTwinView("coach"), setScreen("twin"))} onLive={() => setScreen("live")} onWatch={(id) => (setWatchFor({ id, code: null }), setScreen("watch"))} />
            </React.Suspense>
          </div>
        )}
        {atMenu && screen === "quick" && <QuickMenu prefs={prefs} setPrefs={setPrefs} tour={tour} onStart={() => withScheme(startQuick)} onBack={() => setScreen("main")} onPlayers={() => (setPlayersFor("p1q"), setScreen("players"))} onOnline={() => setScreen("online")} onTour={() => setScreen("tour")} onVersus={() => setScreen("versus")} />}
        {(atMenu || phase === "showcase") && screen === "locker" && (
          <LockerRoom
            prefs={prefs}
            setPrefs={setPrefs}
            engine={() => engineRef.current}
            initial={lockerFor?.who || prefs.character}
            onBack={() => {
              engineRef.current?.showcase(null)
              if (lockerFor?.back === "park") {
                setLockerFor(null)
                return backToPark()
              }
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
        {atMenu && screen === "practice" && <PracticeHub key={hubView} initialView={hubView} prefs={prefs} setPrefs={setPrefs} onStart={(x) => withScheme(() => startTrain(x))} onTutorial={() => withScheme(() => startTutorial(0))} onBack={() => (parkGameRef.current?.kind === "machine" ? backToPark() : (setHubView("hub"), setScreen("main")))} backOut={parkGameRef.current?.kind === "machine"} />}
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
                    <Combo disabled={disabled} value={s.format} name="format" ariaLabel="Format" options={[["singles", "Singles (1 v 1)"], ["doubles", "Doubles (2 v 2, computer partners fill in)"]]} onChange={(v) => set({ ...s, format: v })} />
                  </label>
                  <label>
                    Game to{" "}
                    <Combo disabled={disabled} value={s.target} name="target" ariaLabel="Game to" options={[7, 11, 15].map((n) => [n, String(n)])} onChange={(v) => set({ ...s, target: v })} />
                  </label>
                  <label>
                    Scoring{" "}
                    <Combo disabled={disabled} value={s.scoring} name="scoring" ariaLabel="Scoring" options={[["sideout", "Side-out"], ["rally", "Rally"]]} onChange={(v) => set({ ...s, scoring: v })} />
                  </label>
                  <label>
                    Venue{" "}
                    <Combo disabled={disabled} value={s.venue} name="venue" ariaLabel="Venue" options={Object.values(VENUE_INFO).map((v) => [v.id, `${v.name} (${v.time})`])} onChange={(v) => set({ ...s, venue: v })} />
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
        {showPad && !stickUi && zoneHint && (phase === "playing" || (phase === "world" && parkHud?.mode === "walk")) && !editing && (
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
            Character models, eyes, brows and hairstyles: MakeHuman (makehumancommunity.org) base mesh, body and facial
            expression targets, muscle proxies and system assets (MakeHuman and MPFB2), CC0 public domain. Older character models and motion clips: Universal Base Characters and Universal
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
