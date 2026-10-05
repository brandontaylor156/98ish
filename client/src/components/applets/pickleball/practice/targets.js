// Pickleball 98 practice: target zones on the other side of the net. Each is a rectangle
// on their court ({ x0, x1, z0, z1 } in meters, z < 0) worth some points; a landing in one
// lights it up (practice/layer.js draws them). Pure JavaScript.

import { HALF_L, HALF_W, KITCHEN } from "../physics.js"

const W = HALF_W
const zone = (id, x0, x1, z0, z1, pts, label) => ({ id, x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), pts, label })

// sets of zones by what you're practicing
export const ZONE_SETS = {
  // dinks: the kitchen, best cross-court (to your left: their right, -x) and down the sides
  kitchen: [zone("k-cross", -W, -1.0, -KITCHEN, -0.25, 3, "Cross-court"), zone("k-mid", -1.0, 1.0, -KITCHEN, -0.25, 1, "Middle"), zone("k-line", 1.0, W, -KITCHEN, -0.25, 2, "Down the line")],
  // drops and resets: anywhere in the kitchen, or just past it
  drop: [zone("d-kitchen", -W, W, -KITCHEN, -0.25, 3, "Kitchen"), zone("d-close", -W, W, -(KITCHEN + 1.2), -KITCHEN, 1, "Close")],
  // drives, returns, lobs: deep, best in the corners
  deep: [zone("deep-l", -W, -1.0, -HALF_L, -(HALF_L - 2.0), 3, "Deep corner"), zone("deep-m", -1.0, 1.0, -HALF_L, -(HALF_L - 2.0), 2, "Deep middle"), zone("deep-r", 1.0, W, -HALF_L, -(HALF_L - 2.0), 3, "Deep corner")],
  // volleys and speed-ups: at their feet (the transition zone), or deep
  feet: [zone("f-feet", -W, W, -(KITCHEN + 1.8), -KITCHEN, 3, "At their feet"), zone("f-deep", -W, W, -HALF_L, -(HALF_L - 1.6), 1, "Deep")],
  // overheads: the open corners
  smash: [zone("s-l", -W, -0.9, -(HALF_L - 0.3), -1.4, 3, "Corner"), zone("s-r", 0.9, W, -(HALF_L - 0.3), -1.4, 3, "Corner"), zone("s-m", -0.9, 0.9, -(HALF_L - 0.3), -1.4, 1, "Middle")],
  // serves from your right court go into their right box (x < 0): deep is best
  serve: [zone("sv-deep", -W, 0, -HALF_L, -(HALF_L - 1.5), 3, "Deep serve"), zone("sv-box", -W, 0, -(HALF_L - 1.5), -KITCHEN, 1, "In the box")],
}

// the zones that fit a machine shot type
export const zonesFor = (shot) => ZONE_SETS[{ dink: "kitchen", drop: "drop", drive: "deep", volley: "feet", lob: "smash", mix: "kitchen", serve: "serve", return: "deep", reset: "drop", hands: "feet" }[shot] || "deep"]

// which zone a landing is in (the first that holds it), or null
export const zoneAt = (l, zones) => (l && zones ? zones.find((z) => l.x >= z.x0 && l.x <= z.x1 && l.z >= z.z0 && l.z <= z.z1) || null : null)
