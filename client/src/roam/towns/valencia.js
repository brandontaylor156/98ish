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
  eggs,
}
