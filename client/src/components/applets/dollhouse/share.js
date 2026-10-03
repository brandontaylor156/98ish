// Sharing a Dream House with your partner. Needs 98ish's couples module
// (utils/couple.js, useCouple()): when this desktop doesn't have it yet, useCoupleInfo()
// is always null and Dream House stays a house of your own. Once it's there, a paired
// couple can open one shared house (server/dollhouse) that both of them decorate.

import { SERVER_URL } from "../puzzle/api"

// Found at build time: an empty object when this desktop has no couples module
const modules = import.meta.glob("../../../utils/couple.js", { eager: true })
const coupleModule = Object.values(modules)[0] || null
export const hasCouples = typeof coupleModule?.useCouple === "function"
const noCouple = () => null
export const useCoupleInfo = hasCouples ? coupleModule.useCouple : noCouple

// -> { partner (screen name), coupleId } when paired, else null
export const pairedWith = (couple) => {
  if (couple?.status !== "paired" || !couple.partner) return null
  return { partner: String(couple.partner.screenName || couple.partner), coupleId: couple.coupleId || null }
}

// The house server, signed with the 98 Messenger session's token. Every call resolves to
// { ok, ... } or { ok: false, error, status } (never throws).
export const houseApi = (token) => {
  const call = async (method, path, body) => {
    if (!token) return { ok: false, error: "Sign on to 98 Messenger to share your house." }
    try {
      const response = await fetch(`${SERVER_URL}/api/dollhouse${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      const result = await response.json().catch(() => ({ ok: false, error: `The house server had a problem (${response.status}).` }))
      return { ...result, status: response.status }
    } catch {
      return { ok: false, offline: true, error: "Couldn't reach the house server. It may be waking up; your changes will sync when it's back." }
    }
  }
  return {
    get: () => call("GET", ""),
    put: (house) => call("PUT", "", { house }),
    send: (ops) => call("POST", "/ops", { ops }),
    remove: () => call("DELETE", ""),
  }
}
