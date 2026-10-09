// Simi Valley, California: the town round Sinaloa Middle School's courts (My Park's Sinaloa).
// The owner: "Do the same thing for Simi Valley". The origin is the Sinaloa venue's own origin
// (park/venues/sinaloa.json), so My Park's courts and the town share one frame.
// Everything drawn comes from OpenStreetMap (ODbL) and the AWS terrain tiles; the eggs are
// game items at real mapped places (roam.test.js checks each against the map data).

import eggs from "./simi.eggs.js"

export default {
  id: "simi",
  name: "Simi Valley",
  full: "Simi Valley, CA",
  origin: [34.265631, -118.785571],
  // the valley floor from Wood Ranch and the Reagan Library hills to Happy Face Hill
  // (about 15.6 x 7.8 km)
  bbox: { south: 34.235, west: -118.835, north: 34.305, east: -118.665 },
  prebuilt: "/roam/simi",
  venues: {
    sinaloa: { x: -47, z: 116, yaw: Math.PI, back: { x: -47, z: 116, r: 16 } },
  },
  spawn: { x: -47, z: 116, yaw: Math.PI },
  // where Explore drops you: the liveliest real spot first (docs/open-world.md "Arriving")
  starts: [
    { id: "mall", name: "Town Center", kind: "mall", place: "Simi Valley Town Center", x: 1543, z: -2058, look: { x: 1547, z: -2049 } },
    { id: "ranchosimi", name: "Rancho Simi Park", kind: "park", place: "Rancho Simi Community Park", x: 1897, z: -7, look: { x: 1908, z: -5 } },
    { id: "sinaloa", name: "Sinaloa's courts", kind: "venue", venue: "sinaloa", x: -47, z: 116, yaw: Math.PI },
  ],
  eggs,
}
