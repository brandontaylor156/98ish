// My Park: your park game played on the court you walked up to. The engine's venue (venue.js
// buildVenue's shape) built from the park's own picture (build.js), moved so that court's
// frame is the engine's (the net along x at the origin): the other courts, the fences, the
// buildings and the hall are all round you, exactly as you left them.

import * as THREE from "three"
import { VENUES } from "../venue.js"
import { buildPark } from "./build.js"
import { dayLook, hourOf } from "./sky.js"

export const buildCourtVenue = (scene, { layout, courtId = null, quality = "medium", hour = null, look = null, phone = false } = {}) => {
  const c = courtId === "machine" ? layout.MACHINE_COURT : layout.COURTS.find((k) => k.id === courtId) || layout.COURTS[0]
  const holder = new THREE.Group()
  // (buildPark adds its group to what it's given and sets fog on it: a stand-in "scene")
  // (an indoor venue: a cutaway, so the match camera outside the walls sees in)
  const park = buildPark(holder, { quality, layout, cutaway: !!layout.spec.indoor, phone })
  // (the park's look when it has one: Real Sky's true sun, sky and weather)
  const d = look || dayLook(hour ?? hourOf())
  park.setDayLook(d)
  // the sun's shadow box and the sky centred on this court (the park centres them on its walking
  // camera; a match never moves them, and at a big venue the court sat outside the shadow box)
  park.followSky?.({ x: c.x, z: c.z })
  // the court's frame -> the engine's: turn by -rot about the court's middle
  holder.rotation.y = -c.rot
  const off = new THREE.Vector3(c.x, 0, c.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -c.rot)
  holder.position.set(-off.x, 0, -off.z)
  holder.updateMatrixWorld(true)
  scene.add(holder)
  scene.fog = holder.fog || new THREE.Fog(0xd8ecfb, 60, 180)
  // (no umpire's chair: real courts don't have one, and at a venue whose courts sit a metre
  // apart it stood in the next court and in the divider; the engine seats no umpire without a
  // seat. The umpire's voice still calls the score.)
  const base = VENUES.park
  const def = { ...base, id: `park:${layout.id}`, name: `${layout.name} · ${c.name}`, short: `${layout.spec?.short || layout.name} · ${c.name}`, crowd: 0, exposure: d.exposure ?? 1, toneMapping: park.toneMapping }
  return {
    group: holder,
    def,
    sun: park.sun,
    crowd: null,
    umpireSeat: null,
    update: park.update || undefined,
    dispose() {
      park.dispose()
      scene.remove(holder)
      scene.fog = null
    },
  }
}
