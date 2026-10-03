// Star power: hit every note of a glowing phrase to charge the meter a quarter; with half a
// meter or more, activate it to double your multiplier until the meter runs dry (a full
// meter lasts 32 beats). Whammy a star power sustain to squeeze out a little more. Pure.

export const PHRASE_BONUS = 0.25
export const ACTIVATE_MIN = 0.5
export const FULL_BEATS = 32
export const WHAMMY_PER_BEAT = 0.034

export const createStar = () => ({ energy: 0, active: false, activations: 0 })

export const award = (star, amount) => {
  star.energy = Math.min(1, star.energy + amount)
  return star.energy
}

export const canActivate = (star) => !star.active && star.energy >= ACTIVATE_MIN - 1e-9

export const activate = (star) => {
  if (!canActivate(star)) return false
  star.active = true
  star.activations++
  return true
}

// Drain while active; returns true when it just ran out
export const drain = (star, dt, spb) => {
  if (!star.active || dt <= 0) return false
  star.energy -= dt / (FULL_BEATS * spb)
  if (star.energy <= 0) {
    star.energy = 0
    star.active = false
    return true
  }
  return false
}

export const whammyGain = (star, dt, spb) => award(star, (dt / spb) * WHAMMY_PER_BEAT)
