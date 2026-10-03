// The rock meter: how the crowd feels about you, 0 to 1. Hits push it up, misses and wrong
// notes pull it down; at zero you're booed off the stage (unless No-Fail is on). Harder
// parts forgive less. The break-even hit rate is about 54% on Easy and 68% on Expert. Pure.

export const METER = {
  easy: { hit: 0.03, miss: 0.035, wrong: 0.015 },
  medium: { hit: 0.025, miss: 0.038, wrong: 0.018 },
  hard: { hit: 0.022, miss: 0.04, wrong: 0.02 },
  expert: { hit: 0.02, miss: 0.042, wrong: 0.021 },
}

export const createMeter = (difficulty) => ({ value: 0.5, rates: METER[difficulty] || METER.medium, lowest: 0.5 })

const set = (m, v) => {
  m.value = Math.min(1, Math.max(0, v))
  m.lowest = Math.min(m.lowest, m.value)
  return m.value
}

// star power: hits count double
export const meterHit = (m, starActive = false) => set(m, m.value + m.rates.hit * (starActive ? 2 : 1))
export const meterMiss = (m) => set(m, m.value - m.rates.miss)
export const meterWrong = (m) => set(m, m.value - m.rates.wrong)
export const meterBoost = (m, amount) => set(m, m.value + amount)

export const zoneOf = (value) => (value < 1 / 3 ? "red" : value < 2 / 3 ? "yellow" : "green")
export const failed = (m) => m.value <= 0
