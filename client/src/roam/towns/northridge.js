// Northridge (Los Angeles, the San Fernando Valley), entered from Wolf + Bear in Van Nuys: the
// box runs from the club's streets north-west through Lake Balboa and the Sepulveda Basin to
// Northridge and the CSUN campus. The origin is the Wolf + Bear venue's own origin
// (park/venues/wolfbear.json), so My Park's hall and the town share one frame.
// Everything drawn comes from OpenStreetMap (ODbL) and the AWS terrain tiles; the eggs are
// game items at real mapped places (roam.test.js checks each against the map data).

import eggs from "./northridge.eggs.js"

export default {
  id: "northridge",
  name: "Northridge",
  full: "Northridge & Van Nuys, Los Angeles, CA",
  origin: [34.180921, -118.458081],
  // Van Nuys (Wolf + Bear) to Northridge and CSUN (about 10.1 x 8.3 km: the Valley is dense,
  // so the box stops just past the campus to keep the download under 10 MB)
  bbox: { south: 34.175, west: -118.562, north: 34.25, east: -118.452 },
  prebuilt: "/roam/northridge",
  venues: {
    wolfbear: { x: -15, z: 30, yaw: 0, back: { x: -15, z: 30, r: 16 } },
  },
  spawn: { x: -15, z: 30, yaw: 0 },
  eggs,
}
