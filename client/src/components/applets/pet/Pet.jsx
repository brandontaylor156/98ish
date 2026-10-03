import React, { useCallback, useEffect, useRef, useState } from "react"
import { coupleApi, serverNow, useCouple } from "../../../utils/couple"
import { unlock } from "../../../utils/achievements"
import { NotPaired, useCoupleEvent } from "../couples/shared"
import { ACCESSORIES, FOODS, STAGE_LABEL, STATS, getPrefs, onPrefs, setPrefs } from "./catalog"
import { AccessoryIcon, ActionIcon, Creature, Food, GrandmaHouse, Heart, StatIcon } from "./PetArt"
import Adopt from "./Adopt"
import CatchGame from "./CatchGame"
import { playPetSound } from "./sounds"
import "./Pet.css"

// Our Pet: a little creature the two of you raise together. Feed it, play catch, cuddle it
// (rub or tap it), give it a bubble bath (scrub!), tuck it in and dress it up. If you both
// have it open you see each other's hands and everything the other one does, live. It
// grows from a baby to all grown up over a couple of weeks of care, and it never dies:
// leave it alone for five days and it goes to Grandma's until you both come to visit.

const RUB_FOR_CUDDLE = 420 // pixels of rubbing for one cuddle
const SCRUB_FOR_BATH = 1500
const TOUCH_EVERY_MS = 300

const timeOfDay = (date = new Date()) => {
  const h = date.getHours()
  return h >= 6 && h < 17 ? "day" : h >= 17 && h < 20 ? "dusk" : "night"
}

const ago = (time, now) => {
  const s = Math.max(0, Math.round((now - time) / 1000))
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  const d = Math.floor(s / 86400)
  return d === 1 ? "yesterday" : `${d} days ago`
}

const pick = (list, seed) => list[Math.abs(seed) % list.length]

// What it says, when nothing else is going on
const speechFor = (pet, couple, seed) => {
  if (pet.asleep) return pet.stats.fullness < 25 ? "Zzz... snacks... zzz..." : "Zzz..."
  const n = couple.partner
  if (pet.mood === "hungry") return pick(["My tummy is rumbling...", "Is it snack time? 🥺", "I'm sooo hungry..."], seed)
  if (pet.mood === "sad") return pick(["I could use a cuddle...", "Will you play with me?", "I feel a little lonely..."], seed)
  if (pet.mood === "messy") return pick(["I'm all muddy! Bath time?", "Bubbles, please!"], seed)
  if (pet.mood === "sleepy") return pick(["*yaaawn*", "My eyes are so heavy..."], seed)
  if (!pet.caredToday.me) return `Hi ${couple.me}! I missed you! ♥`
  if (pet.missing) return pick([`I haven't seen ${n} today!`, `Where's ${n}? I miss ${n}!`, `Tell ${n} I said hi!`], seed)
  if (pet.together) return pick([`I love you both!`, `Best family ever ♥`, `${couple.me} and ${n} came today! Yay!`], seed)
  return pick(["Hehe ♥", "I love you!", "Play with me?", "Today is a good day!", "*happy wiggle*"], seed)
}

// ---------- pieces ----------

const Avatar = ({ name, tone, here, title }) => (
  <span className={`petAvatar is-${tone}${here ? " is-here" : ""}`} title={title}>
    {String(name || "?").charAt(0).toUpperCase()}
  </span>
)

const BondMeter = ({ pet }) => {
  const max = pet.bond >= pet.maxBond
  const part = max ? 100 : pet.bond % 100
  return (
    <div className="petBond" title={`Bond ${pet.bond} / ${pet.maxBond}`} aria-label={`Bond level ${pet.bondLevel}`}>
      <span className="petBondHeart">
        <Heart size={26} />
        <b>{pet.bondLevel}</b>
      </span>
      <span className="petBondBar">
        <span style={{ width: `${part}%` }} />
      </span>
      <span className="petBondLabel">{max ? "Best friends forever!" : `Bond Lv ${pet.bondLevel}`}</span>
    </div>
  )
}

const Stats = ({ pet }) => (
  <div className="petStats">
    {STATS.map((s) => {
      const value = Math.round(pet.stats[s.id])
      return (
        <div key={s.id} className={`petStat is-${s.id}${value < 25 ? " is-low" : ""}`} title={`${s.label}: ${value}%`}>
          <StatIcon id={s.id} />
          <span className="petStatBar" role="meter" aria-label={s.label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${value}%` }} />
          </span>
        </div>
      )
    })}
  </div>
)

// the room's things: a window to the sky, a shelf, a rug and a bed
const Room = ({ time, dark, children }) => (
  <div className={`petRoom is-${time}${dark ? " is-dark" : ""}`}>
    <div className="petWall" />
    <div className="petWindow" aria-hidden="true">
      <div className="petSky">
        {time === "night" ? (
          <>
            <span className="petMoon" />
            {[[18, 22], [62, 14], [78, 40], [34, 48], [50, 30]].map(([x, y]) => (
              <span key={`${x}${y}`} className="petStar" style={{ left: `${x}%`, top: `${y}%` }} />
            ))}
          </>
        ) : (
          <>
            <span className="petSun" />
            <span className="petCloud" />
          </>
        )}
      </div>
      <span className="petCurtain is-left" />
      <span className="petCurtain is-right" />
    </div>
    <div className="petShelf" aria-hidden="true">
      <span className="petPlant" />
      <span className="petFrame">♥</span>
    </div>
    <div className="petFloor" />
    <div className="petRug" />
    {dark && <div className="petNight" aria-hidden="true" />}
    {children}
  </div>
)

const Sheet = ({ title, onClose, children }) => (
  <div className="petSheetDim" onClick={onClose}>
    <div className="petSheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
      <div className="petSheetHead">
        <b>{title}</b>
        <button type="button" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="petSheetBody">{children}</div>
    </div>
  </div>
)

const Family = ({ pet, couple, onClose }) => {
  useEffect(() => {
    const t = setTimeout(onClose, 5200)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="petFamily" onClick={onClose} role="status">
      <div className="petFamilyCard">
        <div className="petFamilyRow">
          <Avatar name={couple.me} tone="me" />
          <Creature species={pet.species} body={pet.body} accent={pet.accent} stage={pet.stage} worn={pet.worn} expression="loved" size={110} className="is-bounce" />
          <Avatar name={couple.partner} tone="them" />
        </div>
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className="petFamilyHeart" style={{ left: `${8 + i * 9}%`, animationDelay: `${(i % 5) * 0.18}s` }}>
            <Heart size={14 + (i % 3) * 5} />
          </span>
        ))}
        <b>Family time!</b>
        <span>
          You both looked after {pet.name} today. +15 bond ♥
        </span>
      </div>
    </div>
  )
}

// ---------- at Grandma's ----------

const Grandma = ({ pet, couple, onVisit, busy }) => {
  const me = pet.away.visited.includes("me")
  const them = pet.away.visited.includes("partner")
  return (
    <div className="petGrandma">
      <div className="petPostcard">
        <div className="petStamp">
          <Heart size={22} />
        </div>
        <GrandmaHouse size={150} />
        <p className="petPostcardText">
          Dear {couple.me} &amp; {couple.partner},
          <br />
          {pet.name} came to stay with me for a little while. They missed you both terribly! Come and visit, both of you, and I'll send them home with a tin of cookies.
          <br />
          <span className="petSign">Love, Grandma ♥</span>
        </p>
      </div>
      <div className="petVisits">
        <span className={me ? "petVisit is-done" : "petVisit"}>
          <Avatar name={couple.me} tone="me" /> {me ? "You visited ✓" : "You haven't visited yet"}
        </span>
        <span className={them ? "petVisit is-done" : "petVisit"}>
          <Avatar name={couple.partner} tone="them" /> {them ? `${couple.partner} visited ✓` : `Waiting for ${couple.partner}`}
        </span>
      </div>
      <button type="button" className="petBig petVisitGo" disabled={me || busy} onClick={onVisit}>
        {me ? `Waiting for ${couple.partner}...` : `Visit ${pet.name} at Grandma's`}
      </button>
    </div>
  )
}

// ---------- home ----------

const Home = ({ pet, setPet, couple, partnerHere, mobile }) => {
  const [sheet, setSheet] = useState(null) // feed | dress | diary | options
  const [game, setGame] = useState(false)
  const [react, setReact] = useState(null) // { kind, food }
  const [say, setSay] = useState(null)
  const [bath, setBath] = useState(false)
  const [scrub, setScrub] = useState(0)
  const [bits, setBits] = useState([]) // hearts, bubbles and sparkles
  const [chips, setChips] = useState([]) // what your partner just did
  const [hand, setHand] = useState(null) // your partner's hand { x, y, kind, by }
  const [family, setFamily] = useState(false)
  const [flying, setFlying] = useState(null) // food on its way
  const [busy, setBusy] = useState(false)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1000))
  const [prefs, setLocalPrefs] = useState(() => getPrefs(mobile))
  const [newName, setNewName] = useState("")
  const [time, setTime] = useState(timeOfDay)
  const [room, setRoom] = useState({ w: 400, h: 300 })
  const stage = useRef(null)
  const gesture = useRef(null)
  const lastTouch = useRef(0)
  const timers = useRef({})
  const idRef = useRef(0)
  const now = serverNow()

  useEffect(() => onPrefs(setLocalPrefs), [])
  useEffect(() => {
    const el = stage.current
    if (!el || typeof ResizeObserver === "undefined") return
    const watch = new ResizeObserver(() => setRoom({ w: el.clientWidth, h: el.clientHeight }))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  useEffect(() => {
    const id = setInterval(() => {
      setTime(timeOfDay())
      setSeed((n) => n + 1)
    }, 20_000)
    return () => {
      clearInterval(id)
      Object.values(timers.current).forEach(clearTimeout)
    }
  }, [])

  const later = (name, fn, ms) => {
    clearTimeout(timers.current[name])
    timers.current[name] = setTimeout(fn, ms)
  }
  const speak = (text, ms = 3600) => {
    setSay(text)
    later("say", () => setSay(null), ms)
  }
  const reaction = (kind, extra = {}, ms = 1800) => {
    setReact({ kind, ...extra })
    later("react", () => setReact(null), ms)
  }
  // a heart, bubble or sparkle at (x, y) in the stage (0..1)
  const burst = (kind, x = 0.5, y = 0.45, n = 1) => {
    const made = Array.from({ length: n }, () => ({ id: ++idRef.current, kind, x: x + (Math.random() - 0.5) * (n > 1 ? 0.3 : 0.04), y: y + (Math.random() - 0.5) * (n > 1 ? 0.2 : 0.04) }))
    setBits((list) => [...list.slice(-24), ...made])
  }

  // ---- doing things ----

  const act = useCallback(
    async (body, { quiet = false } = {}) => {
      setBusy(true)
      const r = await coupleApi("POST", "/pet/act", body)
      setBusy(false)
      if (!r.ok) {
        playPetSound("pop")
        speak(r.error || "Hmm, that didn't work.")
        return r
      }
      setPet(r.pet, r.partnerHere)
      if (r.together) {
        later("family", () => {
          setFamily(true)
          playPetSound("family")
        }, 900)
      }
      if (!quiet) setSeed((n) => n + 1)
      return r
    },
    [setPet]
  )

  const feed = async (food) => {
    setSheet(null)
    setFlying(food)
    later("fly", () => setFlying(null), 650)
    later("eat", () => {
      reaction("eat", { food }, 1600)
      playPetSound("chomp")
    }, 600)
    const r = await act({ action: "feed", food })
    if (r.ok) later("yum", () => speak(pick(["Yummy! ♥", "Nom nom nom!", "Mmm, my favorite!", "Thank you!"], seed)), 1300)
  }

  const cuddle = async () => {
    reaction("love", {}, 1600)
    burst("heart", 0.5, 0.42, 6)
    playPetSound("squeak")
    const r = await act({ action: "pet" })
    if (r.ok) speak(pick(["Hehe, that tickles! ♥", "I love cuddles!", "Purrrr...", "More, more!"], seed))
  }

  const finishBath = async () => {
    setBath(false)
    setScrub(0)
    burst("sparkle", 0.5, 0.45, 8)
    playPetSound("sparkle")
    reaction("love", {}, 1600)
    const r = await act({ action: "bathe" })
    if (r.ok) speak("Squeaky clean! ✨")
  }

  const play = async (score) => {
    setGame(false)
    reaction("hop", {}, 1800)
    const r = await act({ action: "play", score })
    if (r.ok) speak(pick(["That was the best!", "Again tomorrow?", "I caught so many!"], seed))
  }

  const toggleSleep = async () => {
    if (pet.asleep) {
      playPetSound("whistle")
      const r = await act({ action: "wake" })
      if (r.ok) speak("Good morning! ☀")
    } else {
      const r = await act({ action: "sleep" })
      if (r.ok) playPetSound("lullaby")
    }
  }

  const dress = async (id) => {
    const item = ACCESSORIES.find((a) => a.id === id)
    const on = pet.worn.includes(id)
    const worn = on ? pet.worn.filter((w) => w !== id) : [...pet.worn.filter((w) => ACCESSORIES.find((a) => a.id === w)?.slot !== item.slot), id]
    const r = await act({ action: "dress", worn }, { quiet: true })
    if (r.ok) {
      playPetSound(on ? "pop" : "sparkle")
      if (!on) reaction("wow", {}, 1200)
    }
  }

  // ---- your partner, live ----

  useCoupleEvent("couple:pet", (p) => {
    if (!p?.kind) return
    const id = ++idRef.current
    setChips((list) => [...list.slice(-1), { id, by: p.by, text: p.text }])
    later(`chip${id}`, () => setChips((list) => list.filter((c) => c.id !== id)), 4200)
    if (p.kind === "feed") {
      setFlying(p.detail)
      later("fly", () => setFlying(null), 650)
      later("eat", () => {
        reaction("eat", { food: p.detail }, 1600)
        playPetSound("chomp")
      }, 600)
    } else if (p.kind === "pet") {
      reaction("love", {}, 1500)
      burst("heart", 0.5, 0.42, 5)
      playPetSound("squeak")
    } else if (p.kind === "bathe") {
      burst("sparkle", 0.5, 0.45, 8)
      playPetSound("sparkle")
    } else if (p.kind === "play") reaction("hop", {}, 1800)
    else if (p.kind === "dress") reaction("wow", {}, 1200)
    if (p.together) later("family", () => (setFamily(true), playPetSound("family")), 900)
  })

  useCoupleEvent("couple:pet-touch", (p) => {
    if (p.kind === "end") return setHand(null)
    setHand({ x: p.x, y: p.y, kind: p.kind, by: p.by })
    if (Math.random() < 0.5) burst(p.kind === "scrub" ? "bubble" : "heart", p.x, p.y)
    later("hand", () => setHand(null), 1400)
  })

  // ---- rubbing and scrubbing ----

  const where = (e) => {
    const r = stage.current.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, px: e.clientX, py: e.clientY }
  }
  const sendTouch = (kind, x, y, force = false) => {
    const t = Date.now()
    if (!force && t - lastTouch.current < TOUCH_EVERY_MS) return
    lastTouch.current = t
    coupleApi("POST", "/pet/touch", { kind, x, y })
  }
  const onDown = (e) => {
    if (!e.target.closest(".petCreatureWrap")) return
    if (pet.asleep && bath) return
    e.preventDefault()
    stage.current.setPointerCapture?.(e.pointerId)
    const p = where(e)
    gesture.current = { ...p, moved: 0, rubbed: gesture.current?.rubbed || 0, taps: gesture.current?.taps || 0, last: p, since: Date.now() }
  }
  const onMove = (e) => {
    const g = gesture.current
    if (!g) return
    const p = where(e)
    const d = Math.hypot(p.px - g.last.px, p.py - g.last.py)
    g.last = p
    g.moved += d
    if (d < 1) return
    if (bath) {
      setScrub((s) => {
        const next = Math.min(1, s + d / SCRUB_FOR_BATH)
        if (next >= 1 && s < 1) later("bathDone", finishBath, 50)
        return next
      })
      if (Math.random() < d / 30) {
        burst("bubble", p.x, p.y)
        if (Math.random() < 0.3) playPetSound("bubble")
      }
      sendTouch("scrub", p.x, p.y)
    } else {
      g.rubbed += d
      if (Math.random() < d / 45) burst("heart", p.x, p.y)
      reaction("love", {}, 900)
      sendTouch("cuddle", p.x, p.y)
      if (g.rubbed >= RUB_FOR_CUDDLE) {
        g.rubbed = 0
        g.taps = 0
        playPetSound("squeak")
        burst("heart", 0.5, 0.4, 5)
        act({ action: "pet" }).then((r) => r.ok && speak(pick(["Hehe, that tickles! ♥", "Purrrr...", "I love you!"], seed)))
      }
    }
  }
  const onUp = (e) => {
    const g = gesture.current
    if (!g) return
    const p = where(e)
    if (g.moved < 8) {
      // a tap
      if (bath) {
        burst("bubble", p.x, p.y, 3)
        playPetSound("bubble")
        setScrub((s) => {
          const next = Math.min(1, s + 0.08)
          if (next >= 1 && s < 1) later("bathDone", finishBath, 50)
          return next
        })
      } else {
        g.taps += 1
        burst("heart", p.x, p.y, 2)
        reaction("love", {}, 900)
        playPetSound(pet.asleep ? "bubble" : "chirp")
        if (g.taps >= 4) {
          g.taps = 0
          g.rubbed = 0
          playPetSound("squeak")
          burst("heart", 0.5, 0.4, 5)
          act({ action: "pet" }).then((r) => r.ok && speak(pick(["Hehe! ♥", "Boop!", "I love you!"], seed)))
        }
      }
    }
    sendTouch("end", p.x, p.y, true)
    gesture.current = { rubbed: g.rubbed, taps: g.taps }
  }

  // ---- what it looks like right now ----

  let expression = "okay"
  if (react?.kind === "eat") expression = "eating"
  else if (react?.kind === "love") expression = "loved"
  else if (react?.kind === "hop") expression = "happy"
  else if (react?.kind === "wow") expression = "wow"
  else if (pet.asleep) expression = "sleeping"
  else if (["hungry", "sad", "messy"].includes(pet.mood)) expression = "sad"
  else if (pet.mood === "sleepy") expression = "sleepy"
  else if (pet.mood === "happy") expression = "okay"
  const moving = react?.kind === "hop" ? "is-hop" : react?.kind === "love" ? "is-squish" : pet.mood === "happy" && !pet.asleep ? "is-happy" : pet.asleep ? "is-asleep" : ""
  const dirty = bath ? 1 - scrub : pet.stats.cleanliness < 50 ? (50 - pet.stats.cleanliness) / 40 : 0
  const line = say || speechFor(pet, couple, seed)
  // as big as the room allows; the speech bubble sits just over its head
  const size = Math.round(Math.max(130, Math.min(room.h * 0.6, room.w * 0.62, mobile ? 270 : 240)))
  const scale = pet.stage === "baby" ? 0.74 : pet.stage === "kid" ? 0.87 : 1
  const headroom = Math.round((1 - (182 - (182 - 58) * scale) / 200) * 100)

  const actions = [
    { id: "feed", label: "Feed", run: () => setSheet("feed"), disabled: pet.asleep },
    { id: "play", label: "Play", run: () => setGame(true), disabled: pet.asleep || pet.stats.energy < 10 },
    { id: "pet", label: "Cuddle", run: cuddle },
    { id: "bathe", label: bath ? "Done" : "Bath", run: () => (bath ? (setBath(false), setScrub(0)) : (setBath(true), speak("Scrub-a-dub! Rub me all over 🫧", 5000))), disabled: pet.asleep },
    { id: pet.asleep ? "wake" : "sleep", label: pet.asleep ? "Wake up" : "Lights off", run: toggleSleep },
    { id: "dress", label: "Dress up", run: () => setSheet("dress") },
  ]

  return (
    <div className="petHome">
      <div className="petHeader">
        <div className="petPair">
          <Avatar name={couple.me} tone="me" here title="You" />
          <Avatar name={couple.partner} tone="them" here={partnerHere} title={partnerHere ? `${couple.partner} is here too` : `${couple.partner} isn't here right now`} />
        </div>
        <div className="petTitle">
          <b className="petName">{pet.name}</b>
          <span className="petSub">
            {STAGE_LABEL[pet.stage]} · Day {pet.ageDays + 1}
            {partnerHere && <span className="petHereNote"> · {couple.partner} is here ♥</span>}
          </span>
        </div>
        <BondMeter pet={pet} />
      </div>

      {pet.proposal && (
        <div className="petProposal" role="status">
          {pet.proposal.mine ? (
            <>
              <span>
                Waiting for {couple.partner} to say yes to <b>{pet.proposal.name}</b>
              </span>
              <button type="button" onClick={() => coupleApi("POST", "/pet/name/answer", { yes: false }).then((r) => r.ok && setPet(r.pet))}>
                Take back
              </button>
            </>
          ) : (
            <>
              <span>
                {pet.proposal.byName} wants to call {pet.name} <b>{pet.proposal.name}</b>!
              </span>
              <button type="button" className="petYes" onClick={() => coupleApi("POST", "/pet/name/answer", { yes: true }).then((r) => r.ok && (setPet(r.pet), playPetSound("family")))}>
                Love it ♥
              </button>
              <button type="button" onClick={() => coupleApi("POST", "/pet/name/answer", { yes: false }).then((r) => r.ok && setPet(r.pet))}>
                Keep {pet.name}
              </button>
            </>
          )}
        </div>
      )}

      <div className="petStageWrap">
        <Room time={time} dark={pet.asleep}>
          <div className={`petStage${bath ? " is-bath" : ""}`} ref={stage} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            <div className={`petCreatureWrap ${moving}`}>
              {line && !game && (
                <div className={`petSpeech${say ? " is-fresh" : ""}`} key={line} role="status" style={{ bottom: `${headroom}%` }}>
                  {line}
                </div>
              )}
              {pet.asleep && (
                <div className="petZzz" aria-hidden="true" style={{ bottom: `${headroom - 12}%` }}>
                  <span>z</span>
                  <span>z</span>
                  <span>Z</span>
                </div>
              )}
              {pet.asleep && <div className="petBed" aria-hidden="true" />}
              <Creature species={pet.species} body={pet.body} accent={pet.accent} stage={pet.stage} worn={pet.worn} expression={expression} dirty={dirty} size={size} title={`${pet.name}, feeling ${pet.mood}`} />
              {pet.asleep && <div className="petBlanket" aria-hidden="true" />}
              {bath && (
                <div className="petTub" aria-hidden="true">
                  <span className="petFoam" />
                </div>
              )}
            </div>
            {flying && (
              <span className="petFlying" aria-hidden="true">
                <Food id={flying} size={40} />
              </span>
            )}
            {react?.kind === "eat" && react.food && (
              <span className="petCrumbs" aria-hidden="true">
                <Food id={react.food} size={28} />
              </span>
            )}
            {bits.map((b) => (
              <span key={b.id} className={`petBit is-${b.kind}`} style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%` }} onAnimationEnd={() => setBits((list) => list.filter((x) => x.id !== b.id))}>
                {b.kind === "heart" ? <Heart size={18} /> : b.kind === "sparkle" ? "✦" : null}
              </span>
            ))}
            {hand && (
              <span className={`petHand is-${hand.kind}`} style={{ left: `${hand.x * 100}%`, top: `${hand.y * 100}%` }} aria-label={`${hand.by} is ${hand.kind === "scrub" ? "scrubbing" : "cuddling"}`}>
                <span className="petHandPaw" />
                <Avatar name={hand.by} tone="them" />
              </span>
            )}
            {bath && (
              <div className="petScrub" aria-label={`Scrubbed ${Math.round(scrub * 100)}%`}>
                <span style={{ width: `${scrub * 100}%` }} />
              </div>
            )}
          </div>
          <div className="petChips" aria-live="polite">
            {chips.map((c) => (
              <div key={c.id} className="petChip">
                <Avatar name={c.by} tone="them" />
                <span>{c.text}</span>
              </div>
            ))}
          </div>
        </Room>
      </div>

      <Stats pet={pet} />

      <div className="petActions">
        {actions.map((a) => (
          <button key={a.id} type="button" className={`petAction is-${a.id}`} disabled={a.disabled || busy} onClick={a.run}>
            <ActionIcon id={a.id} size={mobile ? 34 : 28} />
            <span>{a.label}</span>
          </button>
        ))}
      </div>
      <div className="petLinks">
        <button type="button" className="petLink" onClick={() => setSheet("diary")}>
          Diary
        </button>
        <span className="petStreak" title="Days in a row someone fed them">
          🍓 {pet.fedStreak} day{pet.fedStreak === 1 ? "" : "s"} well fed
        </span>
        <button type="button" className="petLink" onClick={() => setSheet("options")}>
          Options...
        </button>
      </div>

      {sheet === "feed" && (
        <Sheet title={`What would ${pet.name} like?`} onClose={() => setSheet(null)}>
          <div className="petFoodGrid">
            {FOODS.map((f) => (
              <button key={f.id} type="button" className="petFoodPick" onClick={() => feed(f.id)} aria-label={f.label}>
                <Food id={f.id} size={44} />
                <span>{f.label}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === "dress" && (
        <Sheet title="Wardrobe" onClose={() => setSheet(null)}>
          <div className="petWardrobe">
            {ACCESSORIES.map((a) => {
              const open = pet.unlocked.includes(a.id)
              const on = pet.worn.includes(a.id)
              return (
                <button key={a.id} type="button" className={`petWear${on ? " is-on" : ""}${open ? "" : " is-locked"}`} disabled={!open || busy} onClick={() => dress(a.id)} aria-pressed={on} aria-label={open ? a.label : `${a.label}, unlocks at bond level ${a.level}`}>
                  <AccessoryIcon id={a.id} size={46} />
                  <span>{a.label}</span>
                  {!open && <span className="petLock">🔒 Lv {a.level}</span>}
                  {on && <span className="petWearing">Wearing</span>}
                </button>
              )
            })}
          </div>
          <p className="petHint">Your bond grows every time either of you looks after {pet.name}, and extra when you both do on the same day.</p>
        </Sheet>
      )}
      {sheet === "diary" && (
        <Sheet title={`${pet.name}'s diary`} onClose={() => setSheet(null)}>
          <ul className="petDiary">
            {pet.log.map((entry, i) => (
              <li key={`${entry.at}-${i}`} className={`is-${entry.kind}`}>
                <span className="petDiaryText">
                  {entry.text}
                  {entry.times > 1 && <b className="petTimes"> x{entry.times}</b>}
                </span>
                <span className="petDiaryWhen">{ago(entry.at, now)}</span>
              </li>
            ))}
          </ul>
          <p className="petHint">
            Adopted by {pet.adoptedBy} · {pet.careDays} day{pet.careDays === 1 ? "" : "s"} of care · {pet.togetherDays} family day{pet.togetherDays === 1 ? "" : "s"}
          </p>
        </Sheet>
      )}
      {sheet === "options" && (
        <Sheet title="Options" onClose={() => setSheet(null)}>
          <div className="petOptions">
            <div className="field-row petCheck">
              <input id="pet-walker" type="checkbox" checked={prefs.walker} onChange={(e) => setPrefs({ walker: e.target.checked }, mobile)} />
              <label htmlFor="pet-walker">Let {pet.name} wander on my desktop when this is closed</label>
            </div>
            <div className="field-row petCheck">
              <input id="pet-reminders" type="checkbox" checked={prefs.reminders} onChange={(e) => setPrefs({ reminders: e.target.checked }, mobile)} />
              <label htmlFor="pet-reminders">Gentle reminders (at most once a day)</label>
            </div>
            <form
              className="petRename"
              onSubmit={async (e) => {
                e.preventDefault()
                const r = await coupleApi("POST", "/pet/name", { name: newName.trim() })
                if (r.ok) {
                  setPet(r.pet)
                  setNewName("")
                  setSheet(null)
                } else speak(r.error)
              }}
            >
              <label htmlFor="pet-rename">Suggest a new name ({couple.partner} says yes or no):</label>
              <div className="petNameRow">
                <input id="pet-rename" value={newName} maxLength={16} autoComplete="off" onChange={(e) => setNewName(e.target.value)} disabled={!!pet.proposal} />
                <button type="submit" disabled={!newName.trim() || !!pet.proposal}>
                  Suggest
                </button>
              </div>
            </form>
          </div>
        </Sheet>
      )}
      {game && <CatchGame pet={pet} onDone={play} onQuit={() => setGame(false)} />}
      {family && <Family pet={pet} couple={couple} onClose={() => setFamily(false)} />}
    </div>
  )
}

// ---------- the app ----------

const Pet = ({ mobile, onTitle }) => {
  const couple = useCouple()
  const [pet, setPetState] = useState(undefined) // undefined: loading, null: none yet
  const [partnerHere, setPartnerHere] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [welcome, setWelcome] = useState(null)
  const [homecoming, setHomecoming] = useState(false)
  const paired = couple.status === "paired"

  const setPet = useCallback((value, here) => {
    setPetState(value)
    if (typeof here === "boolean") setPartnerHere(here)
  }, [])

  const load = useCallback(async () => {
    const r = await coupleApi("GET", "/pet")
    if (r.ok) {
      setError(null)
      setPet(r.pet, r.partnerHere)
    } else if (r.httpStatus !== 403) setError(r.error)
  }, [setPet])

  useEffect(() => {
    if (!paired) return
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [paired, couple.coupleId])

  // "I'm here": your partner sees you have it open
  useEffect(() => {
    if (!paired) return
    const ping = () => document.visibilityState !== "hidden" && coupleApi("POST", "/pet/here", { open: true }).then((r) => r.ok && setPartnerHere(r.partnerHere))
    ping()
    const id = setInterval(ping, 30_000)
    return () => {
      clearInterval(id)
      coupleApi("POST", "/pet/here", { open: false })
    }
  }, [paired, couple.coupleId])

  useCoupleEvent("couple:pet", (p) => {
    if (p?.kind === "adopt") setWelcome(p.by)
    if (p?.kind === "home") {
      setHomecoming(true)
      playPetSound("family")
    }
    load()
  })
  useCoupleEvent("couple:pet-here", (p) => setPartnerHere(!!p.open))

  useEffect(() => {
    onTitle?.(pet?.name ? `${pet.name} - Our Pet` : "Our Pet")
  }, [pet?.name])

  // achievements
  useEffect(() => {
    if (!pet) return
    unlock("pet-family")
    if (pet.fedStreak >= 7) unlock("pet-well-fed")
    if (pet.bond >= pet.maxBond) unlock("pet-bff")
  }, [pet?.fedStreak, pet?.bond, !!pet])

  const visit = async () => {
    setBusy(true)
    const r = await coupleApi("POST", "/pet/visit", {})
    setBusy(false)
    if (!r.ok) return setError(r.error)
    setPet(r.pet, r.partnerHere)
    playPetSound(r.home ? "family" : "chirp")
    if (r.home) setHomecoming(true)
  }

  let body
  if (!paired) body = <NotPaired status={couple.status} what="Our Pet" />
  else if (pet === undefined) body = <div className="petLoading">{error || "Peeking into the nursery..."}</div>
  else if (pet === null) body = <Adopt couple={couple} onAdopted={(r) => setPet(r.pet, r.partnerHere)} />
  else if (pet.away) body = <Grandma pet={pet} couple={couple} onVisit={visit} busy={busy} />
  else body = <Home pet={pet} setPet={setPet} couple={couple} partnerHere={partnerHere} mobile={mobile} />

  return (
    <div className={mobile ? "petRoot is-mobile" : "petRoot"}>
      {body}
      {welcome && pet && !pet.away && (
        <div className="petWelcome" onClick={() => setWelcome(null)} role="status">
          <div className="petWelcomeCard">
            <Creature species={pet.species} body={pet.body} accent={pet.accent} stage={pet.stage} expression="happy" size={110} className="is-bounce" />
            <b>{welcome} adopted {pet.name}!</b>
            <span>Say hello! You can suggest a different name in Options.</span>
            <button type="button" className="petBig" onClick={() => setWelcome(null)}>
              Hi {pet.name}! ♥
            </button>
          </div>
        </div>
      )}
      {homecoming && pet && !pet.away && (
        <div className="petWelcome" onClick={() => setHomecoming(false)} role="status">
          <div className="petWelcomeCard">
            <Creature species={pet.species} body={pet.body} accent={pet.accent} stage={pet.stage} worn={pet.worn} expression="loved" size={110} className="is-bounce" />
            <b>{pet.name} is home!</b>
            <span>You both came to get them. Grandma says hi, and sent cookies ♥</span>
            <button type="button" className="petBig" onClick={() => setHomecoming(false)}>
              Welcome home! ♥
            </button>
          </div>
        </div>
      )}
      {error && pet && <div className="petError petErrorBar">{error}</div>}
    </div>
  )
}

export default Pet
