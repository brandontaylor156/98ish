// Monster Duel's card pool: every card is data. Monsters have stats; effects are lists of
// steps ("ops") the rules engine (engine.js) knows how to run, so a new card is a new
// entry here, not new code. Plain ES module: the browser and the game server
// (server/arcade/games/monsterduel.js) load this same file.
//
// A card: { id, name, kind: "monster" | "spell" | "trap", sub, rarity: C | R | SR | UR,
//   text, limit (max copies in a deck, default 3), effects: [effect], flags: [flag], ... }
//   monster: attr, race, level, atk, def; sub "normal" | "effect" | "fusion" | "token"
//   spell: sub "normal" | "quick" | "continuous" | "equip" | "field"
//   trap: sub "normal" | "continuous" | "counter"
//   fusion: materials: [card id | filter], one per material
//   equip spells: equip: { atk, def, flags }
//
// effects:
//   { type: "activate", trigger, target, cost, cond, do }  a Spell or Trap card's activation.
//        trigger (traps): "any" | "attack" (an opponent's monster declares an attack) |
//        "oppSummon" (your opponent Summons) | "chain" (in answer to an activation; chainKinds)
//   { type: "trigger", on, target, do }  happens by itself (on: normalSummon | summon | flip |
//        destroyed | destroyedBattle | battleDestroy | battleDamage | standby)
//   { type: "ignition", once, cost, target, do }  a monster's "once per turn" ability
//   { type: "aura", side, filter, self, notSelf, atk, def, flags }  always on while face-up
//
// selectors (targets, "all" and counts): { from: monsters | spells | field | hand | gy | deck
//   | event | attacker, side: self | opp | both, filter: { kind, race, races, attr, up, pos,
//   atkMin, atkMax, defMax, levelMax, sub, ids, notIds }, n, min }
// ops: damage heal draw destroy bounce banish shuffle buff position search special summon
//   summonSelf token discard mill negate negateAttack endBattle equip fusion flag control coin
//   (see engine.js runOp for what each one takes)
// flags: pierce | twice | direct | noBattleDestroy | noEffectDestroy | cannotAttack

export const ATTRS = ["FIRE", "WATER", "EARTH", "WIND", "LIGHT", "DARK"]
export const RACES = ["Dragon", "Machine", "Spellcaster", "Aqua", "Fish", "Serpent", "Insect", "Warrior", "Zombie", "Plant", "Beast", "Winged Beast", "Rock"]

// ---------- little builders ----------

const mon = (id, name, attr, race, level, atk, def, rarity, text, more = {}) => ({
  id,
  name,
  kind: "monster",
  sub: more.effects || more.flags ? "effect" : "normal",
  attr,
  race,
  level,
  atk,
  def,
  rarity,
  text,
  ...more,
})
const spell = (id, name, sub, rarity, art, text, effects, more = {}) => ({ id, name, kind: "spell", sub, rarity, art, text, effects, ...more })
const trap = (id, name, sub, rarity, art, text, effects, more = {}) => ({ id, name, kind: "trap", sub, rarity, art, text, effects, ...more })

const on = (when, ops, more = {}) => ({ type: "trigger", on: when, do: ops, ...more })
const ignition = (ops, more = {}) => ({ type: "ignition", once: true, do: ops, ...more })
const aura = (a) => ({ type: "aura", ...a })
const act = (ops, more = {}) => ({ type: "activate", trigger: "any", do: ops, ...more })

// selectors
const oppMonster = (filter = {}) => ({ from: "monsters", side: "opp", filter, n: 1 })
const anyMonster = (filter = {}) => ({ from: "monsters", side: "both", filter, n: 1 })
const myMonster = (filter = {}) => ({ from: "monsters", side: "self", filter: { up: true, ...filter }, n: 1 })
const oppST = { from: "spells", side: "opp", n: 1 }
const anyST = { from: "spells", side: "both", n: 1 }
const myGy = (filter = {}) => ({ from: "gy", side: "self", filter: { kind: "monster", ...filter }, n: 1 })

const D = (n) => [{ op: "draw", to: "self", n }]
const destroyT = [{ op: "destroy", what: "targets" }]
const search = (filter, from = "deck") => ({ op: "search", from, filter })
const special = (from, filter, pos = "atk", more = {}) => ({ op: "special", from, filter: { kind: "monster", ...filter }, pos, ...more })

// ---------- Dragons ----------

const dragons = [
  mon("D01", "Cinder Whelp", "FIRE", "Dragon", 3, 1200, 900, "C", "When this card is destroyed by battle: add 1 Level 4 or lower Dragon monster from your Deck to your hand.", {
    effects: [on("destroyedBattle", [search({ kind: "monster", race: "Dragon", levelMax: 4 })])],
  }),
  mon("D02", "Emberscale Drake", "FIRE", "Dragon", 4, 1800, 1200, "C", "Its scales stay warm for days after a fight. Mountain villages hang the shed ones over their hearths."),
  mon("D03", "Skyfin Wyvern", "WIND", "Dragon", 4, 1600, 1200, "C", "If this card attacks a Defense Position monster with lower DEF than its ATK, your opponent takes the difference as battle damage.", { flags: ["pierce"] }),
  mon("D04", "Ashwing Scout", "WIND", "Dragon", 2, 700, 600, "C", "FLIP: Add 1 Dragon monster from your Deck to your hand.", {
    effects: [on("flip", [search({ kind: "monster", race: "Dragon" })])],
  }),
  mon("D05", "Magma Hatchling", "FIRE", "Dragon", 1, 300, 200, "R", "When this card is destroyed: Special Summon 1 Level 4 or lower Dragon monster from your Deck in Attack Position.", {
    effects: [on("destroyed", [special("deck", { race: "Dragon", levelMax: 4 })])],
  }),
  mon("D06", "Thunderhorn Dragon", "WIND", "Dragon", 5, 2300, 1500, "R", "When this card is Normal Summoned: inflict 500 damage to your opponent.", {
    effects: [on("normalSummon", [{ op: "damage", to: "opp", n: 500 }])],
  }),
  mon("D07", "Obsidian Wyrm", "DARK", "Dragon", 6, 2400, 2000, "R", "When this card destroys a monster by battle: inflict 500 damage to your opponent.", {
    effects: [on("battleDestroy", [{ op: "damage", to: "opp", n: 500 }])],
  }),
  mon("D08", "Dawnflare Sovereign", "LIGHT", "Dragon", 8, 3000, 2500, "UR", "When it spreads its wings at sunrise the whole sky catches fire. Legends say it has never once lost a staring contest."),
  mon("D09", "Stormcaller Wyrm", "WIND", "Dragon", 7, 2600, 2100, "SR", "When this card is Normal Summoned: destroy 1 Spell or Trap card your opponent controls.", {
    effects: [on("normalSummon", destroyT, { target: oppST })],
  }),
  mon("D10", "Pyre Drakeling", "FIRE", "Dragon", 4, 1500, 1000, "C", "Once per turn: you can discard 1 card; this card gains 700 ATK until the end of this turn.", {
    effects: [ignition([{ op: "buff", what: "self", atk: 700, until: "turn" }], { cost: { discard: 1 } })],
  }),
  mon("D11", "Drake Herald", "FIRE", "Dragon", 3, 1000, 1000, "R", "Dragon monsters you control gain 300 ATK.", {
    effects: [aura({ side: "self", filter: { race: "Dragon" }, atk: 300 })],
  }),
  mon("D12", "Glacier Wyrm", "WATER", "Dragon", 5, 2000, 2400, "C", "It sleeps inside a glacier and wakes once a century to stretch. Avalanches follow."),
  mon("D13", "Twinflame Hydra", "FIRE", "Dragon", 6, 2200, 1800, "SR", "This card can attack twice during each Battle Phase.", { flags: ["twice"] }),
  mon("D14", "Ember Egg", "FIRE", "Dragon", 1, 0, 1500, "R", "FLIP: Special Summon 1 Dragon monster from your hand.", {
    effects: [on("flip", [special("hand", { race: "Dragon" })])],
  }),
]

// ---------- Machines ----------

const machines = [
  mon("M01", "Gearbolt Sentry", "EARTH", "Machine", 4, 1500, 1800, "C", "A watchtower on legs. It has guarded the same bridge for three hundred years and still asks for a password."),
  mon("M02", "Rivet Hound", "EARTH", "Machine", 3, 1300, 800, "C", 'When this card is Normal Summoned: Special Summon 1 "Rivet Hound" from your Deck in Defense Position.', {
    effects: [on("normalSummon", [special("deck", { ids: ["M02"] }, "def")])],
  }),
  mon("M03", "Clockwork Bulwark", "EARTH", "Machine", 3, 0, 1800, "R", "Cannot be destroyed by battle.", { flags: ["noBattleDestroy"] }),
  mon("M04", "Steamjack Brawler", "FIRE", "Machine", 4, 1800, 1000, "C", "Built for the boxing circuit, retired for denting the arena. It still shadowboxes in the scrapyard at night."),
  mon("M05", "Spark Drone", "LIGHT", "Machine", 2, 500, 500, "C", 'When this card is destroyed: Special Summon 2 "Drone Tokens" (Machine/LIGHT/Level 1/ATK 500/DEF 500) in Defense Position.', {
    effects: [on("destroyed", [{ op: "token", id: "K01", n: 2, pos: "def" }])],
  }),
  mon("M06", "Assembly Arm", "EARTH", "Machine", 3, 1000, 1200, "C", "Once per turn: target 1 face-up Machine monster you control; it gains 600 ATK until the end of this turn.", {
    effects: [ignition([{ op: "buff", what: "targets", atk: 600, until: "turn" }], { target: myMonster({ race: "Machine" }) })],
  }),
  mon("M07", "Ironclad Colossus", "EARTH", "Machine", 7, 2700, 2900, "SR", "If this card attacks a Defense Position monster with lower DEF than its ATK, your opponent takes the difference as battle damage.", { flags: ["pierce"] }),
  mon("M08", "Overclock Titan", "DARK", "Machine", 5, 2400, 1200, "R", "During your Standby Phase: you take 300 damage.", {
    effects: [on("standby", [{ op: "damage", to: "self", n: 300 }])],
  }),
  mon("M09", "Scrapyard Recycler", "EARTH", "Machine", 4, 1200, 1500, "C", "When this card is Normal Summoned: add 1 Machine monster from your Graveyard to your hand.", {
    effects: [on("normalSummon", [search({ kind: "monster", race: "Machine" }, "gy")])],
  }),
  mon("M10", "Tesla Lancer", "LIGHT", "Machine", 5, 2100, 1200, "R", "When this card is Normal Summoned: inflict 300 damage to your opponent for each Machine monster you control.", {
    effects: [on("normalSummon", [{ op: "damage", to: "opp", n: { per: 300, count: { from: "monsters", side: "self", filter: { race: "Machine" } } } }])],
  }),
  mon("M11", "Gyro Interceptor", "WIND", "Machine", 4, 1400, 1400, "C", "FLIP: Destroy 1 Spell or Trap card on the field.", {
    effects: [on("flip", destroyT, { target: anyST })],
  }),
  mon("M12", "Mainframe Overlord", "DARK", "Machine", 8, 2800, 2600, "UR", "Gains 200 ATK for each Machine monster in your Graveyard.", {
    effects: [aura({ self: true, atk: { per: 200, count: { from: "gy", side: "self", filter: { kind: "monster", race: "Machine" } } } })],
  }),
  mon("M13", "Calibrator Bot", "LIGHT", "Machine", 1, 100, 100, "R", "FLIP: Special Summon 1 Level 4 or lower Machine monster from your Deck.", {
    effects: [on("flip", [special("deck", { race: "Machine", levelMax: 4 })])],
  }),
  mon("M14", "Junkyard Crawler", "EARTH", "Machine", 2, 800, 1000, "C", "When this card is destroyed by battle: inflict 600 damage to your opponent.", {
    effects: [on("destroyedBattle", [{ op: "damage", to: "opp", n: 600 }])],
  }),
]

// ---------- Spellcasters ----------

const casters = [
  mon("S01", "Apprentice Runecaller", "LIGHT", "Spellcaster", 3, 1100, 1000, "C", "When this card is Normal Summoned: add 1 Spell card from your Graveyard to your hand.", {
    effects: [on("normalSummon", [search({ kind: "spell" }, "gy")])],
  }),
  mon("S02", "Lanternmancer", "FIRE", "Spellcaster", 4, 1600, 1200, "C", "When this card destroys a monster by battle: inflict 500 damage to your opponent.", {
    effects: [on("battleDestroy", [{ op: "damage", to: "opp", n: 500 }])],
  }),
  mon("S03", "Starweave Sorceress", "LIGHT", "Spellcaster", 7, 2500, 2100, "UR", "Gains 200 ATK for each Spell card in your Graveyard.", {
    effects: [aura({ self: true, atk: { per: 200, count: { from: "gy", side: "self", filter: { kind: "spell" } } } })],
  }),
  mon("S04", "Hexbound Warlock", "DARK", "Spellcaster", 4, 1400, 1400, "R", "FLIP: Your opponent discards 1 random card.", {
    effects: [on("flip", [{ op: "discard", who: "opp", n: 1, random: true }])],
  }),
  mon("S05", "Mirror Oracle", "LIGHT", "Spellcaster", 2, 600, 1500, "C", "FLIP: Draw 1 card.", { effects: [on("flip", D(1))] }),
  mon("S06", "Arcane Scholar", "DARK", "Spellcaster", 4, 1400, 1600, "R", "Once per turn: you can pay 800 Life Points; draw 1 card.", {
    effects: [ignition(D(1), { cost: { payLp: 800 } })],
  }),
  mon("S07", "Twilight Magister", "DARK", "Spellcaster", 6, 2300, 1900, "SR", "When this card is Summoned: destroy 1 Spell or Trap card your opponent controls.", {
    effects: [on("summon", destroyT, { target: oppST })],
  }),
  mon("S08", "Ember Witch", "FIRE", "Spellcaster", 3, 1200, 700, "C", "During your Standby Phase: inflict 300 damage to your opponent.", {
    effects: [on("standby", [{ op: "damage", to: "opp", n: 300 }])],
  }),
  mon("S09", "Grimoire Keeper", "LIGHT", "Spellcaster", 4, 1000, 2000, "R", "Spellcaster monsters you control cannot be destroyed by card effects.", {
    effects: [aura({ side: "self", filter: { race: "Spellcaster" }, flags: ["noEffectDestroy"] })],
  }),
  mon("S10", "Moonveil Enchantress", "WATER", "Spellcaster", 5, 2000, 2100, "R", "When this card is Normal Summoned: return 1 monster your opponent controls to the hand.", {
    effects: [on("normalSummon", [{ op: "bounce", what: "targets" }], { target: oppMonster() })],
  }),
  mon("S11", "Novice Conjurer", "LIGHT", "Spellcaster", 1, 400, 400, "C", "When this card is destroyed by battle: draw 1 card.", { effects: [on("destroyedBattle", D(1))] }),
  mon("S12", "Archmage of Echoes", "DARK", "Spellcaster", 8, 2800, 2400, "UR", "Once per turn: add 1 Spell card from your Graveyard to your hand.", {
    effects: [ignition([search({ kind: "spell" }, "gy")], { cond: { gy: { side: "self", filter: { kind: "spell" } } } })],
  }),
  mon("S13", "Prism Familiar", "LIGHT", "Spellcaster", 3, 1300, 1300, "C", "A tiny spirit that lives in crystal. It repeats the last spell it heard, usually at the worst moment."),
  mon("S14", "Chronomancer", "EARTH", "Spellcaster", 4, 1700, 1000, "C", "She always arrives exactly on time, though nobody has ever seen her leave."),
]

// ---------- Aquatic ----------

const aquatic = [
  mon("A01", "Reef Sentinel", "WATER", "Aqua", 4, 1400, 1800, "C", "A guardian grown from living coral. Fish nest in its shoulders and it is careful not to shrug."),
  mon("A02", "Tidecaller Siren", "WATER", "Aqua", 4, 1600, 1100, "C", "When this card is Normal Summoned: change the battle position of 1 face-up monster your opponent controls.", {
    effects: [on("normalSummon", [{ op: "position", what: "targets", to: "swap" }], { target: oppMonster({ up: true }) })],
  }),
  mon("A03", "Abyssal Angler", "WATER", "Fish", 3, 1000, 800, "C", "This card can attack your opponent directly.", { flags: ["direct"] }),
  mon("A04", "Trench Kraken", "WATER", "Aqua", 7, 2600, 2300, "SR", "When this card is Summoned: return 1 Spell or Trap card on the field to its owner's hand.", {
    effects: [on("summon", [{ op: "bounce", what: "targets" }], { target: anyST })],
  }),
  mon("A05", "Coral Golem", "WATER", "Rock", 5, 1800, 2400, "C", "Other WATER monsters you control gain 300 ATK.", {
    effects: [aura({ side: "self", filter: { attr: "WATER" }, notSelf: true, atk: 300 })],
  }),
  mon("A06", "Pearl Diver", "WATER", "Aqua", 2, 800, 600, "C", "FLIP: Add 1 WATER monster from your Deck to your hand.", {
    effects: [on("flip", [search({ kind: "monster", attr: "WATER" })])],
  }),
  mon("A07", "Riptide Eel", "WATER", "Serpent", 4, 1600, 800, "R", "When this card inflicts battle damage to your opponent: your opponent discards 1 random card.", {
    effects: [on("battleDamage", [{ op: "discard", who: "opp", n: 1, random: true }])],
  }),
  mon("A08", "Lantern Jelly", "WATER", "Aqua", 1, 300, 800, "C", "When this card is destroyed: gain 1000 Life Points.", {
    effects: [on("destroyed", [{ op: "heal", to: "self", n: 1000 }])],
  }),
  mon("A09", "Maelstrom Serpent", "WATER", "Serpent", 6, 2400, 1700, "SR", "When this card is Normal Summoned: return 1 monster your opponent controls to the hand.", {
    effects: [on("normalSummon", [{ op: "bounce", what: "targets" }], { target: oppMonster() })],
  }),
  mon("A10", "Bubbleshell Crab", "WATER", "Aqua", 3, 500, 2000, "C", "It blows bubbles when nervous, which is always. The bubbles are surprisingly hard to pop."),
  mon("A11", "Tsunami Behemoth", "WATER", "Serpent", 8, 2900, 2700, "UR", "When this card is Summoned: return all Spell and Trap cards your opponent controls to the hand.", {
    effects: [on("summon", [{ op: "bounce", what: { all: { from: "spells", side: "opp" } } }])],
  }),
  mon("A12", "Shoal Skirmisher", "WATER", "Fish", 4, 1800, 700, "C", "It swims at the front of every school, mostly because it never learned how to slow down."),
  mon("A13", "Inkcloud Squid", "WATER", "Aqua", 3, 1100, 1200, "R", "FLIP: Change 1 face-up monster your opponent controls to face-down Defense Position.", {
    effects: [on("flip", [{ op: "position", what: "targets", to: "down" }], { target: oppMonster({ up: true }) })],
  }),
  mon("A14", "Brine Witch", "WATER", "Spellcaster", 4, 1500, 1300, "R", "Once per turn: target 1 face-up monster your opponent controls; it loses 600 ATK until the end of this turn.", {
    effects: [ignition([{ op: "buff", what: "targets", atk: -600, until: "turn" }], { target: oppMonster({ up: true }) })],
  }),
]

// ---------- Insects ----------

const insects = [
  mon("I01", "Ironback Beetle", "EARTH", "Insect", 4, 1500, 1900, "C", "Its shell is so hard that blacksmiths borrow it as an anvil. It does not mind, but it does keep count."),
  mon("I02", "Hive Worker", "EARTH", "Insect", 2, 600, 500, "C", 'When this card is Normal Summoned: Special Summon 1 "Hive Worker" from your Deck.', {
    effects: [on("normalSummon", [special("deck", { ids: ["I02"] })])],
  }),
  mon("I03", "Venomsting Hornet", "WIND", "Insect", 3, 1200, 600, "C", "When this card is Normal Summoned: 1 face-up monster your opponent controls loses 600 ATK.", {
    effects: [on("normalSummon", [{ op: "buff", what: "targets", atk: -600, until: "perm" }], { target: oppMonster({ up: true }) })],
  }),
  mon("I04", "Scythe Mantis", "WIND", "Insect", 4, 1800, 900, "C", "It stands perfectly still for hours, then moves faster than you can blink. Usually toward lunch."),
  mon("I05", "Silkspinner Spider", "EARTH", "Insect", 4, 1300, 1400, "C", "When this card is Normal Summoned: change 1 face-up Attack Position monster your opponent controls to Defense Position.", {
    effects: [on("normalSummon", [{ op: "position", what: "targets", to: "def" }], { target: oppMonster({ up: true, pos: "atk" }) })],
  }),
  mon("I06", "Locust Queen", "WIND", "Insect", 6, 2200, 2000, "SR", "Gains 100 ATK for each Insect monster in your Graveyard.", {
    effects: [aura({ self: true, atk: { per: 100, count: { from: "gy", side: "self", filter: { kind: "monster", race: "Insect" } } } })],
  }),
  mon("I07", "Molting Larva", "EARTH", "Insect", 2, 400, 1200, "C", "When this card is destroyed: Special Summon 1 Insect monster from your hand.", {
    effects: [on("destroyed", [special("hand", { race: "Insect" })])],
  }),
  mon("I08", "Firefly Lantern", "LIGHT", "Insect", 3, 900, 900, "R", "FLIP: Destroy 1 face-up monster your opponent controls with 1500 or less ATK.", {
    effects: [on("flip", destroyT, { target: oppMonster({ up: true, atkMax: 1500 }) })],
  }),
  mon("I09", "Gravedigger Beetle", "EARTH", "Insect", 4, 1400, 1300, "C", "When this card is Normal Summoned: add 1 Insect monster from your Graveyard to your hand.", {
    effects: [on("normalSummon", [search({ kind: "monster", race: "Insect" }, "gy")])],
  }),
  mon("I10", "Emperor Moth", "WIND", "Insect", 7, 2500, 2000, "SR", "Monsters your opponent controls lose 300 ATK.", {
    effects: [aura({ side: "opp", atk: -300 })],
  }),
  mon("I11", "Army Ant Column", "EARTH", "Insect", 4, 1100, 1000, "R", "Gains 300 ATK for each other Insect monster you control.", {
    effects: [aura({ self: true, atk: { per: 300, count: { from: "monsters", side: "self", notSelf: true, filter: { race: "Insect", up: true } } } })],
  }),
  mon("I12", "Stinger Gnat", "WIND", "Insect", 1, 300, 200, "C", "This card can attack your opponent directly.", { flags: ["direct"] }),
  mon("I13", "Hive Matriarch", "EARTH", "Insect", 7, 2400, 2400, "UR", 'When this card is Normal Summoned: Special Summon 2 "Larva Tokens" (Insect/EARTH/Level 1/ATK 500/DEF 500).', {
    effects: [on("normalSummon", [{ op: "token", id: "K02", n: 2, pos: "atk" }])],
  }),
  mon("I14", "Leafcutter Swarm", "WIND", "Insect", 4, 1600, 1200, "R", "When this card destroys a monster by battle: destroy 1 Spell or Trap card your opponent controls.", {
    effects: [on("battleDestroy", destroyT, { target: oppST })],
  }),
]

// ---------- Warriors ----------

const warriors = [
  mon("W01", "Vanguard Swordsman", "EARTH", "Warrior", 4, 1700, 1200, "C", "First through the gate, last to the feast. He has never once complained about either."),
  mon("W02", "Shieldbearer Recruit", "EARTH", "Warrior", 3, 800, 1800, "R", "When this card is Normal Summoned: add 1 Equip Spell card from your Deck to your hand.", {
    effects: [on("normalSummon", [search({ kind: "spell", sub: "equip" })])],
  }),
  mon("W03", "Blade Dancer", "WIND", "Warrior", 4, 1400, 800, "R", "This card can attack twice during each Battle Phase.", { flags: ["twice"] }),
  mon("W04", "Dawn Lancer", "LIGHT", "Warrior", 4, 1500, 1300, "C", "If this card attacks a Defense Position monster with lower DEF than its ATK, your opponent takes the difference as battle damage.", { flags: ["pierce"] }),
  mon("W05", "Iron Duke", "EARTH", "Warrior", 6, 2300, 2000, "SR", "When this card is Normal Summoned: destroy 1 face-down monster your opponent controls.", {
    effects: [on("normalSummon", destroyT, { target: oppMonster({ up: false }) })],
  }),
  mon("W06", "Arena Champion", "FIRE", "Warrior", 7, 2600, 1900, "SR", "When this card destroys a monster by battle: it gains 300 ATK.", {
    effects: [on("battleDestroy", [{ op: "buff", what: "self", atk: 300, until: "perm" }])],
  }),
  mon("W07", "Squire Errant", "EARTH", "Warrior", 2, 700, 800, "C", "When this card is destroyed by battle: add 1 Level 4 or lower Warrior monster from your Deck to your hand.", {
    effects: [on("destroyedBattle", [search({ kind: "monster", race: "Warrior", levelMax: 4 })])],
  }),
  mon("W08", "Wildeye Berserker", "FIRE", "Warrior", 4, 1900, 0, "C", "He charges first and asks questions never. His shield is mostly for show."),
  mon("W09", "Banner Knight", "LIGHT", "Warrior", 4, 1200, 1500, "R", "Warrior monsters you control gain 300 ATK.", {
    effects: [aura({ side: "self", filter: { race: "Warrior" }, atk: 300 })],
  }),
  mon("W10", "Twinblade Ronin", "DARK", "Warrior", 4, 1700, 700, "R", "Once per turn: you can discard 1 card; destroy 1 Spell or Trap card on the field.", {
    effects: [ignition(destroyT, { cost: { discard: 1 }, target: anyST })],
  }),
  mon("W11", "Ember Paladin", "FIRE", "Warrior", 5, 2100, 1700, "C", "When this card is Summoned: gain 1000 Life Points.", {
    effects: [on("summon", [{ op: "heal", to: "self", n: 1000 }])],
  }),
  mon("W12", "Cloaked Assassin", "DARK", "Warrior", 2, 450, 600, "SR", "FLIP: Destroy 1 monster on the field.", {
    effects: [on("flip", destroyT, { target: anyMonster() })],
  }),
  mon("W13", "Veteran Captain", "EARTH", "Warrior", 4, 1400, 1400, "R", "When this card is Normal Summoned: Special Summon 1 Level 3 or lower Warrior monster from your hand.", {
    effects: [on("normalSummon", [special("hand", { race: "Warrior", levelMax: 3 })])],
  }),
  mon("W14", "Seventh Gate Warlord", "LIGHT", "Warrior", 8, 2900, 2400, "UR", "Cannot be destroyed by card effects.", { flags: ["noEffectDestroy"] }),
]

// ---------- Undead ----------

const undead = [
  mon("U01", "Gravecrawler", "DARK", "Zombie", 3, 1200, 600, "C", 'When this card is destroyed by battle: Special Summon 1 Level 4 or lower Zombie monster from your Graveyard, except "Gravecrawler".', {
    effects: [on("destroyedBattle", [special("gy", { race: "Zombie", levelMax: 4, notIds: ["U01"] })])],
  }),
  mon("U02", "Bone Archer", "DARK", "Zombie", 4, 1600, 1000, "C", "It lost its bowstring two centuries ago and fires its own ribs instead. It has plenty to spare."),
  mon("U03", "Crypt Lich", "DARK", "Zombie", 6, 2200, 2000, "SR", "When this card is Summoned: Special Summon 1 Zombie monster from your Graveyard in Defense Position.", {
    effects: [on("summon", [special("gy", { race: "Zombie" }, "def")])],
  }),
  mon("U04", "Mire Ghoul", "DARK", "Zombie", 4, 1800, 1300, "C", "It waits in the bog with only its eyes above the water. The frogs have learned to stay away."),
  mon("U05", "Wailing Banshee", "DARK", "Zombie", 4, 1500, 1300, "C", "When this card is Normal Summoned: each player sends the top 3 cards of their Deck to the Graveyard.", {
    effects: [on("normalSummon", [{ op: "mill", who: "both", n: 3 }])],
  }),
  mon("U06", "Tomb Warden", "EARTH", "Zombie", 3, 1000, 1800, "C", "FLIP: Add 1 Zombie monster from your Graveyard to your hand.", {
    effects: [on("flip", [search({ kind: "monster", race: "Zombie" }, "gy")])],
  }),
  mon("U07", "Plague Rat King", "DARK", "Zombie", 2, 800, 700, "R", "When this card is destroyed: your opponent discards 1 random card.", {
    effects: [on("destroyed", [{ op: "discard", who: "opp", n: 1, random: true }])],
  }),
  mon("U08", "Revenant Knight", "DARK", "Zombie", 5, 2000, 1500, "R", "Gains 100 ATK for each Zombie monster in your Graveyard.", {
    effects: [aura({ self: true, atk: { per: 100, count: { from: "gy", side: "self", filter: { kind: "monster", race: "Zombie" } } } })],
  }),
  mon("U09", "Boneyard Colossus", "DARK", "Zombie", 7, 2600, 2000, "SR", "When this card is destroyed: Special Summon 1 Level 4 or lower Zombie monster from your Graveyard.", {
    effects: [on("destroyed", [special("gy", { race: "Zombie", levelMax: 4 })])],
  }),
  mon("U10", "Ghoulish Gravedigger", "EARTH", "Zombie", 4, 1300, 1300, "C", "Once per turn: send the top 2 cards of your Deck to the Graveyard, then gain 400 Life Points.", {
    effects: [ignition([{ op: "mill", who: "self", n: 2 }, { op: "heal", to: "self", n: 400 }])],
  }),
  mon("U11", "Spectral Wisp", "DARK", "Zombie", 1, 300, 300, "C", "This card can attack your opponent directly.", { flags: ["direct"] }),
  mon("U12", "Shambling Horde", "DARK", "Zombie", 3, 1100, 1100, "C", 'When this card is Normal Summoned: Special Summon 1 "Shambling Horde" from your Graveyard.', {
    effects: [on("normalSummon", [special("gy", { ids: ["U12"] })])],
  }),
  mon("U13", "Dusk Sovereign", "DARK", "Zombie", 8, 2800, 2500, "UR", "When this card is Normal Summoned: destroy all face-up monsters your opponent controls with 1500 or less ATK.", {
    effects: [on("normalSummon", [{ op: "destroy", what: { all: { from: "monsters", side: "opp", filter: { up: true, atkMax: 1500 } } } }])],
  }),
  mon("U14", "Corpse Bloom", "DARK", "Plant", 4, 1500, 1500, "C", "A flower that only opens at midnight in old graveyards. It smells wonderful, which is the worrying part."),
]

// ---------- Beasts ----------

const beasts = [
  mon("B01", "Thornback Boar", "EARTH", "Beast", 4, 1700, 1100, "C", "The thorns on its back are a warning. The tusks in front are the actual message."),
  mon("B02", "Pack Wolf", "EARTH", "Beast", 3, 1200, 800, "C", "Gains 300 ATK for each other Beast monster you control.", {
    effects: [aura({ self: true, atk: { per: 300, count: { from: "monsters", side: "self", notSelf: true, filter: { race: "Beast", up: true } } } })],
  }),
  mon("B03", "Alpha Direwolf", "DARK", "Beast", 6, 2300, 1500, "SR", "When this card is Summoned: Beast monsters you control gain 500 ATK until the end of this turn.", {
    effects: [on("summon", [{ op: "buff", what: { all: { from: "monsters", side: "self", filter: { race: "Beast", up: true } } }, atk: 500, until: "turn" }])],
  }),
  mon("B04", "Burrowing Mole", "EARTH", "Beast", 2, 600, 1100, "R", "FLIP: Destroy 1 face-down monster your opponent controls.", {
    effects: [on("flip", destroyT, { target: oppMonster({ up: false }) })],
  }),
  mon("B05", "Ridge Lioness", "EARTH", "Beast", 4, 1600, 1300, "R", "When this card inflicts battle damage to your opponent: draw 1 card.", { effects: [on("battleDamage", D(1))] }),
  mon("B06", "Thunder Bison", "WIND", "Beast", 5, 2100, 1800, "R", "If this card attacks a Defense Position monster with lower DEF than its ATK, your opponent takes the difference as battle damage.", { flags: ["pierce"] }),
  mon("B07", "Sabertooth Prowler", "EARTH", "Beast", 4, 1800, 700, "C", "It has been extinct for ten thousand years. Nobody has told it, and nobody plans to."),
  mon("B08", "Grizzled Mauler", "EARTH", "Beast", 7, 2700, 2000, "SR", "When this card destroys a monster by battle: inflict 700 damage to your opponent.", {
    effects: [on("battleDestroy", [{ op: "damage", to: "opp", n: 700 }])],
  }),
  mon("B09", "Highland Stag", "EARTH", "Beast", 4, 1300, 1600, "C", "When this card is Normal Summoned: gain 800 Life Points.", {
    effects: [on("normalSummon", [{ op: "heal", to: "self", n: 800 }])],
  }),
  mon("B10", "Cunning Fox", "FIRE", "Beast", 3, 1000, 900, "C", "When this card is destroyed by battle: add 1 Level 4 or lower Beast monster from your Deck to your hand.", {
    effects: [on("destroyedBattle", [search({ kind: "monster", race: "Beast", levelMax: 4 })])],
  }),
  mon("B11", "Wild Hare", "WIND", "Beast", 1, 200, 300, "R", "This card can attack your opponent directly. When this card inflicts battle damage to your opponent: draw 1 card.", {
    flags: ["direct"],
    effects: [on("battleDamage", D(1))],
  }),
  mon("B12", "Ironhide Rhino", "EARTH", "Beast", 5, 1900, 2300, "C", "Its hide turns arrows, spears and most arguments. It has never lost a staring contest either."),
  mon("B13", "Primal Behemoth", "EARTH", "Beast", 8, 3000, 2200, "UR", "When this card is Normal Summoned: destroy 1 monster your opponent controls.", {
    effects: [on("normalSummon", destroyT, { target: oppMonster() })],
  }),
  mon("B14", "Talon Hawk", "WIND", "Winged Beast", 3, 1300, 600, "C", "FLIP: Destroy 1 Spell or Trap card your opponent controls.", {
    effects: [on("flip", destroyT, { target: oppST })],
  }),
]

// ---------- Fusions (Extra Deck) and tokens ----------

const fusion = (id, name, attr, race, level, atk, def, materials, text, more = {}) => ({ ...mon(id, name, attr, race, level, atk, def, "SR", text, more), sub: "fusion", extra: true, materials })

const fusions = [
  fusion("F01", "Twin-Headed Emberwyrm", "FIRE", "Dragon", 7, 2600, 2000, ["D02", { race: "Dragon" }], '"Emberscale Drake" + 1 Dragon monster\nIf this card attacks a Defense Position monster with lower DEF than its ATK, your opponent takes the difference as battle damage.', { flags: ["pierce"] }),
  fusion("F02", "Gearforged Juggernaut", "EARTH", "Machine", 8, 2800, 2600, ["M01", "M04"], '"Gearbolt Sentry" + "Steamjack Brawler"\nCannot be destroyed by card effects.', { flags: ["noEffectDestroy"] }),
  fusion("F03", "Twin Star Archmage", "LIGHT", "Spellcaster", 7, 2600, 2200, ["S14", { race: "Spellcaster" }], '"Chronomancer" + 1 Spellcaster monster\nWhen this card is Summoned: destroy 1 Spell or Trap card your opponent controls.', {
    effects: [on("summon", destroyT, { target: oppST })],
  }),
  fusion("F04", "Reefbound Titan", "WATER", "Aqua", 7, 2500, 2800, ["A01", { attr: "WATER" }], '"Reef Sentinel" + 1 WATER monster\nWhen this card is Summoned: return 1 monster your opponent controls to the hand.', {
    effects: [on("summon", [{ op: "bounce", what: "targets" }], { target: oppMonster() })],
  }),
  fusion("F05", "Hive Empress", "EARTH", "Insect", 7, 2600, 2300, ["I01", { race: "Insect" }], '"Ironback Beetle" + 1 Insect monster\nMonsters your opponent controls lose 400 ATK.', {
    effects: [aura({ side: "opp", atk: -400 })],
  }),
  fusion("F06", "Paragon Swordmaster", "EARTH", "Warrior", 7, 2700, 2000, ["W01", { race: "Warrior" }], '"Vanguard Swordsman" + 1 Warrior monster\nWhen this card destroys a monster by battle: draw 1 card.', {
    effects: [on("battleDestroy", D(1))],
  }),
  fusion("F07", "Lich Emperor", "DARK", "Zombie", 7, 2600, 2100, ["U02", { race: "Zombie" }], '"Bone Archer" + 1 Zombie monster\nWhen this card is Summoned: Special Summon 1 Zombie monster from your Graveyard.', {
    effects: [on("summon", [special("gy", { race: "Zombie" })])],
  }),
  fusion("F08", "Chimera Alpha", "EARTH", "Beast", 7, 2700, 1900, ["B01", { race: "Beast" }], '"Thornback Boar" + 1 Beast monster\nWhen this card is Summoned: inflict 800 damage to your opponent.', {
    effects: [on("summon", [{ op: "damage", to: "opp", n: 800 }])],
  }),
]

const tokens = [
  { ...mon("K01", "Drone Token", "LIGHT", "Machine", 1, 500, 500, "C", "A token Summoned by a card effect."), sub: "token", token: true },
  { ...mon("K02", "Larva Token", "EARTH", "Insect", 1, 500, 500, "C", "A token Summoned by a card effect."), sub: "token", token: true },
]

// ---------- Spells ----------

const spells = [
  // theme spells
  spell("DS1", "Dragon's Hoard", "normal", "R", "hoard", "Activate only if you control a face-up Dragon monster. Draw 2 cards.", [act(D(2), { cond: { controls: { from: "monsters", side: "self", filter: { race: "Dragon", up: true } } } })]),
  spell("DS2", "Wyrmfire Breath", "normal", "C", "flame", "Destroy 1 face-up monster your opponent controls with 1500 or less DEF.", [act(destroyT, { target: oppMonster({ up: true, defMax: 1500 }) })]),
  spell("DS3", "Ember Peaks", "field", "R", "volcano", "All Dragon monsters gain 300 ATK and 300 DEF.", [act([]), aura({ side: "both", filter: { race: "Dragon" }, atk: 300, def: 300 })]),
  spell("MS1", "Factory Reset", "normal", "R", "gear", "Target 1 Machine monster in your Graveyard; Special Summon it.", [act([{ op: "summon", what: "targets", pos: "atk" }], { target: myGy({ race: "Machine" }) })]),
  spell("MS2", "Overdrive Coil", "equip", "C", "coil", "Equip only to a Machine monster. It gains 800 ATK.", [act([{ op: "equip" }], { target: anyMonster({ up: true, race: "Machine" }) })], { equip: { atk: 800 } }),
  spell("MS3", "Smelter Works", "field", "R", "factory", "All Machine monsters gain 300 ATK and 300 DEF.", [act([]), aura({ side: "both", filter: { race: "Machine" }, atk: 300, def: 300 })]),
  spell("SS1", "Arcane Surge", "quick", "C", "surge", "Target 1 face-up Spellcaster monster you control; it gains 1000 ATK until the end of this turn.", [act([{ op: "buff", what: "targets", atk: 1000, until: "turn" }], { target: myMonster({ race: "Spellcaster" }) })]),
  spell("SS2", "Mana Wellspring", "continuous", "R", "fountain", "During your Standby Phase: gain 500 Life Points.", [act([]), on("standby", [{ op: "heal", to: "self", n: 500 }])]),
  spell("AS1", "Sunken Atoll", "field", "R", "atoll", "All WATER monsters gain 400 ATK. All FIRE monsters lose 200 ATK.", [act([]), aura({ side: "both", filter: { attr: "WATER" }, atk: 400 }), aura({ side: "both", filter: { attr: "FIRE" }, atk: -200 })]),
  spell("AS2", "Rising Tide", "normal", "C", "wave", "Activate only if you control a face-up WATER monster. Return 1 monster your opponent controls to the hand.", [
    act([{ op: "bounce", what: "targets" }], { target: oppMonster(), cond: { controls: { from: "monsters", side: "self", filter: { attr: "WATER", up: true } } } }),
  ]),
  spell("IS1", "Pheromone Trail", "normal", "C", "trail", "Special Summon 1 Level 4 or lower Insect monster from your hand.", [act([special("hand", { race: "Insect", levelMax: 4 })], { cond: { has: { from: "hand", side: "self", filter: { kind: "monster", race: "Insect", levelMax: 4 } } } })]),
  spell("IS2", "Nest Instinct", "continuous", "R", "nest", "Insect monsters you control gain 300 ATK.", [act([]), aura({ side: "self", filter: { race: "Insect" }, atk: 300 })]),
  spell("WS1", "Tempered Longsword", "equip", "C", "sword", "Equip only to a Warrior monster. It gains 700 ATK.", [act([{ op: "equip" }], { target: anyMonster({ up: true, race: "Warrior" }) })], { equip: { atk: 700 } }),
  spell("WS2", "Rally the Ranks", "quick", "C", "banner", "Warrior monsters you control gain 500 ATK until the end of this turn.", [act([{ op: "buff", what: { all: { from: "monsters", side: "self", filter: { race: "Warrior", up: true } } }, atk: 500, until: "turn" }])]),
  spell("US1", "Rise From the Crypt", "normal", "R", "crypt", "Target 1 monster in your Graveyard; Special Summon it.", [act([{ op: "summon", what: "targets", pos: "atk" }], { target: myGy() })]),
  spell("US2", "Grave Harvest", "normal", "R", "harvest", "Activate only if there are 3 or more Zombie monsters in your Graveyard. Draw 2 cards.", [act(D(2), { cond: { gy: { side: "self", filter: { kind: "monster", race: "Zombie" }, min: 3 } } })]),
  spell("BS1", "Feral Roar", "quick", "C", "roar", "Target 1 face-up Beast monster you control; it gains 700 ATK until the end of this turn.", [act([{ op: "buff", what: "targets", atk: 700, until: "turn" }], { target: myMonster({ race: "Beast" }) })]),
  spell("BS2", "Wildwood Grove", "field", "R", "forest", "All Beast and Insect monsters gain 300 ATK.", [act([]), aura({ side: "both", filter: { races: ["Beast", "Winged Beast", "Insect"] }, atk: 300 })]),

  // for every deck
  spell("G01", "Fresh Insight", "normal", "SR", "insight", "Draw 2 cards.", [act(D(2))], { limit: 1 }),
  spell("G02", "Cataclysm", "normal", "SR", "cataclysm", "Destroy all monsters on the field.", [act([{ op: "destroy", what: { all: { from: "monsters", side: "both" } } }], { cond: { has: { from: "monsters", side: "both" } } })], { limit: 1 }),
  spell("G03", "Gale Sweep", "normal", "SR", "gale", "Destroy all Spell and Trap cards your opponent controls.", [act([{ op: "destroy", what: { all: { from: "spells", side: "opp" } } }], { cond: { has: { from: "spells", side: "opp" } } })], { limit: 1 }),
  spell("G04", "Smite", "normal", "R", "smite", "Destroy 1 monster your opponent controls.", [act(destroyT, { target: oppMonster() })], { limit: 1 }),
  spell("G05", "Whirlwind Sigil", "quick", "R", "whirl", "Destroy 1 Spell or Trap card on the field.", [act(destroyT, { target: { ...anyST, notSelf: true } })]),
  spell("G06", "Second Wind", "normal", "SR", "phoenix", "Target 1 monster in either player's Graveyard; Special Summon it to your field.", [act([{ op: "summon", what: "targets", pos: "atk" }], { target: { from: "gy", side: "both", filter: { kind: "monster" }, n: 1 } })], { limit: 1 }),
  spell("G07", "Healing Spring", "normal", "C", "spring", "Gain 1000 Life Points.", [act([{ op: "heal", to: "self", n: 1000 }])]),
  spell("G08", "Firebolt", "normal", "C", "bolt", "Inflict 600 damage to your opponent.", [act([{ op: "damage", to: "opp", n: 600 }])]),
  spell("G09", "Iron Mail", "equip", "C", "mail", "The equipped monster gains 400 ATK and 400 DEF.", [act([{ op: "equip" }], { target: anyMonster({ up: true }) })], { equip: { atk: 400, def: 400 } }),
  spell("G10", "Cursed Shackles", "equip", "R", "shackles", "The equipped monster loses 700 ATK.", [act([{ op: "equip" }], { target: anyMonster({ up: true }) })], { equip: { atk: -700 } }),
  spell("G11", "Sudden Valor", "quick", "C", "valor", "Target 1 face-up monster; it gains 500 ATK and 500 DEF until the end of this turn.", [act([{ op: "buff", what: "targets", atk: 500, def: 500, until: "turn" }], { target: anyMonster({ up: true }) })]),
  spell("G12", "Trade Winds", "normal", "C", "winds", "Discard 1 card, then draw 2 cards.", [act(D(2), { cost: { discard: 1 } })]),
  spell("G13", "Borrowed Banner", "normal", "SR", "banner2", "Take control of 1 monster your opponent controls until the End Phase.", [act([{ op: "control", what: "targets" }], { target: oppMonster() })], { limit: 1 }),
  spell("G14", "Fusion Rite", "normal", "R", "fusion", "Fusion Summon 1 Fusion Monster from your Extra Deck, sending the listed materials from your hand or field to the Graveyard.", [act([{ op: "fusion" }], { cond: { fusion: true } })]),
  spell("G15", "Recollection", "normal", "C", "memory", "Add 1 monster from your Graveyard to your hand.", [act([search({ kind: "monster" }, "gy")], { cond: { gy: { side: "self", filter: { kind: "monster" } } } })]),
  spell("G16", "Weight of Ages", "continuous", "SR", "weight", "Monsters with 1900 or more original ATK cannot attack.", [act([]), aura({ side: "both", filter: { atkMin: 1900 }, base: true, flags: ["cannotAttack"] })]),
  spell("G17", "Twin Fortune", "normal", "C", "coin", "Toss a coin. Heads: draw 2 cards. Tails: discard 1 random card.", [act([{ op: "coin", heads: D(2), tails: [{ op: "discard", who: "self", n: 1, random: true }] }])]),
  spell("G18", "Warp Gate", "quick", "C", "gate", "Target 1 monster you control; return it to your hand.", [act([{ op: "bounce", what: "targets" }], { target: { from: "monsters", side: "self", n: 1 } })]),
]

// ---------- Traps ----------

const traps = [
  trap("T01", "Prism Barrier", "normal", "SR", "prism", "When an opponent's monster declares an attack: destroy all Attack Position monsters your opponent controls.", [
    act([{ op: "destroy", what: { all: { from: "monsters", side: "opp", filter: { up: true, pos: "atk" } } } }], { trigger: "attack" }),
  ], { limit: 1 }),
  trap("T02", "Snare Pit", "normal", "C", "pit", "When your opponent Summons a monster with 1500 or more ATK: destroy it.", [act(destroyT, { trigger: "oppSummon", target: { from: "event", filter: { atkMin: 1500 }, n: 1 } })]),
  trap("T03", "Null Edict", "counter", "SR", "edict", "Pay 1000 Life Points. Negate the activation of a Spell or Trap card, and destroy it.", [act([{ op: "negate", destroy: true }], { trigger: "chain", chainKinds: ["spell", "trap"], cost: { payLp: 1000 } })]),
  trap("T04", "Stand Fast", "normal", "C", "halt", "When an opponent's monster declares an attack: negate the attack.", [act([{ op: "negateAttack" }], { trigger: "attack" })]),
  trap("T05", "Spiked Pitfall", "normal", "R", "spikes", "When an opponent's monster with 2000 or less ATK declares an attack: destroy it.", [act(destroyT, { trigger: "attack", target: { from: "attacker", filter: { atkMax: 2000 }, n: 1 } })]),
  trap("T06", "Retaliation", "normal", "R", "reflect", "When an opponent's monster declares an attack: negate the attack, and inflict damage to your opponent equal to half its ATK.", [
    act([{ op: "negateAttack" }, { op: "damage", to: "opp", n: { stat: "atk", of: "attacker", mul: 0.5 } }], { trigger: "attack" }),
  ]),
  trap("T07", "Desperate Revival", "normal", "R", "revival", "Target 1 monster in your Graveyard; Special Summon it in Defense Position.", [act([{ op: "summon", what: "targets", pos: "def" }], { target: myGy() })]),
  trap("T08", "Dust Devil", "normal", "C", "dust", "Target up to 2 Spell or Trap cards on the field; destroy them.", [act(destroyT, { target: { from: "spells", side: "both", n: 2, min: 1, notSelf: true } })]),
  trap("T09", "Sudden Surge", "normal", "C", "surge2", "Target 1 face-up monster you control; it gains 700 ATK until the end of this turn.", [act([{ op: "buff", what: "targets", atk: 700, until: "turn" }], { target: myMonster() })]),
  trap("T10", "Smoke Screen", "normal", "R", "smoke", "When an opponent's monster declares an attack: negate the attack, then end the Battle Phase.", [act([{ op: "endBattle" }], { trigger: "attack" })]),
  trap("T11", "Rockfall", "normal", "C", "rocks", "Destroy 1 face-up monster your opponent controls with 1500 or less ATK.", [act(destroyT, { target: oppMonster({ up: true, atkMax: 1500 }) })]),
  trap("T12", "Ember Field", "continuous", "R", "embers", "During your Standby Phase: inflict 300 damage to your opponent.", [act([]), on("standby", [{ op: "damage", to: "opp", n: 300 }])]),
  trap("T13", "Binding Roots", "normal", "C", "roots", "When your opponent Summons a monster: change it to Defense Position. It cannot attack while it is face-up on the field.", [
    act([{ op: "position", what: "targets", to: "def" }, { op: "flag", what: "targets", flag: "cannotAttack", until: "perm" }], { trigger: "oppSummon", target: { from: "event", n: 1 } }),
  ]),
  trap("T14", "Spellbreak", "counter", "R", "break", "Discard 1 card. Negate the activation of a Spell card, and destroy it.", [act([{ op: "negate", destroy: true }], { trigger: "chain", chainKinds: ["spell"], cost: { discard: 1 } })]),
  trap("T15", "Hidden Cache", "normal", "C", "cache", "Draw 1 card.", [act(D(1))]),
  trap("T16", "Topsy-Turvy", "normal", "C", "turn", "Change the battle positions of all face-up monsters your opponent controls.", [
    act([{ op: "position", what: { all: { from: "monsters", side: "opp", filter: { up: true } } }, to: "swap" }], { cond: { has: { from: "monsters", side: "opp", filter: { up: true } } } }),
  ]),
  trap("T17", "Silence Ward", "counter", "SR", "silence", "Negate the activation of a monster effect, and destroy that monster.", [act([{ op: "negate", destroy: true }], { trigger: "chain", chainKinds: ["monster"] })]),
]

export const THEMES = [
  { id: "dragons", name: "Dragon Lords", race: "Dragon", cards: dragons },
  { id: "machines", name: "Iron Legion", race: "Machine", cards: machines },
  { id: "casters", name: "Arcane Circle", race: "Spellcaster", cards: casters },
  { id: "aquatic", name: "Tidal Depths", race: "Aqua", cards: aquatic },
  { id: "insects", name: "Hive Swarm", race: "Insect", cards: insects },
  { id: "warriors", name: "Steel Vanguard", race: "Warrior", cards: warriors },
  { id: "undead", name: "Restless Dead", race: "Zombie", cards: undead },
  { id: "beasts", name: "Wild Pack", race: "Beast", cards: beasts },
]

export const ALL_CARDS = [...dragons, ...machines, ...casters, ...aquatic, ...insects, ...warriors, ...undead, ...beasts, ...fusions, ...spells, ...traps, ...tokens]
export const CARD = Object.fromEntries(ALL_CARDS.map((c) => [c.id, c]))
// what can go in a deck (not tokens)
export const POOL = ALL_CARDS.filter((c) => !c.token)
export const cardById = (id) => CARD[id] || null
export const RARITY_NAMES = { C: "Common", R: "Rare", SR: "Super Rare", UR: "Ultra Rare" }

// the theme a card belongs to (for art and sorting)
export const themeOf = (id) => THEMES.find((t) => t.cards.some((c) => c.id === id))?.id || null
