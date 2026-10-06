// Pickleball 98's Living Park on this device: talks to server/livingpark (your clone left in
// My Park, your buddies' clones at a venue, challenge results). The rules (phrasebook, what
// the regulars remember) are applets/pickleball/park/living.js.
//
//   setLivingSession({ token, screenName } | null)   from AimContext (signing on/off)
//   mine() -> { ok, record, away }, leave({ venue, clone, look, phrases }), recall(), seen(),
//   atVenue(venue) -> { ok, clones }, sendResult({ owner, cloneWon, score })
//   signedOn() -> the screen name or null

export const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000"

let session = null // { token, name }

export const setLivingSession = (s) => {
  session = s?.token ? { token: s.token, name: s.screenName || "" } : null
}
export const signedOn = () => session?.name || null

const api = async (path, body) => {
  if (!session) return { ok: false, offline: true, error: "Sign on to 98 Messenger to use Living Park." }
  try {
    const response = await fetch(`${SERVER_URL}/api/livingpark${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    })
    const json = await response.json().catch(() => ({ ok: false, error: `The server had a problem (${response.status}).` }))
    return { ...json, status: response.status }
  } catch {
    return { ok: false, offline: true, error: "Couldn't reach the 98ish server." }
  }
}

export const mine = () => api("/mine")
export const leave = (spec) => api("/leave", spec)
export const recall = () => api("/recall")
export const seen = () => api("/seen")
export const atVenue = (venue) => api("/venue", { venue })
export const sendResult = (r) => api("/result", r)
