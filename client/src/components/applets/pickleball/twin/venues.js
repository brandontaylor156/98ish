// Twin Replay: where the replay is played. The game's own venues (stadium, Riverside Park...)
// or one of the owner's real venues from My Park, on a chosen court (the park's court venue:
// that court with the whole real place round it). Uses My Park's public loaders only.

import { VENUE_INFO } from "../looks.js"
import { VENUE_LIST } from "../park/venues/index.js"

// the choices: real venues first (they're the point), then the game's
export const venueChoices = () => [
  ...VENUE_LIST.map((v) => ({ id: v.id, name: v.name, short: v.short, real: true, courts: v.courts, indoor: !!v.indoor })),
  ...Object.values(VENUE_INFO).map((v) => ({ id: v.id, name: v.name, short: v.name, real: false })),
]

const layouts = new Map()
const loadLayout = async (id) => {
  if (layouts.has(id)) return layouts.get(id)
  const [L, { loadVenueSpec }, { venueLayoutSpec }] = await Promise.all([import("../park/layout.js"), import("../park/venues/index.js"), import("../park/venuegen.js")])
  const spec = await loadVenueSpec(id)
  const layout = spec ? L.makeLayout(venueLayoutSpec(spec)) : null
  layouts.set(id, layout)
  return layout
}

// the courts of a real venue: [{ id, name }]
export const courtsOf = async (id) => {
  const layout = await loadLayout(id)
  return layout ? layout.COURTS.map((c) => ({ id: c.id, name: c.name })) : []
}

// what engine.playTwin takes as `venue`: a VENUES id, or a court venue builder
export const twinVenue = async (id, courtId = null) => {
  if (!id || VENUE_INFO[id]) return id || "stadium"
  const [layout, { buildCourtVenue }] = await Promise.all([loadLayout(id), import("../park/courtvenue.js")])
  if (!layout) return "stadium"
  const court = courtId ?? layout.COURTS[0]?.id ?? null
  return { key: `twin:${layout.id}:${court}`, build: (scene, o) => buildCourtVenue(scene, { layout, courtId: court, quality: o.quality }), room: layout.spec.indoor ? "hall" : "park" }
}
