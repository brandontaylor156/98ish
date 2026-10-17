// Pickleball 98 has its own site now (repo brandontaylor156/pickleball-98). Its 98ish window
// (applets/pickleballLauncher) shows that site in a frame, so it plays inside 98ish as before;
// the site on its own has no 98 window round it.
export const PICKLEBALL_URL = String(import.meta.env.VITE_PICKLEBALL_URL || "https://pickleball-98.vercel.app").replace(/\/$/, "")
export const PICKLEBALL_ORIGIN = new URL(PICKLEBALL_URL).origin

// meet: where to start, as ?venue= (and ?place= for a Venue Finder court: courts/meet.js
// parkHandoff) and ?mode= (Floppy's quick | practice | park | real | online | tour)
export const pickleballSearch = (meet = null) => {
  const q = new URLSearchParams()
  if (meet?.mode) q.set("mode", meet.mode)
  if (meet?.venue) q.set("venue", meet.venue)
  if (meet?.place) q.set("place", JSON.stringify(meet.place))
  const query = String(q)
  return query ? `?${query}` : ""
}
export const pickleballUrl = (meet = null) => `${PICKLEBALL_URL}/${pickleballSearch(meet)}`

// a window's handoff (Messenger's card: { meet }; Floppy: { floppy: { mode, venue, place } }) -> meet
export const meetFromHandoff = (handoff) => {
  if (!handoff) return null
  if (handoff.meet) return handoff.meet
  const f = handoff.floppy
  return f ? { mode: f.mode || null, venue: f.venue || null, place: f.place || null } : null
}

// the frame's address: the start, ?embed=98ish (Game > Exit closes this window) and the
// screen name to offer as the player name
export const embedUrl = (meet, name = "") => {
  const q = new URLSearchParams(pickleballSearch(meet))
  q.set("embed", "98ish")
  if (name) q.set("name", name)
  return `${PICKLEBALL_URL}/?${q}`
}
