// My Park: your park game played on the court you walked up to. The engine's venue (venue.js
// buildVenue's shape) built from the park's own picture (build.js), moved so that court's
// frame is the engine's (the net along x at the origin): the other courts, the fences, the
// buildings and the hall are all round you, exactly as you left them.

import * as THREE from "three"
import { NET_POST_X } from "../physics.js"
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
  // an umpire's chair by the net post (the engine seats its umpire there)
  const chair = new THREE.Group()
  const metal = new THREE.MeshLambertMaterial({ color: 0x2b2f36 })
  const legGeo = new THREE.BoxGeometry(0.06, 1.5, 0.06)
  for (const [dx, dz] of [
    [-0.25, -0.25],
    [0.25, -0.25],
    [-0.25, 0.25],
    [0.25, 0.25],
  ]) {
    const leg = new THREE.Mesh(legGeo, metal)
    leg.position.set(dx, 0.75, dz)
    chair.add(leg)
  }
  const seatGeo = new THREE.BoxGeometry(0.6, 0.06, 0.6)
  const seat = new THREE.Mesh(seatGeo, metal)
  seat.position.y = 1.52
  chair.add(seat)
  const UX = NET_POST_X + 1.0
  chair.position.set(UX, 0, 0)
  scene.add(chair)
  const base = VENUES.park
  const def = { ...base, id: `park:${layout.id}`, name: `${layout.name} · ${c.name}`, crowd: 0, exposure: d.exposure ?? 1, toneMapping: park.toneMapping }
  return {
    group: holder,
    def,
    sun: park.sun,
    crowd: null,
    umpireSeat: { x: UX - 0.05, y: 1.58, z: 0, yaw: -Math.PI / 2 },
    update: park.update || undefined,
    dispose() {
      park.dispose()
      scene.remove(holder)
      scene.remove(chair)
      legGeo.dispose()
      seatGeo.dispose()
      metal.dispose()
      scene.fog = null
    },
  }
}
