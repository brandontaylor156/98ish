// Your partner, if 98ish has couples (utils/couple.js) and you're paired: Photo Puzzle and
// Doodle Together put them first. Without the couples module (or signed off, or single)
// it's null, and both apps fall back to 98 Messenger buddies and Network Neighborhood.
import { useAim } from "../aim/AimContext"

// Found at build time: an empty object when this desktop has no couples module
const modules = import.meta.glob("../../../utils/couple.js", { eager: true })
const coupleModule = Object.values(modules)[0] || null
const useCoupleHook = typeof coupleModule?.useCouple === "function" ? coupleModule.useCouple : () => null

// -> the partner's screen name, or null
export const usePartner = () => {
  const couple = useCoupleHook()
  return couple?.status === "paired" && couple.partner ? String(couple.partner.screenName || couple.partner) : null
}

// People you could send something to: your partner first, then your 98 Messenger buddies
// (online ones first). -> [{ screenName, online, partner }]
export const useRecipients = () => {
  const aim = useAim()
  const partner = usePartner()
  const seen = new Set()
  const out = []
  const add = (screenName, online, isPartner = false) => {
    const key = String(screenName).replace(/\s+/g, "").toLowerCase()
    if (!key || seen.has(key) || key === String(aim?.me?.screenName || "").replace(/\s+/g, "").toLowerCase()) return
    seen.add(key)
    out.push({ screenName, online, partner: isPartner })
  }
  if (partner) add(partner, !!aim?.presence?.[partner.replace(/\s+/g, "").toLowerCase()]?.online, true)
  const buddies = (aim?.me?.groups || []).flatMap((g) => g.buddies)
  const online = (name) => !!aim?.presence?.[String(name).replace(/\s+/g, "").toLowerCase()]?.online
  for (const name of buddies.filter(online)) add(name, true)
  for (const name of buddies.filter((n) => !online(n))) add(name, false)
  return out.filter((r) => r.screenName !== "SmarterChild")
}
