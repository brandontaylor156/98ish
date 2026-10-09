// Newport Beach, California: the town round the Tennis & Pickleball Club at Newport Beach (My
// Park's Newport). The origin is the venue's own origin (park/venues/newport.json).
// The coast is the map's own: natural=coastline makes the ocean and the harbour (data/sea.js),
// natural=beach the sand, man_made=pier the piers you can walk out on.
// Everything drawn comes from OpenStreetMap (ODbL) and the AWS terrain tiles; the eggs are
// game items at real mapped places (roam.test.js checks each against the map data).

import eggs from "./newport.eggs.js"

export default {
  id: "newport",
  name: "Newport Beach",
  full: "Newport Beach, CA",
  origin: [33.611121, -117.879536],
  // the Newport Pier and the peninsula to Corona del Mar, the harbour and the Back Bay to
  // Newport Center (about 9.3 x 8.3 km, a quarter of it ocean)
  bbox: { south: 33.583, west: -117.945, north: 33.658, east: -117.845 },
  prebuilt: "/roam/newport",
  // the ocean: drawn where the map's coastline says (data/sea.js)
  coast: true,
  venues: {
    newport: { x: -29, z: 25, yaw: Math.PI, back: { x: -29, z: 25, r: 16 } },
  },
  spawn: { x: -29, z: 25, yaw: Math.PI },
  eggs,
}
