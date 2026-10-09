// Valencia's hidden finds: game items at real mapped places (the `place` is the map's own name
// for the feature each one sits at; roam.test.js checks every egg is within 45 m of it in the
// prebuilt tiles). Spots were picked by script as the nearest open ground (outside buildings,
// off the driving lanes) to the mapped feature. Nothing here is a building or a business's
// interior; the words are original.
//
// kind: "disk" (one of Floppy's lost disks, glowing), "npc" (someone with a line), "view" (a
// secret viewpoint), "couple" (only there when two of you stand by it together), "car" (the
// hidden Turbo 98: find it by getting in).

export default [
  { id: "paseo", kind: "disk", place: "The Paseo Club", lat: 34.43763, lon: -118.562002, name: "COURTSIDE.TXT", text: "A floppy by the club's front walk. On it: \"Dink responsibly.\" Floppy lost this one chasing a lob." },
  { id: "heritage", kind: "npc", place: "Valencia Heritage Park", lat: 34.433626, lon: -118.558111, name: "The Kite Guy", text: "\"I've been flying this kite since 1998. The string is a really long Ethernet cable.\"" },
  { id: "creek-tunnel", kind: "disk", place: "San Francisquito Creek Trail", lat: 34.433945, lon: -118.560848, name: "ECHO.WAV", text: "By the trail's tunnel under the street: a disk that just says \"echo... echo... echo...\". Sound Recorder would be proud." },
  { id: "library", kind: "npc", place: "Valencia Public Library", lat: 34.415177, lon: -118.551084, name: "The Librarian", text: "\"Shhh. Your Notepad file is 27 years overdue. We'll waive the fine if you save it as .TXT.\"" },
  { id: "cityhall", kind: "disk", place: "Santa Clarita City Hall", lat: 34.412785, lon: -118.553804, name: "FORM_98B.DOC", text: "An application for a lemonade stand, in triplicate. Approved, stamped, and signed by someone named \"Admin\"." },
  { id: "towncenter", kind: "disk", place: "Westfield Valencia Center", lat: 34.416054, lon: -118.558548, name: "SALE.BMP", text: "A shopping bag full of screensavers. The flying teacups are 50% off." },
  { id: "cinema", kind: "npc", place: "Regal Edwards Valencia Stadium 12 & IMAX", lat: 34.418378, lon: -118.561634, name: "The Usher", text: "\"Tonight's double feature: 'The Blue Screen' and 'Please Wait While Setup Copies Files'. Popcorn's on aisle C:.\"" },
  { id: "mcbean", kind: "disk", place: "McBean Regional Transit Station (MRTC)", lat: 34.414081, lon: -118.562322, name: "SCHEDULE.VBP", text: "A bus schedule written in Visual Basic 98. Every bus arrives On_Click." },
  { id: "bridgeport", kind: "disk", place: "Bridgeport Park", lat: 34.427234, lon: -118.548432, name: "DUCKS.MID", text: "The ducks here quack in perfect MIDI. Someone left Music 98 running on a bench." },
  { id: "bear", kind: "disk", place: "Santa Clarita Cycling Bear", lat: 34.423055, lon: -118.541869, name: "BEAR.EXE", text: "The bear is riding a bike. Of course it is. The disk is a training plan: \"Day 1: pedal. Day 2: more pedal.\"" },
  { id: "rivervillage", kind: "disk", place: "River Village Trailhead", lat: 34.42617, lon: -118.536267, name: "TRAILMIX.ZIP", text: "A compressed bag of trail mix. Unzips to 40% raisins, which nobody asked for." },
  { id: "centralbark", kind: "npc", place: "Central Bark", lat: 34.429128, lon: -118.522595, name: "The Dog Walker", text: "\"He only fetches the old ball mice. The new optical ones scare him.\"" },
  { id: "ironhorse", kind: "disk", place: "Iron Horse Trailhead", lat: 34.425413, lon: -118.578159, name: "TRAIN.GIF", text: "An animated GIF of a train that's been loading since dial-up." },
  { id: "coasters", kind: "disk", place: "Six Flags Magic Mountain", lat: 34.424883, lon: -118.596499, name: "LOOPS.CFG", text: "You can hear the coasters from here. The disk: \"max_screams = 9999\". Keep your hands inside the window." },
  { id: "summit", kind: "view", place: "Valencia Summit Park", lat: 34.402822, lon: -118.561142, name: "Summit Lookout", text: "Up on the summit: the whole valley in one screen. Take a screenshot; Paint will want to see it." },
  { id: "pac", kind: "npc", place: "Performing Arts Center", lat: 34.404847, lon: -118.567706, name: "The Stagehand", text: "\"Take a bow. Speed Typist 98 says your applause came in at 120 claps a minute.\"" },
  { id: "glen", kind: "disk", place: "Valencia Glen Park", lat: 34.395199, lon: -118.548624, name: "PICNIC.CAL", text: "A Calendar invite: \"Picnic. Every Saturday. Forever.\" Accepted by 14 ants." },
  { id: "meadows", kind: "disk", place: "Valencia Meadows Park", lat: 34.392531, lon: -118.555618, name: "SWING.AVI", text: "A home video of someone swinging so high they reached Windows 2000." },
  { id: "hills-paseo", kind: "disk", place: "Valencia Hills Paseo", lat: 34.388052, lon: -118.554411, name: "SHORTCUT.LNK", text: "A shortcut to the paseo. Valencia had shortcuts before your desktop did." },
  { id: "hart", kind: "npc", place: "William S. Hart Ranch House", lat: 34.375929, lon: -118.526397, name: "The Ranch Hand", text: "\"Howdy. The bison out back don't use 98 Messenger, but they do leave you on Read.\"" },
  { id: "bouquet", kind: "disk", place: "Bouquet Canyon Park", lat: 34.452927, lon: -118.504838, name: "KITCHEN.RUL", text: "Rule 1: stay out of the kitchen. Rule 2: unless the ball bounced. Rule 3: see Rule 1." },
  { id: "lookout", kind: "couple", place: "Lookout Point", lat: 34.387728, lon: -118.50978, name: "Two at the Lookout", text: "Two names scratched into the railing with a heart round them, and the whole valley lit up below. It only shows up when you come here together." },
  { id: "turbo", kind: "car", place: "Parking Lot 1", lat: 34.40384, lon: -118.567518, name: "The Turbo 98", text: "Teal paint, a pink stripe and a glow underneath: the Turbo 98. It's quick. Don't tell the college." },
]
