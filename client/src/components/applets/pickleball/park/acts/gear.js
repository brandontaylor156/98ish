// My Park activities: what a player holds (three.js). A figure's paddle hangs in a holder in
// its hand (athlete.js / rig.js: the handle along +y from the grip, the face's normal +z);
// for tennis a racket takes its place, for hoops and the workout the hand is empty.
//
//   gearFig(fig, "paddle" | "racket" | "none", color?)   cheap to call every frame

import * as THREE from "three"

let parts = null
const racketParts = () => {
  if (parts) return parts
  // a 27 x 34 cm head on a throat and a 50 cm handle (a racket is 68.5 cm long)
  const head = new THREE.TorusGeometry(0.15, 0.011, 6, 28)
  head.scale(0.86, 1.1, 1)
  head.translate(0, 0.5, 0)
  const strings = new THREE.CircleGeometry(0.145, 20)
  strings.scale(0.86, 1.1, 1)
  strings.translate(0, 0.5, 0)
  const handle = new THREE.CylinderGeometry(0.016, 0.017, 0.24, 8)
  handle.translate(0, 0.06, 0)
  const throatL = new THREE.CylinderGeometry(0.008, 0.008, 0.2, 5)
  throatL.rotateZ(-0.24)
  throatL.translate(-0.035, 0.27, 0)
  const throatR = new THREE.CylinderGeometry(0.008, 0.008, 0.2, 5)
  throatR.rotateZ(0.24)
  throatR.translate(0.035, 0.27, 0)
  parts = { head, strings, handle, throatL, throatR }
  return parts
}
const mats = new Map()
const matFor = (color) => {
  if (!mats.has(color)) mats.set(color, new THREE.MeshLambertMaterial({ color }))
  return mats.get(color)
}
let stringMat = null
export const makeRacket = (color = "#1d3557") => {
  const p = racketParts()
  const g = new THREE.Group()
  const frame = matFor(color)
  g.add(new THREE.Mesh(p.head, frame), new THREE.Mesh(p.throatL, frame), new THREE.Mesh(p.throatR, frame))
  g.add(new THREE.Mesh(p.handle, matFor("#222428")))
  stringMat ??= new THREE.MeshBasicMaterial({ color: 0xf2f2ea, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false })
  g.add(new THREE.Mesh(p.strings, stringMat))
  g.userData.racket = true
  return g
}

// the hand's gear: the paddle (as made), a racket in its place, or nothing
export const gearFig = (fig, gear = "paddle", color) => {
  const holder = fig?.debug?.paddle
  if (!holder) return false
  const want = gear || "paddle"
  if (holder.userData.gear === want) return true
  holder.userData.gear = want
  let racket = null
  for (const c of holder.children) {
    if (c.userData.racket) racket = c
    else c.visible = want === "paddle"
  }
  if (want === "racket" && !racket) {
    racket = makeRacket(color)
    holder.add(racket)
  }
  if (racket) racket.visible = want === "racket"
  return true
}
