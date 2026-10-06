// My Park: a body up on a floor above the ground (a stair, a rooftop terrace). The animation
// works at ground level; liftPose raises a pose's points by y and leaves its directions alone
// (the spine, the shoulders' line, where the paddle's face points). Pure; Node-tested.

// (keys that are directions, not places: anim.js poses)
const DIRS = new Set(["pelvisRight", "spine", "chestRight", "chestForward", "look", "axis", "normal", "dir", "up"])
const isPoint = (v) => v && typeof v === "object" && typeof v.x === "number" && typeof v.y === "number" && typeof v.z === "number"

export const liftPose = (pose, y) => {
  if (!y || !pose) return pose
  const lift = (o, depth) => {
    const out = Array.isArray(o) ? [] : {}
    for (const [k, v] of Object.entries(o)) {
      if (k === "info" || DIRS.has(k) || !v || typeof v !== "object") out[k] = v
      else if (isPoint(v)) out[k] = { ...v, y: v.y + y }
      else out[k] = depth < 3 ? lift(v, depth + 1) : v
    }
    return out
  }
  const out = lift(pose, 0)
  out.lift = y
  return out
}
