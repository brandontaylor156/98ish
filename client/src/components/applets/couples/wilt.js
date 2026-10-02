// How wilted a bouquet is: fresh for half a day after it was last watered, fully wilted
// after four and a half, and past saving at five (the server agrees on that last part).

const DAY = 86_400_000
export const DEAD_AFTER = 5 * DAY

// today's date on this device, the way the server counts watering days
export const waterDay = (now) => new Date(now - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10)

export const wiltOf = (bouquet, now) => {
  const since = now - (bouquet.wateredAt || bouquet.sentAt)
  const level = Math.max(0, Math.min(1, (since / DAY - 0.5) / 4))
  const dead = since >= DEAD_AFTER
  const label = dead ? "Wilted" : level < 0.15 ? "Fresh as can be" : level < 0.4 ? "Doing well" : level < 0.7 ? "A little droopy: needs water" : "Wilting! Water me!"
  return { level: dead ? 1 : level, dead, label, wateredToday: (bouquet.waterDays || []).includes(waterDay(now)) }
}
