// Monster Duel's tutorial: a real duel with both decks stacked in order and an opponent
// who follows a script for its first two turns, so every lesson happens on cue: summon,
// set a trap, spring it, equip a spell, attack, set a monster, its effect, a tribute
// summon. Each step says what to do, lights up the card to use, only lets that move
// through, and moves on when the duel shows it happened. Then you finish the duel alone.

import { autoAnswer } from "./engine/engine"
import { chooseMove } from "./engine/ai"

// your deck, top card first (you go first: 5 in hand, draws on turns 3 and 5)
export const TUTORIAL_YOU = [
  "D02", "T04", "D01", "G08", "A10", // the opening hand
  "G09", // turn 3
  "D06", // turn 5
  "D03", // the only Level 4 or lower Dragon left: Cinder Whelp finds it
  "D12", "D07", "A01", "M01", "I01", "W01", "B12", "A12", "B07", "G07", "G15", "T09", "T15", "G11", "U14", "S13", "S14", "A10", "M04", "I04", "W08", "B01",
]
// the opponent's: vanilla monsters and harmless spells
export const TUTORIAL_THEM = [
  "W08", "B01", "B07", "A10", "U14", // the opening hand
  "B12", // turn 2
  "G07", // turn 4
  "B07", "A12", "I04", "M04", "U04", "W01", "A01", "M01", "I01", "G11", "B09", "B10", "U02", "A10", "I01", "S13", "S14", "D02", "D12", "B01", "U02", "A12", "G07",
]

// the opponent's script for turns 2 and 4, then an easy computer player
export const tutorialBot = (finished) => (state, seat, { random = Math.random } = {}) => {
  if (state.stage === "decks") return state.decks[seat] ? null : { type: "deck", main: TUTORIAL_THEM, extra: [], name: "Training Deck" }
  if (state.stage !== "duel") return state.ready?.[seat] === false ? { type: "next" } : null
  const d = state.duel
  if (!d || d.over) return null
  if (finished() || d.turn > 4) return chooseMove(d, seat, { level: "easy", style: "balanced", random })
  if (d.wait) return d.wait.seat === seat ? autoAnswer(d, seat) : null
  if (d.active !== seat) return null
  const p = d.p[seat]
  const want = d.turn === 2 ? "W08" : d.turn === 4 ? "B01" : null
  const inHand = p.hand.find((u) => d.cards[u].id === want)
  if (d.phase === "main1") {
    if (inHand && !p.summoned) return { type: "summon", uid: inHand, tributes: [] }
    return d.turn > 1 ? { type: "phase", to: "battle" } : { type: "phase", to: "end" }
  }
  if (d.phase === "battle") {
    const mine = p.m.find((x) => x && d.cards[x.uid].id === want)
    const foe = d.p[1 - seat].m.filter(Boolean)
    const target = d.turn === 2 ? foe.find((x) => d.cards[x.uid].id === "D02") : foe.find((x) => !x.up)
    if (mine && !mine.attacks && mine.pos === "atk" && target) return { type: "attack", uid: mine.uid, target: target.uid }
  }
  return { type: "phase", to: "end" }
}

// ---------- reading the view ----------

const mine = (d) => d.players[0]
const hand = (d, id) => (Array.isArray(mine(d).hand) ? mine(d).hand.find((c) => c.id === id)?.uid : null)
const monster = (d, seat, id) => d.players[seat].m.find((x) => x && x.id === id)?.uid
const setCard = (d, id) => mine(d).s.find((x) => x && x.id === id)?.uid
const inGy = (d, seat, id) => d.players[seat].gy.some((c) => c.id === id)
const myMain = (d) => d.active === 0 && !d.wait && (d.phase === "main1" || d.phase === "main2")

// ---------- the lessons ----------

export const STEPS = [
  {
    title: "Welcome to Monster Duel!",
    text: "You and your opponent each start with 8000 Life Points (LP). Bring theirs to 0 to win. Your cards are on the lower half of the table and your hand is at the bottom.",
    next: true,
  },
  {
    title: "Summon a monster",
    text: "Once per turn you may Normal Summon a monster. Click Emberscale Drake in your hand and choose Normal Summon. (You can also drag it onto the field.)",
    glow: (d) => [hand(d, "D02")],
    allow: (m, d) => m.type === "summon" && m.uid === hand(d, "D02"),
    done: (d) => !!monster(d, 0, "D02"),
    where: "bottom",
  },
  {
    title: "Set a Trap",
    text: "Trap cards are set face-down first, then sprung later, even on your opponent's turn. Click Stand Fast and choose Set face-down.",
    glow: (d) => [hand(d, "T04")],
    allow: (m, d) => m.type === "set" && m.uid === hand(d, "T04"),
    done: (d) => !!setCard(d, "T04"),
    where: "bottom",
  },
  {
    title: "End your turn",
    text: "The player who goes first can't attack on their first turn. Press End Turn.",
    allow: (m) => m.type === "phase" && m.to === "end",
    done: (d) => d.turn >= 2,
  },
  {
    title: "Your opponent's turn",
    text: "Your opponent draws a card and plays. Watch the log and the field...",
    done: (d) => d.wait?.seat === 0 && d.wait.kind === "respond" && d.wait.reason === "attack",
  },
  {
    title: "Spring your Trap!",
    text: "Wildeye Berserker (1900 ATK) is attacking your Drake (1800 ATK): your Drake would be destroyed. Click your set Stand Fast and choose Activate to negate the attack.",
    glow: (d) => [setCard(d, "T04")],
    allow: (m, d) => m.type === "activate" && m.uid === setCard(d, "T04"),
    done: (d) => inGy(d, 0, "T04"),
    where: "bottom",
  },
  {
    title: "Saved!",
    text: "A negated attack still counts, so the Berserker is done for this turn. Your opponent will end their turn now.",
    done: (d) => d.turn >= 3 && myMain(d),
  },
  {
    title: "Equip a Spell",
    text: "You drew Iron Mail, an Equip Spell. Click it, choose Activate, then click your Emberscale Drake. It gains 400 ATK and 400 DEF.",
    glow: (d) => [hand(d, "G09")],
    allow: (m, d) => m.type === "activate" && m.uid === hand(d, "G09"),
    done: (d) => (d.players[0].m.find((x) => x?.id === "D02")?.atk || 0) >= 2200,
    where: "bottom",
  },
  {
    title: "To battle",
    text: "Your Drake now has 2200 ATK, more than the Berserker's 1900. Press Battle! to enter the Battle Phase.",
    allow: (m) => m.type === "phase" && m.to === "battle",
    done: (d) => d.phase === "battle",
  },
  {
    title: "Attack!",
    text: "Click your Drake, choose Attack, then click Wildeye Berserker. The monster with less ATK is destroyed and its owner takes the difference as damage.",
    glow: (d) => [monster(d, 0, "D02"), monster(d, 1, "W08")],
    allow: (m, d) => m.type === "attack" && m.uid === monster(d, 0, "D02"),
    done: (d) => inGy(d, 1, "W08"),
  },
  {
    title: "Main Phase 2",
    text: "300 damage! You haven't summoned this turn yet, so let's add a defender. Press Main 2.",
    allow: (m) => m.type === "phase" && m.to === "main2",
    done: (d) => d.phase === "main2",
  },
  {
    title: "Set a monster",
    text: "Click Cinder Whelp and choose Set face-down. A set monster is hidden in Defense Position: if it's attacked and loses, you take no damage.",
    glow: (d) => [hand(d, "D01")],
    allow: (m, d) => m.type === "set" && m.uid === hand(d, "D01"),
    done: (d) => mine(d).m.some((x) => x && x.id === "D01" && !x.up),
    where: "bottom",
  },
  {
    title: "End your turn",
    text: "Press End Turn and see what your opponent does.",
    allow: (m) => m.type === "phase" && m.to === "end",
    done: (d) => d.turn >= 4,
  },
  {
    title: "Their turn",
    text: "Your opponent summons a monster and attacks your face-down card...",
    done: (d) => d.wait?.seat === 0 && d.wait.kind === "choose",
  },
  {
    title: "A monster effect",
    text: "Cinder Whelp was destroyed in battle, so its effect lets you add a Level 4 or lower Dragon from your Deck to your hand. Pick Skyfin Wyvern.",
    allow: (m) => m.type === "choose",
    done: (d) => !!hand(d, "D03") || (d.turn >= 5 && !d.wait),
  },
  {
    title: "Your turn again",
    text: "Your opponent ends their turn. Next: a bigger monster.",
    done: (d) => d.turn >= 5 && myMain(d),
  },
  {
    title: "Tribute Summon",
    text: "You drew Thunderhorn Dragon. Level 5 and 6 monsters need 1 tribute (Level 7 and up need 2). Click it, choose Tribute Summon, then click your Emberscale Drake to tribute it.",
    glow: (d) => [hand(d, "D06")],
    allow: (m, d) => m.type === "summon" && m.uid === hand(d, "D06"),
    done: (d) => !!monster(d, 0, "D06"),
    where: "bottom",
  },
  {
    title: "Effects and chains",
    text: "Thunderhorn's effect dealt 500 damage when it was summoned. Now press Battle! and attack Thornback Boar.",
    glow: (d) => [monster(d, 0, "D06"), monster(d, 1, "B01")],
    allow: (m, d) => (m.type === "phase" && m.to === "battle") || (m.type === "attack" && m.uid === monster(d, 0, "D06")),
    done: (d) => inGy(d, 1, "B01"),
  },
  {
    title: "You're ready!",
    text: "That's the heart of it: summon, set, traps, spells, battles, tributes and effects. Finish this duel on your own! Help > Rules explains everything else.",
    next: true,
    nextLabel: "Let's duel!",
  },
]
