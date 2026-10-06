// The casino's chip bank: one balance shared by every casino game (and every open casino
// window), kept on this device per user (localStorage "98ish.casino.bank", which
// utils/userStorage.js keeps apart for each user). Play chips only: no real money, and when
// you run low the house gives you a free refill.
//
// take(n) before a bet goes on the table (false if you can't cover it), give(n) when chips
// come back, refill() when broke. Online Hold'em doesn't touch the bank: those tables play
// with their own chips.

export const KEY = "98ish.casino.bank"
export const START = 1000
// a refill tops you back up to START once you're under the smallest bet
export const REFILL_BELOW = 5

const fresh = () => ({ balance: START, refills: 0, biggestWin: 0, won: 0, lost: 0 })

export const createBank = (storage = globalThis.localStorage) => {
  const listeners = new Set()
  const read = () => {
    try {
      const d = JSON.parse(storage?.getItem(KEY) || "null")
      if (d && Number.isFinite(d.balance)) return { ...fresh(), ...d, balance: Math.max(0, Math.floor(d.balance)) }
    } catch {
      // unreadable: start over
    }
    return fresh()
  }
  let data = read()
  const write = () => {
    try {
      storage?.setItem(KEY, JSON.stringify(data))
    } catch {
      // private window: the chips last for this visit
    }
    for (const fn of listeners) fn(data)
  }
  const bank = {
    get balance() {
      return data.balance
    },
    get data() {
      return data
    },
    canAfford: (n) => n <= data.balance,
    // chips onto the table
    take: (n) => {
      n = Math.floor(n)
      if (!(n > 0)) return true
      if (n > data.balance) return false
      data = { ...data, balance: data.balance - n }
      write()
      return true
    },
    // chips back from the table; `net` (won minus staked) feeds the stats
    give: (n, net = null) => {
      n = Math.max(0, Math.floor(n))
      data = { ...data, balance: data.balance + n }
      if (net != null) {
        if (net > 0) data.won += net
        if (net < 0) data.lost += -net
        if (net > data.biggestWin) data.biggestWin = net
      }
      write()
    },
    needsRefill: () => data.balance < REFILL_BELOW,
    refill: () => {
      if (data.balance >= START) return false
      data = { ...data, balance: START, refills: data.refills + 1 }
      write()
      return true
    },
    reset: () => {
      data = fresh()
      write()
    },
    // another window (or tab) changed it
    reload: () => {
      data = read()
      for (const fn of listeners) fn(data)
    },
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  return bank
}

let shared = null
// the page's bank: every casino window shares it, and other tabs' changes come in
export const getBank = () => {
  if (!shared) {
    shared = createBank()
    try {
      globalThis.addEventListener?.("storage", (e) => {
        if (!e.key || e.key.endsWith(KEY)) shared.reload()
      })
    } catch {
      // no window (tests)
    }
  }
  return shared
}

export const formatChips = (n) => Math.floor(n).toLocaleString("en-US")
