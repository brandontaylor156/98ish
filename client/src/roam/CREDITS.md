# Roam (Explore Valencia): what it's made from

| What | Source | License | Where |
| --- | --- | --- | --- |
| Streets, buildings, land use, parking lots, trees, street lamps, traffic signals, stop signs, place names | [OpenStreetMap](https://www.openstreetmap.org/copyright) via the Overpass API | ODbL 1.0 (© OpenStreetMap contributors; credited on screen) | `client/public/roam/valencia/`, `/api/town` |
| The ground's height | [AWS Open Data Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (USGS 3DEP in the US) | public domain / open data | baked into the tiles |
| Surface textures on walls, roofs and the ground (stucco, concrete, clay roof tile, grass, asphalt) | [ambientCG](https://ambientcg.com), the venues' set | CC0 1.0 | `client/public/assets/venue-tex/` (credits in its `CREDITS.txt`), lent by the host (`host98.js` > `park/surfaces.js`) |
| The sky the cars reflect | [Poly Haven](https://polyhaven.com) "Park Parking" HDRI | CC0 1.0 | `client/public/assets/venue-tex/hdri/`, lent by the host (`park/environment.js`) |
| Trees, shrubs and hedges (sycamores and planes, oaks, round evergreens, pines; their far billboards) | modelled and painted in code (`render/treekit.js`: canvas-painted leaves, needles, bark, hedge) | 98ish's own | |
| Where the trees and lawns are, and how big | [USGS NAIP](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip) aerial imagery via The National Map | public domain | baked into the tiles (`g`) |
| Palms near you (fan palms with skirts) | drawn in code (`park/detail.js` treeKit: canvas-painted bark and fronds) | 98ish's own | lent by the host |
| Cars (sedan, hatchback, SUV, pickup, the Turbo 98) | modelled in code from real class sizes (`render/carmodel.js`), no makes or badges | 98ish's own | |
| Signals, stop signs, lamp posts, the minimap | drawn in code (`render/street.js`, `ui/Minimap.jsx`) | 98ish's own | |
| The radio and the horn | Web Audio in code (My Park's lo-fi loop, `park/chillmusic.js`; the horn in `host98.js`) | 98ish's own | |
| People | Pickleball 98's athletes (see `components/applets/pickleball/CREDITS.md`) | CC0 bases, 98ish's own animation | lent by the host |

Free CC0 car kits were checked for the 2026-10-09 realism round and not used (toy proportions,
not the realistic look the owner wants): [Kenney Car Kit 3.1](https://kenney.nl/assets/car-kit)
and [rgsdev's Free Low Poly Vehicles Pack](https://opengameart.org/content/free-low-poly-vehicles-pack),
both CC0. Nothing from them is in the repo.

Look references only (nothing copied; they set the Town Center's palette and street trees, 2026-10-09):
Wikimedia Commons "24305 Town Center Drive.jpg" by Coolcaesar (CC BY-SA 4.0), "2000 0820
TowncenterDrive2.jpg" and "Fountain in front of the Edwards Theater ..." by Mrrxx (CC BY-SA 2.5),
"McBean Transit Center, Santa Clarita.jpg" by Ponderosapine210 (CC BY-SA 4.0).
