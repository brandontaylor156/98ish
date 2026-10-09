# Roam (Explore Valencia): what it's made from

| What | Source | License | Where |
| --- | --- | --- | --- |
| Streets, buildings, land use, parking lots, trees, street lamps, traffic signals, stop signs, place names | [OpenStreetMap](https://www.openstreetmap.org/copyright) via the Overpass API | ODbL 1.0 (© OpenStreetMap contributors; credited on screen) | `client/public/roam/valencia/`, `/api/town` |
| The ground's height | [AWS Open Data Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (USGS 3DEP in the US) | public domain / open data | baked into the tiles |
| Surface textures on walls, roofs and the ground (stucco, concrete, clay roof tile, grass, asphalt) | [ambientCG](https://ambientcg.com), the venues' set | CC0 1.0 | `client/public/assets/venue-tex/` (credits in its `CREDITS.txt`), lent by the host (`host98.js` > `park/surfaces.js`) |
| The sky the cars reflect | [Poly Haven](https://polyhaven.com) "Park Parking" HDRI | CC0 1.0 | `client/public/assets/venue-tex/hdri/`, lent by the host (`park/environment.js`) |
| Trees near you (broad-leaf, fan palms) | drawn in code (`park/detail.js` treeKit: canvas-painted leaves, bark and fronds) | 98ish's own | lent by the host |
| Cars (sedan, hatchback, SUV, pickup, the Turbo 98) | modelled in code from real class sizes (`render/carmodel.js`), no makes or badges | 98ish's own | |
| Signals, stop signs, lamp posts, the minimap | drawn in code (`render/street.js`, `ui/Minimap.jsx`) | 98ish's own | |
| The radio and the horn | Web Audio in code (My Park's lo-fi loop, `park/chillmusic.js`; the horn in `host98.js`) | 98ish's own | |
| People | Pickleball 98's athletes (see `components/applets/pickleball/CREDITS.md`) | CC0 bases, 98ish's own animation | lent by the host |

Free CC0 car kits were checked for the 2026-10-09 realism round and not used (toy proportions,
not the realistic look the owner wants): [Kenney Car Kit 3.1](https://kenney.nl/assets/car-kit)
and [rgsdev's Free Low Poly Vehicles Pack](https://opengameart.org/content/free-low-poly-vehicles-pack),
both CC0. Nothing from them is in the repo.
