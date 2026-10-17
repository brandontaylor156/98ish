// Pickleball 98 has its own site now (repo brandontaylor156/pickleball-98). Its 98ish icon,
// Messenger's "Play here" on a venue card and Floppy open it in a new tab.
// TODO: set VITE_PICKLEBALL_URL (Vercel project settings) once the site's address is final.
export const PICKLEBALL_URL = String(import.meta.env.VITE_PICKLEBALL_URL || "https://pickleball-98.vercel.app").replace(/\/$/, "")

// meet: where to start, as ?venue= (and ?place= for a Venue Finder court: courts/meet.js
// parkHandoff) and ?mode= (Floppy's quick | practice | park | real | online | tour)
export const pickleballUrl = (meet = null) => {
  const q = new URLSearchParams()
  if (meet?.mode) q.set("mode", meet.mode)
  if (meet?.venue) q.set("venue", meet.venue)
  if (meet?.place) q.set("place", JSON.stringify(meet.place))
  const query = String(q)
  return `${PICKLEBALL_URL}/${query ? `?${query}` : ""}`
}

// call it straight from the tap (a new tab opened later is blocked as a pop-up). -> whether the
// tab opened ("noopener" as a feature would always answer null, so the link is cut by hand)
export const openPickleball = (meet = null) => {
  const tab = window.open(pickleballUrl(meet), "_blank")
  if (!tab) return false
  try {
    tab.opener = null
  } catch {}
  return true
}
