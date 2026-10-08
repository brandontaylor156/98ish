// "Meet me at <venue>": the cards Messenger sends, what Play here and Directions do with them,
// and the where & when sheet's Directions
import test from "node:test"
import assert from "node:assert/strict"
import { realCard, finderCard, meetChoices, venueCardOk, parkHandoff, directionsFor, placeDirections } from "./meet.js"
import { VENUE_LIST } from "../park/venues/index.js"
import { placeById } from "./places.js"
import { fromServer, previewText } from "../../aim/history/historyCore.js"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { cleanCard } = require("../../../../../../server/aim/cards.js")

test("every real venue makes a card the server keeps as it is", () => {
  for (const v of VENUE_LIST) {
    const card = realCard(v.id)
    assert.ok(venueCardOk(card), v.id)
    assert.deepEqual(cleanCard(card), card, `${v.id}: the server keeps it unchanged`)
    assert.equal(card.n, v.name)
    assert.equal(card.lat, v.lat)
    assert.ok(card.a, `${v.id}: a street address (Real Games')`)
  }
  assert.equal(realCard("riverside"), null, "the made-up park isn't a place to meet")
})

test("Venue Finder courts you kept make cards too; the list puts your stars first", () => {
  const kept = { id: "ow123456", title: "Valley Courts", short: "Valley Courts", lat: 34.2, lon: -118.4, town: "Van Nuys", shard: "9q5c", at: 2 }
  const card = finderCard(kept)
  assert.deepEqual(card, { k: "venue", id: "ow123456", n: "Valley Courts", lat: 34.2, lon: -118.4, c: "Van Nuys", sh: "9q5c" })
  assert.deepEqual(cleanCard(card), card)
  assert.equal(finderCard({ ...kept, id: "loscab" }), null)
  assert.equal(finderCard({ ...kept, lat: NaN }), null)
  const { real, finder } = meetChoices({ parkFavs: ["smash"], parkPlaces: { ow123456: kept, ow9: { id: "ow9", title: "Old", lat: 1, lon: 1, at: 1 } } })
  assert.equal(real[0].id, "smash")
  assert.equal(real.length, VENUE_LIST.length)
  assert.deepEqual(finder.map((f) => f.id), ["ow123456", "ow9"], "newest first")
  assert.deepEqual(meetChoices({}).finder, [])
})

test("Play here and Directions", () => {
  const card = realCard("paseo")
  assert.deepEqual(parkHandoff(card), { venue: "paseo" })
  const finder = finderCard({ id: "ow77", title: "Park Courts", lat: 34, lon: -118, shard: "9q5" })
  assert.deepEqual(parkHandoff(finder), { venue: "ow77", place: { title: "Park Courts", lat: 34, lon: -118, shard: "9q5" } })
  assert.equal(parkHandoff({ ...card, id: "zzz" }), null, "not a venue My Park knows")
  assert.equal(parkHandoff({ k: "venue", id: "paseo", n: "x", lat: 999, lon: 0 }), null)
  assert.deepEqual(directionsFor(card), { name: "The Paseo Club", lat: card.lat, lon: card.lon, address: card.a, directions: true })
  // the where & when sheet: real venues and Venue Finder courts, never an arena
  assert.deepEqual(placeDirections(placeById("smash")), directionsFor(realCard("smash")))
  assert.equal(placeDirections(placeById("stadium")), null)
  assert.equal(placeDirections(placeById("park")), null)
  const live = placeById("ow77", { parkPlaces: { ow77: { id: "ow77", title: "Park Courts", lat: 34, lon: -118, town: "Somewhere" } } })
  assert.deepEqual(placeDirections(live), { name: "Park Courts", lat: 34, lon: -118, address: "Somewhere", directions: true })
})

test("Messenger keeps the card with the message and says 'Meet me at' in notifications", () => {
  const card = realCard("loscab")
  const m = fromServer({ id: "a".repeat(20), from: "Rosie", text: "", time: 1, card }, { meKey: "me", ck: "rosie", conv: "Rosie" })
  assert.deepEqual(m.card, card)
  assert.equal(previewText(m), "📍 Meet me at Los Cab Sports Village")
  assert.equal(previewText({ ...m, text: "6?" }), "📍 Meet me at Los Cab Sports Village: 6?")
  assert.equal(fromServer({ id: "b", from: "R", text: "x", time: 1, card: { k: "venue", n: "x" } }).card, undefined, "a card without a place isn't one")
})
