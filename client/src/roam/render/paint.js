// Roam: the colours of the town's ground (a tile's land use, parks, water and roads are
// painted into one texture per tile; docs/open-world.md "Rendering"). Pure data.

import { AREA_CLASSES, ROAD } from "../data/tile.js"

// unmapped ground: Southern California's dry hillsides
export const BASE = "#a39b72"
export const AREA_COLORS = {
  res: "#83915e",
  com: "#9b978d",
  ind: "#8f8c85",
  farm: "#a8a46a",
  dirt: "#a88f6a",
  dry: "#b3a571",
  scrub: "#7d8357",
  grass: "#629f43",
  park: "#579c3d",
  wood: "#4f6f3a",
  cemetery: "#6d9150",
  school: "#9b9783",
  sand: "#c9b98d",
  golf: "#5aa04a",
  golfgreen: "#4fb04c",
  parking: "#56585b",
  plaza: "#b9b3a7",
  pitch: "#4f8d47",
  track: "#a9564a",
  playground: "#b59a6e",
  water: "#4b7a96",
  pool: "#3fa6d0",
}
export const areaColor = (cls) => AREA_COLORS[AREA_CLASSES[cls]] || BASE
// a residential area where the aerial says what grows (render/ground.js paints that over it):
// the streets, drives and roofs between the lawns are a warm neutral, not all green
export const RES_WITH_VEG = "#a19c86"
// the aerial's vegetation (data/veg.js VEG: none, dry, green, canopy) as RGBA: a golden dry
// ground, a watered Southern California lawn, the deeper green under trees
export const VEG_PAINT = [null, [190, 168, 108, 105], [92, 158, 60, 235], [70, 128, 48, 235]]

// roads: [fill, curb/edge or null]
export const ROAD_PAINT = {
  [ROAD.motorway]: ["#3a3c3f", "#8b8a86"],
  [ROAD.trunk]: ["#3c3e41", "#8b8a86"],
  [ROAD.primary]: ["#3d3f42", "#9a9893"],
  [ROAD.secondary]: ["#3e4043", "#9a9893"],
  [ROAD.tertiary]: ["#404245", "#9a9893"],
  [ROAD.residential]: ["#46484b", "#a3a19b"],
  [ROAD.unclassified]: ["#46484b", "#a3a19b"],
  [ROAD.living_street]: ["#4a4c4f", "#a3a19b"],
  [ROAD.link]: ["#3c3e41", "#8b8a86"],
  [ROAD.service]: ["#4c4e51", null],
  [ROAD.driveway]: ["#8e8c86", null],
  [ROAD.aisle]: ["#4f5154", null],
  [ROAD.pedestrian]: ["#c8c2b4", null],
  [ROAD.footway]: ["#c9c3b5", null],
  [ROAD.cycleway]: ["#c3bdb0", null],
  [ROAD.steps]: ["#bbb5a8", null],
  [ROAD.path]: ["#b49e78", null],
  [ROAD.track]: ["#a58f69", null],
  [ROAD.rail]: ["#76706a", null],
  [ROAD.river]: ["#b9ab88", null],
  [ROAD.stream]: ["#8f9a7a", null],
}
export const SIDEWALK = "#c4c0b6"
// the sea floor under the water (a coast town)
export const SEA = "#2f5a63"
// round a house: its yard (a watered lawn, a little dry); round other buildings: concrete
export const YARD = "#6e9a4a"
export const APRON = "#aaa69c"
// the order roads are painted in (later on top): water, paths, rail, small roads, big roads
export const ROAD_ORDER = [ROAD.river, ROAD.stream, ROAD.track, ROAD.path, ROAD.footway, ROAD.cycleway, ROAD.steps, ROAD.pedestrian, ROAD.rail, ROAD.driveway, ROAD.aisle, ROAD.service, ROAD.living_street, ROAD.unclassified, ROAD.residential, ROAD.link, ROAD.tertiary, ROAD.secondary, ROAD.primary, ROAD.trunk, ROAD.motorway]

// buildings: wall and roof palettes (original; picked per building by a hash)
export const WALLS = {
  house: [0xe8dcc6, 0xefe6d2, 0xd9c9a8, 0xe4d6bd, 0xcfc2a6, 0xf0ebe0, 0xd8cdb8, 0xc9b89a, 0xe2d2b4],
  shop: [0xd8d2c4, 0xc8c0b0, 0xe2dccf, 0xb9b2a5, 0xd0c6b2, 0xe6e1d6],
  works: [0xc4c4c0, 0xb8bab8, 0xd0ccc4, 0xbfc3c6],
  civic: [0xd9cfbf, 0xcbbfa8, 0xe0d8c8],
}
export const ROOFS = {
  tile: [0x9c5a3c, 0xa8644a, 0x8a5040, 0xa0573a, 0x7e4a36],
  shingle: [0x8a8279, 0x7a746d, 0x938b80, 0x6f6b66, 0x857a6c],
  flat: [0x9a9893, 0xb0aea8, 0x8a8984, 0xa5a39d, 0xc2c0ba],
}
