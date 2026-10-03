import React, { useEffect, useRef, useState } from "react"
import { coupleApi, emitCouple, on, openCouples, serverNow } from "../../../utils/couple"
import { PROGRAM, getPrefs, localDay, onPrefs } from "./catalog"
import { Creature, Food } from "./PetArt"
import "./PetWalker.css"

// The pet out for a stroll: while Our Pet is closed, it toddles back and forth along the
// bottom of the desktop (Options in Our Pet turns it on or off; it starts off on phones).
// Tap it to open Our Pet. A thought bubble says when it's hungry, and once a day at most
// a gentle reminder pops up (unless reminders are off).

const REMIND_KEY = "98ish.pet.reminded"
const SPEED = 38 // pixels a second

const remindedToday = (what) => {
  try {
    return localStorage.getItem(REMIND_KEY) === `${what}:${localDay(serverNow())}`
  } catch {
    return true
  }
}
const markReminded = (what) => {
  try {
    localStorage.setItem(REMIND_KEY, `${what}:${localDay(serverNow())}`)
  } catch {
    // fine
  }
}

const PetWalker = ({ windows, mobile }) => {
  const [pet, setPet] = useState(null)
  const [prefs, setPrefs] = useState(() => getPrefs(mobile))
  const [spot, setSpot] = useState({ x: 120, ms: 0, face: 1, walking: false })
  const [hop, setHop] = useState(false)
  const timer = useRef(null)
  const open = windows.some((w) => !w.closed && w.app === "pet")

  useEffect(() => onPrefs(setPrefs), [])

  // what the pet is up to (now and then, and whenever something happens to it)
  useEffect(() => {
    let live = true
    const load = () => coupleApi("GET", "/pet").then((r) => live && r.ok && setPet(r.pet))
    load()
    const id = setInterval(load, 5 * 60_000)
    const offs = [on("couple:pet", load), on("couple:update", load)]
    return () => {
      live = false
      clearInterval(id)
      offs.forEach((off) => off())
    }
  }, [open])

  // a gentle reminder, once a day at most
  useEffect(() => {
    if (!pet || !prefs.reminders || open) return
    const what = pet.away ? "away" : pet.stats.fullness < 30 ? "hungry" : pet.missing === null && !pet.caredToday.me ? "missed" : null
    if (!what || remindedToday("any")) return
    markReminded("any")
    const text =
      what === "away"
        ? `${pet.name} is staying at Grandma's. Visit together to bring them home!`
        : what === "hungry"
          ? `${pet.name} is hungry! A little snack would make their day.`
          : `${pet.name} misses you! Come say hi.`
    emitCouple("couple:local-toast", { title: "Our Pet", icon: what === "hungry" ? "🍓" : "🐾", text, action: { label: "Visit", run: () => openCouples(PROGRAM) } })
  }, [pet, prefs.reminders, open])

  // strolling: pick a spot, walk there, rest a moment, repeat
  useEffect(() => {
    if (!pet || pet.away) return
    const walk = () => {
      const width = window.innerWidth
      const size = mobile ? 52 : 64
      setSpot((s) => {
        if (pet.asleep) return { ...s, walking: false }
        const x = 8 + Math.random() * Math.max(10, width - size - 16)
        const ms = Math.round((Math.abs(x - s.x) / SPEED) * 1000)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => {
          setSpot((t) => ({ ...t, walking: false }))
          timer.current = setTimeout(walk, 2500 + Math.random() * 5000)
        }, ms)
        return { x, ms, face: x < s.x ? -1 : 1, walking: true }
      })
    }
    timer.current = setTimeout(walk, 800)
    return () => clearTimeout(timer.current)
  }, [pet?.asleep, !!pet, pet?.away])

  if (!pet || pet.away || !prefs.walker || open) return null
  const hungry = pet.stats.fullness < 30
  return (
    <button
      type="button"
      className={`pwWalker${mobile ? " is-mobile" : ""}${spot.walking ? " is-walking" : ""}${hop ? " is-hop" : ""}`}
      style={{ left: spot.x, transitionDuration: `${spot.ms}ms` }}
      title={`${pet.name} (open Our Pet)`}
      aria-label={`${pet.name}, out for a walk. Open Our Pet`}
      onClick={(e) => {
        e.stopPropagation()
        setHop(true)
        setTimeout(() => {
          setHop(false)
          openCouples(PROGRAM)
        }, 350)
      }}
    >
      <span className="pwBody" style={{ transform: `scaleX(${spot.face})` }}>
        <Creature species={pet.species} body={pet.body} accent={pet.accent} stage={pet.stage} worn={pet.worn} expression={pet.asleep ? "sleeping" : hungry || pet.mood === "sad" ? "sad" : "okay"} size={mobile ? 52 : 64} />
      </span>
      {hungry ? (
        <span className="pwThought" aria-label="Hungry">
          <Food id="strawberry" size={20} />
        </span>
      ) : (
        pet.asleep && (
          <span className="pwZ" aria-hidden="true">
            z<b>Z</b>
          </span>
        )
      )}
    </button>
  )
}

export default PetWalker
