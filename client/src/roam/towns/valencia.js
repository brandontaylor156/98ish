// Valencia (Santa Clarita, California): the first Roam town. The owner: "At Paseo I'd like to
// actually map out all of Valencia so me and my girlfriend can explore."
//
// The origin is the Paseo Club venue's own origin (park/venues/paseo.json), so My Park's
// Paseo and the town share one frame: walking out of the club puts you on the same spot.
// Everything drawn comes from OpenStreetMap (ODbL) and the AWS terrain tiles; the eggs are
// game items placed at real mapped places (eggs.js checks each against the map data).

import eggs from "./valencia.eggs.js"

export default {
  id: "valencia",
  name: "Valencia",
  full: "Valencia, Santa Clarita, CA",
  origin: [34.436651, -118.562242],
  // the box the prebuilt tiles cover (about 12 x 11 km: Westridge and the coasters to
  // Bouquet Canyon, Copper Hill to the south hills)
  bbox: { south: 34.375, west: -118.63, north: 34.475, east: -118.5 },
  // tiles beyond the box come from the live tile function (client/api/town.js)
  prebuilt: "/roam/valencia",
  // My Park venues in this town: where you come out, and where the way back to the courts is
  // (x east, z south, from the origin)
  venues: {
    paseo: { x: -60, z: 20, yaw: Math.PI, back: { x: -55, z: 14, r: 16 } },
  },
  spawn: { x: -60, z: 20, yaw: Math.PI },
  // where Explore drops you (the owner: "You should have parked me at like, the mall or
  // somewhere fun"): the liveliest real spot first, then a few others; the picker remembers
  // yours. Each is open ground by the mapped place it names (docs/open-world.md "Arriving").
  starts: [
    { id: "mall", name: "Town Center", kind: "mall", place: "Westfield Valencia Center", x: 323, z: 2234, look: { x: 369, z: 2310 } },
    { id: "centralpark", name: "Central Park", kind: "park", place: "Central Park", x: 3755, z: 600, look: { x: 3551, z: 312 } },
    { id: "bridgeport", name: "Bridgeport Park", kind: "park", place: "Bridgeport Park", x: 1278, z: 998, look: { x: 1268, z: 1048 } },
    { id: "paseo", name: "The Paseo Club", kind: "venue", venue: "paseo", x: -60, z: 20, yaw: Math.PI },
  ],
  // Vince's car (My Park's drinks-machine easter egg: his keys unlock it through the host,
  // host.unlocks()): the Sundowner GT, in the Paseo Club's lot, the stall at the north end of its
  // east row by the way out (the lot is the venue's, traced from the aerial: park/venues/
  // paseo.json; OSM hasn't mapped it). A game item, like the Turbo 98.
  keyCar: { id: "sundowner", model: "sundowner", color: 0xc8431f, x: -50.8, z: 10.3, yaw: -1.67, place: "The Paseo Club's lot" },
  eggs,
}
