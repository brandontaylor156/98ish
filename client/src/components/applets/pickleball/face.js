// The athletes' faces and skin over a match (athlete.js uses these; pure, so they're tested):
// what the face wants to show from what the athlete is doing, how sweaty the skin gets, and
// which face/hair details a detail level draws.

const clamp01 = (x) => Math.max(0, Math.min(1, x))

// The morph targets' goals (blink is the blink loop's own). The MakeHuman faces have smile,
// effort (brows down, eyes narrowed, jaw set) and shout (mouth open).
//   info: { mood: { kind: "cheer" | "sulk", variant }, between, stroke, fast, swinging, ready, holding }
// - celebrating a point: a smile (a shout with both arms up)
// - after an error (sulking): a grimace, effort with the jaw a little open
// - holding the ball before a serve: determination (a set jaw, a focused look, no smile)
// - through a hard swing: effort; watching the ball come: a little focus
export const faceTargets = (info = {}) => {
  const mood = info.mood
  const cheer = mood?.kind === "cheer"
  const sulk = mood?.kind === "sulk"
  const swingW = info.stroke || 0
  let effort = 0
  if (sulk) effort = 0.5
  else if (swingW > 0.2) effort = (info.fast ? 0.75 : 0.4) * swingW
  else if (info.holding) effort = 0.34
  else if (info.swinging || (info.ready || 0) > 0.5) effort = 0.18
  return {
    smile: cheer ? (mood.variant === 2 ? 0.35 : 0.85) : info.between && !mood && !info.holding ? 0.12 : 0,
    shout: cheer ? (mood.variant === 2 ? 0.75 : mood.variant === 0 ? 0.45 : 0) : sulk ? 0.14 : 0,
    effort,
  }
}

// Sweat (0 dry .. 1 glistening): it builds while the athlete works (running hard, swinging)
// and dries slowly (faster while resting between points), so it shows late in long rallies
// and over a long match, not after one shot. Returns the new level.
//   act: { speed (m/s), stroke (0..1), between (resting) }
export const stepSweat = (sweat, act = {}, dt = 0) => {
  if (!(dt > 0)) return sweat
  const run = clamp01(((act.speed || 0) - 1.2) / 3.5)
  const work = Math.max(run * 0.7, clamp01(act.stroke || 0))
  const gain = 0.03 * work
  const dry = act.between ? 0.01 : 0.002
  return clamp01(sweat + (gain - dry * sweat) * Math.min(dt, 0.25))
}

// Which face and hair details a detail level draws ("low" never reaches here: Low uses the
// simple figures). Pores are a fine normal detail only High's close-ups show; the hair's
// highlight, the eyelid shadow, the wet eyes, gear sheen and sweat are cheap enough for both.
export const faceDetail = (detail = "medium") => ({
  pores: detail === "high" || detail === "ultra",
  hairSpec: true,
  eyelid: true,
  wetEyes: true,
  gearSheen: true,
  sweat: true,
})
