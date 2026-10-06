// Critter Catch Pinball's creatures and places: 47 original critters (98ish's own, not
// anyone else's), their evolution lines, which table and area each lives in and how rare
// it is there, a line for the Critter Dex, and the look its sprite is built from
// (sprites.js). Pure data plus a few lookups; the rules are in game.js.

export const TYPES = {
  Grass: "green",
  Fire: "fire",
  Water: "blue",
  Electric: "yellow",
  Rock: "brown",
  Ground: "sand",
  Bug: "moss",
  Normal: "grey",
  Flying: "sky",
  Psychic: "pink",
  Ghost: "purple",
  Ice: "ice",
  Dragon: "teal",
}

export const RARITY = { common: 10, uncommon: 4, rare: 1 }
// hits on the critter to catch it, by rarity
export const CATCH_HITS = { common: 3, uncommon: 3, rare: 4, boss: 3 }
export const CATCH_POINTS = { common: 50000, uncommon: 120000, rare: 300000, boss: 500000 }

// Each table's areas: the first three are "nearby" (where a game starts and the first map
// moves go); the last three open after three moves in a game, and hold the rare critters.
export const AREAS = {
  ember: [
    { id: "meadow", name: "Sunny Meadow", sky: "green" },
    { id: "forest", name: "Whisper Forest", sky: "moss" },
    { id: "canyon", name: "Red Canyon", sky: "orange" },
    { id: "volcano", name: "Mt. Cinder", sky: "fire" },
    { id: "ruins", name: "Old Ruins", sky: "sand" },
    { id: "summit", name: "Windy Summit", sky: "sky" },
  ],
  tide: [
    { id: "beach", name: "Shell Beach", sky: "sand" },
    { id: "lagoon", name: "Blue Lagoon", sky: "sky" },
    { id: "reef", name: "Coral Reef", sky: "salmon" },
    { id: "seacave", name: "Sea Cave", sky: "dark" },
    { id: "glacier", name: "Glacier Bay", sky: "ice" },
    { id: "abyss", name: "The Abyss", sky: "navy" },
  ],
}
export const NEAR_AREAS = 3
export const MOVES_TO_UNLOCK = 3

// [id, name, types, stage, evolves to, table, { area: rarity }, Dex line, sprite]
const LIST = [
  // ---- the Ember table ----
  ["sprigling", "Sprigling", ["Grass"], 1, "thornback", "ember", { meadow: "common", forest: "common" }, "A sprout that naps in sunny patches. The leaf on its head turns to follow the light.", { plan: "pear", main: "green", acc: "moss", belly: "cream", ears: "leaf", eyes: "cute", marks: ["cheeks"], size: 0.72 }],
  ["thornback", "Thornback", ["Grass"], 2, "briarking", "ember", { forest: "rare" }, "Grows a coat of soft thorns. They harden when it is scared, so be gentle.", { plan: "quad", main: "green", acc: "pink", belly: "moss", ears: "leaf", eyes: "fierce", marks: ["spikes"], size: 0.86 }],
  ["briarking", "Briarking", ["Grass"], 3, null, "ember", {}, "Rules the deep woods from a throne of roses. Its crown blooms once a year.", { plan: "quad", main: "green", acc: "pink", belly: "moss", ears: "crown", eyes: "fierce", marks: ["spikes", "gem"], size: 1 }],
  ["emberkit", "Emberkit", ["Fire"], 1, "blazefox", "ember", { volcano: "common", canyon: "uncommon" }, "Its tail flickers like a candle. When it is happy, the flame turns bright gold.", { plan: "quad", main: "orange", acc: "fire", belly: "cream", ears: "pointy", tail: "flame", eyes: "cute", size: 0.72 }],
  ["blazefox", "Blazefox", ["Fire"], 2, "infernix", "ember", { volcano: "rare" }, "Runs so fast across the lava fields that it leaves a trail of sparks.", { plan: "quad", main: "red", acc: "fire", belly: "cream", ears: "pointy", tail: "flame", eyes: "fierce", marks: ["mask"], size: 0.88 }],
  ["infernix", "Infernix", ["Fire"], 3, null, "ember", {}, "Stands tall on two legs and breathes a roar of flame. Even the volcano keeps quiet.", { plan: "pear", main: "red", acc: "fire", belly: "cream", ears: "flame", tail: "flame", eyes: "fierce", marks: ["claws", "fangs"], size: 1 }],
  ["sparkit", "Sparkit", ["Electric"], 1, "voltwhisk", "ember", { meadow: "common", summit: "uncommon" }, "A static-charged puffball. Rub its fur and the lights flicker for a mile around.", { plan: "round", main: "yellow", acc: "sky", belly: "cream", ears: "antennae", eyes: "cute", marks: ["stripes"], size: 0.68 }],
  ["voltwhisk", "Voltwhisk", ["Electric"], 2, null, "ember", { summit: "rare" }, "Its whiskers crackle before a storm. Farmers watch it to know when rain is coming.", { plan: "quad", main: "yellow", acc: "sky", belly: "cream", ears: "antennae", tail: "bolt", eyes: "fierce", marks: ["stripes"], size: 0.92 }],
  ["pebblet", "Pebblet", ["Rock"], 1, "bouldrake", "ember", { canyon: "common", summit: "common" }, "Looks like an ordinary stone until it yawns. It sleeps through rockslides.", { plan: "rock", main: "grey", acc: "brown", eyes: "sleepy", size: 0.62 }],
  ["bouldrake", "Bouldrake", ["Rock", "Dragon"], 2, null, "ember", { summit: "rare" }, "A boulder with horns and a temper. It rolls downhill to get anywhere.", { plan: "rock", main: "brown", acc: "grey", ears: "horns", eyes: "fierce", marks: ["claws"], size: 0.95 }],
  ["mothling", "Mothling", ["Bug"], 1, "lumimoth", "ember", { forest: "common" }, "Crawls along leaves at night, munching quietly. Its antennae glow when it is full.", { plan: "bug", main: "moss", acc: "yellow", belly: "cream", ears: "antennae", eyes: "round", size: 0.66 }],
  ["lumimoth", "Lumimoth", ["Bug", "Psychic"], 2, null, "ember", { ruins: "rare" }, "Its wings scatter glowing dust. Travelers follow it home through the dark.", { plan: "bug", main: "purple", acc: "yellow", belly: "cream", ears: "antennae", eyes: "round", marks: ["wings"], size: 0.9 }],
  ["fluffin", "Fluffin", ["Normal"], 1, "cumulamb", "ember", { meadow: "common", summit: "common" }, "So fluffy that it floats a little on windy days. It loves being brushed.", { plan: "round", main: "white", acc: "pink", ears: "round", tail: "fluffy", eyes: "sleepy", marks: ["cheeks"], size: 0.68 }],
  ["cumulamb", "Cumulamb", ["Normal", "Flying"], 2, null, "ember", { summit: "uncommon" }, "Drifts above the summit like a cloud. When it sneezes, it snows.", { plan: "round", main: "white", acc: "sky", belly: "white", ears: "horns", eyes: "sleepy", marks: ["wings"], size: 0.9 }],
  ["hootle", "Hootle", ["Flying"], 1, "owlark", "ember", { forest: "common", ruins: "common" }, "Turns its head all the way around to watch you. It never seems to blink.", { plan: "bird", main: "brown", acc: "orange", belly: "cream", ears: "pointy", eyes: "round", size: 0.7 }],
  ["owlark", "Owlark", ["Flying", "Psychic"], 2, null, "ember", { ruins: "uncommon" }, "Guards the old ruins at night. Its hoot is said to read your thoughts.", { plan: "bird", main: "purple", acc: "yellow", belly: "cream", ears: "crest", eyes: "fierce", size: 0.92 }],
  ["cinderslug", "Cinderslug", ["Fire"], 1, null, "ember", { volcano: "common" }, "Oozes slowly over cooling lava. Its trail stays warm for days.", { plan: "serpent", main: "orange", acc: "fire", belly: "yellow", eyes: "sleepy", marks: ["spots"], size: 0.78 }],
  ["glyphling", "Glyphling", ["Psychic"], 1, "runetotem", "ember", { ruins: "uncommon" }, "A living carving. The marks on its face rearrange themselves into riddles.", { plan: "pear", main: "sand", acc: "purple", belly: "cream", eyes: "glow", marks: ["gem"], size: 0.7 }],
  ["runetotem", "Runetotem", ["Psychic", "Rock"], 2, null, "ember", {}, "Stands perfectly still for centuries, then answers one question and sleeps again.", { plan: "rock", main: "sand", acc: "purple", ears: "crown", eyes: "glow", marks: ["gem"], size: 0.96 }],
  ["dusktail", "Dusktail", ["Ghost"], 1, null, "ember", { ruins: "rare" }, "Seen only at sunset in the corner of your eye. It giggles when you turn to look.", { plan: "ghost", main: "dark", acc: "purple", eyes: "glow", marks: ["grin"], size: 0.82 }],
  ["burrowbun", "Burrowbun", ["Ground"], 1, "diggaroo", "ember", { canyon: "common", meadow: "uncommon" }, "Digs a new burrow every night and forgets where the old ones are.", { plan: "pear", main: "brown", acc: "sand", belly: "cream", ears: "long", tail: "fluffy", eyes: "cute", size: 0.7 }],
  ["diggaroo", "Diggaroo", ["Ground"], 2, null, "ember", { canyon: "uncommon" }, "Its claws dig through stone like sand. Canyons are its doing.", { plan: "pear", main: "brown", acc: "sand", belly: "cream", ears: "long", eyes: "fierce", marks: ["claws"], size: 0.92 }],
  ["magmaw", "Magmaw", ["Fire", "Rock"], 1, null, "ember", { volcano: "rare", summit: "rare" }, "Sleeps inside the volcano. When it wakes, the mountain rumbles.", { plan: "rock", main: "dark", acc: "fire", ears: "spikes", eyes: "glow", glow: "red", marks: ["fangs"], size: 1 }],

  // ---- the Tide table ----
  ["droplet", "Droplet", ["Water"], 1, "splashark", "tide", { beach: "common", lagoon: "common" }, "A drop of sea water that grew a face. It splits in two when it laughs.", { plan: "round", main: "sky", acc: "white", belly: "ice", ears: "crest", eyes: "cute", size: 0.64 }],
  ["splashark", "Splashark", ["Water"], 2, "tsunamaw", "tide", { lagoon: "uncommon" }, "Leaps out of the lagoon to snap at gulls. Mostly it misses and splashes.", { plan: "fish", main: "blue", acc: "sky", belly: "white", eyes: "fierce", marks: ["fangs"], size: 0.86 }],
  ["tsunamaw", "Tsunamaw", ["Water", "Dragon"], 3, null, "tide", {}, "When it surfaces, the tide comes in early. Sailors steer far around it.", { plan: "fish", main: "navy", acc: "teal", belly: "white", ears: "fins", eyes: "fierce", marks: ["fangs", "spikes"], size: 1 }],
  ["shellby", "Shellby", ["Water"], 1, "turtlefort", "tide", { beach: "common" }, "Hides in its shell when the waves get loud. It peeks out to watch sunsets.", { plan: "turtle", main: "teal", acc: "moss", belly: "sand", eyes: "cute", size: 0.7 }],
  ["turtlefort", "Turtlefort", ["Water", "Rock"], 2, null, "tide", { beach: "rare" }, "Its shell is as hard as a castle wall. Hermit critters live on its back.", { plan: "turtle", main: "green", acc: "grey", belly: "sand", ears: "spikes", eyes: "fierce", size: 0.95 }],
  ["coralite", "Coralite", ["Rock"], 1, "reefguard", "tide", { reef: "common" }, "A branch of coral that wandered off. Little fish nap in its arms.", { plan: "plant", main: "salmon", acc: "pink", ears: "spikes", eyes: "cute", size: 0.68 }],
  ["reefguard", "Reefguard", ["Rock", "Water"], 2, null, "tide", { reef: "uncommon" }, "Keeps watch over the reef and shoos away anything that would harm it.", { plan: "rock", main: "salmon", acc: "pink", ears: "spikes", eyes: "fierce", marks: ["claws"], size: 0.92 }],
  ["frostpup", "Frostpup", ["Ice"], 1, "glacihound", "tide", { glacier: "common" }, "Its breath makes tiny snowflakes. It loves to slide down icy slopes.", { plan: "quad", main: "ice", acc: "sky", belly: "white", ears: "pointy", tail: "fluffy", eyes: "cute", size: 0.7 }],
  ["glacihound", "Glacihound", ["Ice"], 2, null, "tide", { glacier: "uncommon" }, "Howls at the aurora. Where it runs, the sea freezes behind it.", { plan: "quad", main: "sky", acc: "ice", belly: "white", ears: "spikes", tail: "fluffy", eyes: "fierce", marks: ["fangs"], size: 0.92 }],
  ["jellume", "Jellume", ["Water", "Electric"], 1, "medusalight", "tide", { lagoon: "common", reef: "common", abyss: "common" }, "Drifts with the current, glowing softly. A touch gives a tingly little zap.", { plan: "jelly", main: "pink", acc: "purple", eyes: "sleepy", size: 0.7 }],
  ["medusalight", "Medusalight", ["Water", "Electric"], 2, null, "tide", { abyss: "uncommon" }, "Lights up the deep like a lantern. Its glow can be seen from the surface.", { plan: "jelly", main: "purple", acc: "yellow", eyes: "glow", marks: ["gem"], size: 0.94 }],
  ["pufflegill", "Pufflegill", ["Water"], 1, null, "tide", { reef: "common" }, "Puffs up into a spiky ball when startled, then floats away embarrassed.", { plan: "fish", main: "yellow", acc: "orange", belly: "cream", eyes: "round", marks: ["spikes", "spots"], size: 0.74 }],
  ["gullet", "Gullet", ["Flying"], 1, "stormgull", "tide", { beach: "common" }, "Steals snacks from picnics, then looks very innocent about it.", { plan: "bird", main: "white", acc: "orange", belly: "cream", eyes: "cute", size: 0.68 }],
  ["stormgull", "Stormgull", ["Flying", "Electric"], 2, null, "tide", { glacier: "uncommon", beach: "rare" }, "Rides the front of thunderstorms out to sea, crying with joy.", { plan: "bird", main: "grey", acc: "yellow", belly: "white", ears: "crest", eyes: "fierce", size: 0.9 }],
  ["crabbit", "Crabbit", ["Water"], 1, "claworth", "tide", { beach: "common", seacave: "common" }, "Scuttles sideways so fast it often forgets which way it was going.", { plan: "crab", main: "red", acc: "salmon", eyes: "cute", size: 0.66 }],
  ["claworth", "Claworth", ["Water"], 2, null, "tide", { seacave: "uncommon" }, "One snap of its claws can crack a coconut. It is very proud of this.", { plan: "crab", main: "red", acc: "orange", ears: "spikes", eyes: "fierce", size: 0.9 }],
  ["snowpip", "Snowpip", ["Ice"], 1, "penguard", "tide", { glacier: "common" }, "Waddles in little lines with its friends and slides home on its belly.", { plan: "pear", main: "navy", acc: "orange", belly: "white", eyes: "cute", size: 0.68 }],
  ["penguard", "Penguard", ["Ice", "Water"], 2, null, "tide", { glacier: "rare" }, "Stands guard over the colony through the longest winter nights.", { plan: "pear", main: "navy", acc: "yellow", belly: "white", ears: "crest", eyes: "fierce", marks: ["claws"], size: 0.92 }],
  ["lanternfin", "Lanternfin", ["Water", "Electric"], 1, null, "tide", { abyss: "rare" }, "Dangles a glowing lure in the dark. Few who follow the light come back to tell.", { plan: "fish", main: "navy", acc: "yellow", belly: "teal", ears: "antennae", eyes: "glow", marks: ["fangs"], size: 0.86 }],
  ["mistwisp", "Mistwisp", ["Ghost", "Ice"], 1, null, "tide", { seacave: "rare" }, "Rises from the sea cave as cold mist. It whispers the names of lost ships.", { plan: "ghost", main: "ice", acc: "sky", eyes: "glow", marks: ["grin"], size: 0.84 }],
  ["leviathorn", "Leviathorn", ["Water", "Dragon"], 1, null, "tide", { abyss: "rare" }, "An ancient sea serpent. Whole islands have turned out to be its back.", { plan: "serpent", main: "teal", acc: "blue", belly: "ice", ears: "horns", eyes: "fierce", marks: ["fangs"], size: 1 }],

  // ---- bonus stage bosses ----
  ["grandmole", "Grandmole", ["Ground"], 1, null, "bonus", {}, "The king of the burrows. Hit enough of its subjects and it comes up to see why.", { plan: "pear", main: "brown", acc: "yellow", belly: "pink", ears: "crown", eyes: "sleepy", marks: ["claws"], size: 1 }],
  ["wispurr", "Wispurr", ["Ghost"], 1, null, "bonus", {}, "Haunts the Phantom Hall, purring and fading in and out. Only quick shots touch it.", { plan: "ghost", main: "purple", acc: "pink", ears: "pointy", eyes: "glow", marks: ["grin"], size: 1 }],
  ["krabaron", "Krabaron", ["Water", "Rock"], 1, null, "bonus", {}, "The armored lord of the tide pools. It sidesteps every shot it sees coming.", { plan: "crab", main: "red", acc: "orange", ears: "crown", eyes: "fierce", size: 1 }],
]

export const CRITTERS = LIST.map(([id, name, types, stage, evolvesTo, table, areas, desc, sprite], i) => ({
  no: i + 1,
  id,
  name,
  types,
  stage,
  evolvesTo,
  table,
  areas,
  desc,
  sprite,
}))

export const BY_ID = Object.fromEntries(CRITTERS.map((c) => [c.id, c]))
for (const c of CRITTERS) if (c.evolvesTo) BY_ID[c.evolvesTo].from = c.id

// the bonus stages, each with its boss
export const BONUS_STAGES = {
  mole: { id: "mole", name: "Burrow Bash", boss: "grandmole", seconds: 60, goal: 8, text: "Bop 8 Mudpups, then the king!" },
  ghost: { id: "ghost", name: "Phantom Hall", boss: "wispurr", seconds: 60, goal: 6, text: "Hit the fading ghost 6 times!" },
  crab: { id: "crab", name: "Tidal Titan", boss: "krabaron", seconds: 60, goal: 7, text: "Hit the crab 7 times, mind the claws!" },
}
// which bonus stages each table takes turns with
export const TABLE_BONUS = { ember: ["mole", "ghost"], tide: ["crab", "ghost"] }

// The critters that can turn up in an area, with weights. A better ball (upgrade level 0..3)
// makes uncommon and rare critters likelier.
export const spawnTable = (areaId, level = 0) =>
  CRITTERS.filter((c) => c.areas[areaId]).map((c) => {
    const r = c.areas[areaId]
    const boost = r === "rare" ? 1 + level * 0.75 : r === "uncommon" ? 1 + level * 0.3 : 1
    return { id: c.id, rarity: r, weight: RARITY[r] * boost }
  })

export const pickCritter = (areaId, level = 0, random = Math.random) => {
  const table = spawnTable(areaId, level)
  const total = table.reduce((n, e) => n + e.weight, 0)
  let r = random() * total
  for (const e of table) {
    r -= e.weight
    if (r < 0) return e
  }
  return table[table.length - 1]
}

// how rare a critter is where it was found (bosses are "boss"; evolved-only critters are rare)
export const rarityOf = (id, areaId) => {
  const c = BY_ID[id]
  if (!c) return "common"
  if (c.table === "bonus") return "boss"
  return c.areas[areaId] || Object.values(c.areas)[0] || "rare"
}

export const areaName = (table, areaId) => (AREAS[table] || []).find((a) => a.id === areaId)?.name || ""

// ---- the Dex (kept per user: { seen: { id: true }, caught: { id: count } }) ----
export const emptyDex = () => ({ seen: {}, caught: {} })
export const cleanDex = (raw) => {
  const dex = emptyDex()
  if (!raw || typeof raw !== "object") return dex
  for (const c of CRITTERS) {
    if (raw.seen?.[c.id]) dex.seen[c.id] = true
    const n = Number(raw.caught?.[c.id])
    if (Number.isFinite(n) && n > 0) {
      dex.caught[c.id] = Math.min(9999, Math.round(n))
      dex.seen[c.id] = true
    }
  }
  return dex
}
export const dexCounts = (dex) => ({
  seen: CRITTERS.filter((c) => dex.seen[c.id] || dex.caught[c.id]).length,
  caught: CRITTERS.filter((c) => dex.caught[c.id]).length,
  total: CRITTERS.length,
})
