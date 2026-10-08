// Pickleball 98's Play: where you play and on which court.
// node --test client/src/components/applets/pickleball/play/play.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { currentPlace, placeById, placeLists, placeText } from "./places.js"
import { cameraBlockers, pickCourt } from "./courtpick.js"
import { venueLayoutSpec } from "../park/venuegen.js"
import { makeLayout } from "../park/layout.js"
import { VENUE_LIST } from "../park/venues/index.js"

const layoutOf = (id) => makeLayout(venueLayoutSpec(JSON.parse(readFileSync(new URL(`../park/venues/${id}.json`, import.meta.url), "utf8"))))

test("where you play: every My Park real venue, your Venue Finder courts, the arenas", () => {
  const prefs = { parkFavs: ["bouquet"], parkPlaces: { ow123: { id: "ow123", title: "Pickleball courts, Hilo", town: "Hilo", lat: 19.7, lon: -155.08, lit: true, at: 5 }, ow9: { id: "ow9", title: "No position" } } }
  const { real, finder, arenas } = placeLists(prefs)
  assert.deepEqual(real.map((p) => p.id).sort(), VENUE_LIST.map((v) => v.id).sort())
  assert.equal(real[0].id, "bouquet", "starred first")
  assert.deepEqual(finder.map((p) => p.id), ["ow123"], "kept Venue Finder courts with a position")
  assert.deepEqual(arenas.map((p) => p.id), ["park", "club", "beach", "winter", "stadium"])
  assert.equal(placeById("newport").kind, "real")
  assert.equal(placeById("ow123", prefs).kind, "live")
  assert.equal(currentPlace({ venue: "gone" }).id, "park", "an unknown venue falls back to Riverside Park")
  // the time shows for real venues; an arena keeps its own light; no night where there are no lights
  assert.equal(placeText(placeById("newport"), "golden"), "Newport Beach Club · Golden hour")
  assert.equal(placeText(placeById("sinaloa"), "night"), "Sinaloa MS · Now")
  assert.equal(placeText(placeById("stadium"), "morning"), "Center Court · Night")
})

test("which court: a clear camera (SMASH's spine and Court 9's wall), or the court you walked to", () => {
  const smash = layoutOf("smash")
  const c = pickCourt(smash)
  assert.equal(cameraBlockers(smash, c), 0)
  assert.ok(cameraBlockers(smash, smash.COURTS[0]) > 0, "SMASH's first live court has the lounge spine behind it")
  assert.equal(pickCourt(smash, smash.COURTS[2].id).id, smash.COURTS[2].id, "your court when you walked to one")
  for (const id of VENUE_LIST.map((v) => v.id)) {
    const L = layoutOf(id)
    assert.equal(cameraBlockers(L, pickCourt(L)), 0, `${id}: a clear camera`)
  }
})
