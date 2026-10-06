// Instant Replay Reels: the cut, as a list of segments (pure).
//   buildTimeline(moments, { hasVideo, maxSec }) -> { segments, duration }
// A segment: { kind: "title" | "footage" | "cutin" | "challenge" | "end", start, dur, m, t0, t1 }
//   footage   the filmed video from t0 to t1 (video seconds)
//   cutin     the 3D replay of the rally from a broadcast angle (t0..t1, replay seconds)
//   challenge the Hawk-Eye view of a close call, slowed down (t0..t1 of real time around the bounce)
// Without video, every moment is a 3D cut-in. The very best moment always gets its 3D cut-in.

export const TIMING = { title: 2.5, end: 3.5, pre: 1.2, post: 1.0, maxFootage: 12, maxCutin: 8, challenge: 3, challengeSlow: 0.4, fade: 0.35 }

export const buildTimeline = (moments, { hasVideo = false, maxSec = 60, timing = TIMING } = {}) => {
  const T = { ...TIMING, ...timing }
  const plan = (list) => {
    const segs = [{ kind: "title", dur: T.title }]
    for (const m of list) {
      const r = m.rally
      const len = Math.max(0.5, r.end - r.start)
      if (hasVideo) {
        const t0 = Math.max(0, r.start - T.pre)
        const t1 = Math.min(t0 + T.maxFootage, r.end + T.post)
        segs.push({ kind: "footage", dur: t1 - t0, m, t0, t1 })
      }
      if (!hasVideo || m.best) {
        const t0 = r.start
        const t1 = r.start + Math.min(len + 0.4, T.maxCutin)
        segs.push({ kind: "cutin", dur: t1 - t0, m, t0, t1 })
      }
      if (m.call) {
        // real time around the bounce, played at challengeSlow: dur = window / slow
        const win = T.challenge * T.challengeSlow
        const t0 = Math.max(r.start, m.call.t - win * 0.6)
        segs.push({ kind: "challenge", dur: T.challenge, m, t0, t1: t0 + win })
      }
    }
    segs.push({ kind: "end", dur: T.end })
    let at = 0
    for (const s of segs) {
      s.start = round(at)
      s.dur = round(s.dur)
      at += s.dur
    }
    return { segments: segs, duration: round(at) }
  }
  // drop the weakest non-best moments until it fits
  let list = [...moments]
  let out = plan(list)
  while (out.duration > maxSec && list.length > 1) {
    const weakest = list.filter((m) => !m.best).sort((a, b) => a.score - b.score)[0]
    if (!weakest) break
    list = list.filter((m) => m !== weakest)
    out = plan(list)
  }
  // still long (huge rallies): shorter footage and cut-ins until it fits
  while (out.duration > maxSec && (T.maxFootage > 3 || T.maxCutin > 3)) {
    T.maxFootage = Math.max(3, T.maxFootage - 1)
    T.maxCutin = Math.max(3, T.maxCutin - 1)
    out = plan(list)
  }
  return { ...out, moments: list }
}

// how faded a frame is at time `t` within a segment (0 = clear, 1 = black)
export const fadeAt = (seg, t, fade = TIMING.fade) => {
  const into = t - seg.start
  const left = seg.start + seg.dur - t
  const a = Math.max(0, 1 - into / fade, 1 - left / fade)
  return Math.min(1, a)
}

const round = (v) => Math.round(v * 1000) / 1000
