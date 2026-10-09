// Newport Beach's hidden finds: game items at real mapped places (the `place` is the map's own
// name for the feature each one sits at; roam.test.js checks every egg is within 45 m of it in
// the prebuilt tiles, on land or out on a pier's deck). Spots were picked by script as the
// nearest open ground (outside buildings, off the driving lanes, not in the water) to the mapped
// feature; the fisherman stands at the far end of the Newport Pier's deck. Nothing here is a
// building or a business's interior; the words are original.
//
// kind: "disk", "npc", "view", "couple", "car" (eggs.js), and "boat": the harbour's toy
// sailboat (the real boats come with the water phase).

export default [
  { id: "pier-end", kind: "npc", place: "Newport Pier", lat: 33.605967, lon: -117.931412, name: "The Fisherman", text: "\"Caught a floppy disk once. Threw it back. It was only 720 KB.\"" },
  { id: "peninsula", kind: "disk", place: "Peninsula Park", lat: 33.600442, lon: -117.898812, name: "SUNSCRN.SCR", text: "A screensaver of the sun setting over the water, forever. Reapply every 2 hours." },
  { id: "funzone", kind: "disk", place: "Fun Zone Arcade", lat: 33.603278, lon: -117.900144, name: "TICKETS.DAT", text: "4,096 arcade tickets saved to a floppy. Enough for one plastic spider ring." },
  { id: "ferry", kind: "npc", place: "Balboa Island Ferry", lat: 33.603466, lon: -117.90016, name: "The Ferry Pilot", text: "\"Three cars a trip, two minutes across. Faster than a 56K modem, and the view's better.\"" },
  { id: "sailboat", kind: "boat", place: "Marina Park", lat: 33.608478, lon: -117.924015, name: "The Little Sloop", text: "A toy sailboat, painted 98ish teal, with a note tied to the mast: \"Real boats coming soon. Practice your knots.\"" },
  { id: "wedge", kind: "view", place: "Jetty View Park", lat: 33.595584, lon: -117.881989, name: "Jetty View", text: "The harbour mouth and the jetty, with the swell rolling in from the Pacific. Paint couldn't do this blue justice." },
  { id: "lookout", kind: "disk", place: "Lookout Point", lat: 33.595359, lon: -117.877608, name: "HARBOR.MAP", text: "A map of the harbour drawn in MS Paint with the spray can tool. Every boat is a red dot." },
  { id: "inspiration", kind: "couple", place: "Inspiration Point", lat: 33.592388, lon: -117.871624, name: "Two at Inspiration Point", text: "Two initials in a heart, scratched into the rail above the cove, and the whole coast going gold at sunset. It only shows up when you come here together." },
  { id: "pelican", kind: "view", place: "Pelican Point", lat: 33.583459, lon: -117.860757, name: "Pelican Point", text: "The coast running south in one long curve. A pelican glides past at exactly window height." },
  { id: "fashion", kind: "disk", place: "Fashion Island", lat: 33.616389, lon: -117.875163, name: "OUTFIT.BMP", text: "A 16-colour lookbook. Every outfit is teal, purple or both." },
  { id: "sherman", kind: "disk", place: "Sherman Library & Gardens", lat: 33.601979, lon: -117.873643, name: "GARDEN.HLP", text: "A help file for plants: \"To water, press F1. To prune, press Delete. Do not press Format.\"" },
  { id: "civic", kind: "npc", place: "Civic Center Park", lat: 33.612516, lon: -117.869778, name: "The Park Ranger", text: "\"The bunnies here are art. Please don't feed the art.\"" },
  { id: "backbay", kind: "disk", place: "Back Bay View Park", lat: 33.614379, lon: -117.891785, name: "TIDES.XLS", text: "A spreadsheet of the tides with a chart nobody can read. High tide is cell B2." },
  { id: "muth", kind: "npc", place: "Peter and Mary Muth Interpretive Center", lat: 33.653342, lon: -117.885448, name: "The Birdwatcher", text: "\"Forty-two kinds of birds this morning. I logged them all in Notepad. No spellcheck, so one is a 'heron'.\"" },
  { id: "clocktower", kind: "disk", place: "Corona Del Mar Clock Tower", lat: 33.596225, lon: -117.871146, name: "CLOCK.SYS", text: "The clock is set to the right time. The disk insists it's 1998 anyway." },
  { id: "galaxy", kind: "disk", place: "Galaxy View Park", lat: 33.62776, lon: -117.890724, name: "STARS.SCR", text: "The Starfield screensaver, but you can see the bay through it." },
  { id: "surfwagon", kind: "car", place: "Sunset Parks Parking Lot", lat: 33.623054, lon: -117.937905, name: "The Surf Wagon", model: "suv", color: 0x7fd1b9, text: "Seafoam paint, salt on the windows and sand on the floor mats: the Surf Wagon. It smells like sunscreen." },
]
