// Live Broadcast, the filming side: who hit the ball, as the game goes. Twin Replay finds hits
// after the fact (core/hits.js findHits); live, each paddle pop is matched to a swing as soon
// as the swing after it has been seen (~0.25 s), with the same rules: the hitter is on the
// other team from the last hitter, their wrist peaked within -0.28..+0.18 s of the pop, a
// strong pop accepts a weak swing. Without a microphone, swing peaks alone (team
// alternation, the stronger of two same-team swings). Pure: feed it tracks and onsets.

import { RALLY_GAP, forehandOf, peakNear, swingPeaks, swingSeries } from "../core/hits.js"
import { handHeight } from "../core/tracker.js"

const WINDOW = 1.6 // s of each track looked at

// slots: Map trackId -> slot (the broadcast's player order). Returns { push, poll }.
export const createLiveHits = ({ minSwing = 1.4, settle = 0.25 } = {}) => {
  const pending = [] // onsets waiting for the swing after them
  let lastT = -99
  let lastTeam = null
  const recent = (tr, now) => {
    const out = []
    for (let i = tr.samples.length - 1; i >= 0 && tr.samples[i].t > now - WINDOW; i--) out.push(tr.samples[i])
    return out.reverse()
  }
  const hitFrom = (tr, pk, t, src) => {
    const h = { t, player: tr.id, team: tr.team, hand: pk.hand, sample: pk.sample, source: src }
    const height = pk.sample ? handHeight(pk.sample, pk.hand) : 1
    return { ...h, height: Math.max(0.15, Math.min(2.8, height)), side: forehandOf(h, tr.hand === -1 ? -1 : 1) }
  }
  return {
    // onsets heard: [{ t, strength, bright }] on the same clock as the tracks
    push(onsets) {
      for (const o of onsets) if (!pending.some((p) => Math.abs(p.t - o.t) < 0.2) && o.t > lastT + 0.2) pending.push(o)
    },
    // now: the newest frame's time; tracks: the tracker's live tracks ({ id, team, samples })
    // -> hits decided since the last call
    poll(now, tracks, { sound = true } = {}) {
      const out = []
      const series = new Map(tracks.map((tr) => [tr.id, swingSeries(recent(tr, now))]))
      if (sound) {
        pending.sort((a, b) => a.t - b.t)
        while (pending.length && pending[0].t < now - settle) {
          const o = pending.shift()
          if (o.t - lastT > RALLY_GAP) lastTeam = null
          if (o.t - lastT < 0.3) continue
          let best = null
          for (const tr of tracks) {
            if (lastTeam !== null && tr.team === lastTeam) continue
            const pk = peakNear(series.get(tr.id) || [], o.t)
            if (pk && (!best || pk.smooth > best.pk.smooth)) best = { tr, pk }
          }
          const strong = (o.strength || 0) >= 12 && (o.bright || 0) >= 0.2
          if (!best || best.pk.smooth < (strong ? 0.5 : minSwing)) continue
          out.push(hitFrom(best.tr, best.pk, o.t, "sound"))
          lastTeam = best.tr.team
          lastT = o.t
        }
        return out
      }
      // (no sound: swing peaks, alternating teams. A wind-up and the swing itself are two
      // peaks of the same team: decided only once 0.6 s after a peak has been seen, so the
      // stronger one of the pair is taken, as findHits does afterwards)
      const PAIR = 0.6
      const peaks = []
      for (const tr of tracks) for (const pk of swingPeaks(series.get(tr.id) || [])) if (pk.t > lastT + 0.4) peaks.push({ pk, tr })
      peaks.sort((a, b) => a.pk.t - b.pk.t)
      for (;;) {
        const first = peaks.find(({ pk, tr }) => pk.t > lastT + 0.4 && (lastTeam === null || pk.t - lastT > RALLY_GAP || tr.team !== lastTeam))
        if (!first || first.pk.t > now - settle - PAIR) break
        const team = first.tr.team
        const pick = peaks.filter(({ pk, tr }) => tr.team === team && pk.t >= first.pk.t && pk.t - first.pk.t < PAIR).reduce((a, b) => (b.pk.speed > a.pk.speed ? b : a))
        out.push(hitFrom(pick.tr, pick.pk, pick.pk.t, "swing"))
        lastTeam = team
        lastT = pick.pk.t
      }
      return out
    },
    get lastT() {
      return lastT
    },
  }
}

// track -> broadcast slot: the near team (team 0) fills slots 0..k-1, the far team the rest,
// in the order they're first seen; a slot is never reused for another track
export const createSlots = ({ players = 4 } = {}) => {
  const map = new Map()
  const per = Math.max(1, players / 2)
  const used = [[], []]
  return {
    slotOf(tr) {
      if (map.has(tr.id)) return map.get(tr.id)
      const team = tr.team === 1 ? 1 : 0
      if (used[team].length >= per) return null
      const slot = team * per + used[team].length
      used[team].push(tr.id)
      map.set(tr.id, slot)
      return slot
    },
    get map() {
      return map
    },
  }
}
