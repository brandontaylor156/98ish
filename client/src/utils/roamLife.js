// Explore's life on the 98ish side (Pickleball 98 > Explore; the open world is client/src/roam/,
// which reaches this only through roam/host98.js): your private Home/Work places, the Bag, gifts,
// time worked, and paying with Casino 98's play chips.
//
// Signed on to 98 Messenger, everything is on your account (server/roam/life.js, so it follows you
// to the phone and is erased by Delete My Account); signed off, it's kept on this device only
// (localStorage "98ish.roam.life", per user through the storage seam, utils/userStorage.js).
//
//   setRoamLifeSession({ token, screenName } | null)   from AimContext (signing on/off)
//   createLife98({ travel, equip }) -> the host's life API (see below)
//   getRoamLife() / subscribeRoamLife(fn)               the Bag for the Locker Room

import { createBank } from "../components/applets/casino/bank.js"
import { addToBag, addUses, cleanBag, itemOf, takeFromBag } from "../roam/life/catalog.js"
import { cleanPlace, cleanPlaces } from "../roam/life/places.js"

export const SERVER_URL = import.meta.env?.VITE_SOCKET_URL || "http://localhost:8000"
const KEY = "98ish.roam.life"

let session = null // { token, screenName }
let state = { signedOn: false, places: [], shared: [], bag: {}, gifts: [], work: { secs: 0, shifts: 0 }, loaded: false, error: null }
const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn(state))
const set = (patch) => {
  state = { ...state, ...patch }
  emit()
}
export const getRoamLife = () => state
export const subscribeRoamLife = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ---- this device (signed off) ----
const readLocal = () => {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "null") || {}
    return { places: cleanPlaces(d.places), bag: cleanBag(d.bag), work: { secs: Math.max(0, Number(d.work?.secs) || 0), shifts: Math.max(0, Number(d.work?.shifts) || 0) } }
  } catch {
    return { places: [], bag: {}, work: { secs: 0, shifts: 0 } }
  }
}
const writeLocal = (patch) => {
  const next = { ...readLocal(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // (storage blocked: it lasts for this visit)
  }
  set({ ...next })
  return next
}

const api = async (path, body) => {
  if (!session) return { ok: false, error: "Sign on to 98 Messenger first." }
  try {
    const r = await fetch(`${SERVER_URL}/api/roamlife${path}`, { method: "POST", headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
    return await r.json().catch(() => ({ ok: false, error: `The server had a problem (${r.status}).` }))
  } catch {
    return { ok: false, error: "Couldn't reach the 98ish server. Try again in a minute." }
  }
}
const apply = (r) => {
  if (r?.ok) set({ places: r.places ?? state.places, bag: r.bag ?? state.bag, gifts: r.gifts ?? state.gifts, work: r.work ?? state.work, ...(r.shared ? { shared: r.shared } : {}), error: null })
  return r
}

export const refreshRoamLife = async () => {
  if (!session) {
    set({ signedOn: false, shared: [], gifts: [], ...readLocal(), loaded: true })
    return { ok: true }
  }
  const r = await api("/state")
  if (r.ok) set({ signedOn: true, loaded: true })
  else set({ error: r.error })
  return apply(r)
}
export const setRoamLifeSession = (next) => {
  session = next?.token ? { token: next.token, screenName: next.screenName } : null
  refreshRoamLife()
}

// ---- the chip bank (Casino 98's, per user on this device) ----
let bank = null
const bankOf = () => (bank ||= createBank())

// the host's life API (roam/host98.js lends it to the world as host.life)
export const createLife98 = ({ travel = null, equip = null } = {}) => {
  if (!state.loaded) refreshRoamLife()
  const life = {
    get state() {
      return state
    },
    subscribe: subscribeRoamLife,
    refresh: refreshRoamLife,
    signedOn: () => !!session,
    me: () => session?.screenName || "",
    // ---- places ----
    async savePlace(place) {
      const c = cleanPlace(place)
      if (!c) return { ok: false, error: "That place didn't work." }
      if (session) return apply(await api("/places/save", { place: c }))
      const list = readLocal().places.filter((p) => p.id !== c.id)
      if (list.length >= 10) return { ok: false, error: "You can keep up to 10 places." }
      writeLocal({ places: [...list, { ...c, shared: [] }] })
      return { ok: true }
    },
    async removePlace(id) {
      if (session) return apply(await api("/places/remove", { id }))
      writeLocal({ places: readLocal().places.filter((p) => p.id !== id) })
      return { ok: true }
    },
    async sharePlace(id, names) {
      if (!session) return { ok: false, error: "Sign on to 98 Messenger to share a place with a buddy." }
      return apply(await api("/places/share", { id, with: names }))
    },
    // ---- the Bag ----
    get bank() {
      return bankOf()
    },
    // pay with play chips, then into the Bag: buys { id: purchases } -> { ok, cost, error? }
    async buy(buys, cost) {
      const b = bankOf()
      const check = addToBag(state.bag, buys)
      if (!check.ok) return check
      if (b.balance < cost && b.needsRefill()) b.refill()
      if (!b.take(cost)) return { ok: false, error: `That's ${cost} chips; you have ${b.balance}.` }
      if (session) {
        const r = apply(await api("/bag/add", { items: buys }))
        if (!r.ok) b.give(cost) // (the chips come back)
        return { ...r, cost }
      }
      writeLocal({ bag: check.bag })
      return { ok: true, cost }
    },
    async use(id, n = 1) {
      if (session) return apply(await api("/bag/use", { id, n }))
      const r = takeFromBag(readLocal().bag, id, n)
      if (r.ok) writeLocal({ bag: r.bag })
      return r
    },
    async gift(to, id, note = "", n = 1) {
      if (!session) return { ok: false, error: "Sign on to 98 Messenger to give a gift." }
      return apply(await api("/bag/gift", { to, id, note, n }))
    },
    async accept(giftId) {
      return apply(await api("/gifts/accept", { id: giftId }))
    },
    async decline(giftId) {
      return apply(await api("/gifts/decline", { id: giftId }))
    },
    async work(secs) {
      if (session) return apply(await api("/work", { secs }))
      const w = readLocal().work
      writeLocal({ work: { secs: w.secs + Math.max(0, Math.floor(secs)), shifts: w.shifts + 1 } })
      return { ok: true }
    },
    // for a test (no chips needed): straight into the Bag
    async _grant(id, n = 1) {
      if (session) return apply(await api("/bag/add", { items: { [id]: n } }))
      const r = addUses(readLocal().bag, id, n)
      if (r.ok) writeLocal({ bag: r.bag })
      return r
    },
    // a paddle, balls or clothes into Pickleball 98 (the Locker Room look and the match ball)
    equip(id) {
      const it = itemOf(id)
      if (!it || !equip) return { ok: false, error: "Pickleball 98 isn't open." }
      return equip(it)
    },
    travel,
  }
  return life
}
