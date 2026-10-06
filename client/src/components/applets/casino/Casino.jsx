import React, { Suspense, useEffect, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import { helpItem } from "../../../utils/help"
import { useBank, ChipBar, formatChips } from "./parts"
import { setSoundOn } from "./sounds"
import Lobby from "./Lobby"
import Holdem from "./HoldemGame"
import Blackjack from "./BlackjackGame"
import Roulette from "./RouletteGame"
import Slots from "./SlotsGame"
import VideoPoker from "./VideoPokerGame"
import Craps from "./CrapsGame"
import Baccarat from "./BaccaratGame"
import "./Casino.css"

// Casino 98: Texas Hold'em, Blackjack, Roulette, Slots, Video Poker, Craps and Baccarat,
// sharing one chip bank (bank.js; play chips, free refills). Each game is its own program in
// Start > Programs > Casino, and they all open this window (the program picks the game);
// "Casino 98" opens the lobby. The rules are pure modules next to this file, with tests.

export const GAMES = [
  { key: "holdem", program: "Texas Hold'em", blurb: "No-limit poker against the computer or friends online.", icon: "holdem" },
  { key: "blackjack", program: "Blackjack", blurb: "Beat the dealer to 21. Blackjack pays 3 to 2.", icon: "blackjack" },
  { key: "roulette", program: "Roulette", blurb: "Bet on a number, a color or a dozen, and spin.", icon: "roulette" },
  { key: "slots", program: "Slots", blurb: "Lucky 98: three reels, five lines, a 98 Wild jackpot.", icon: "slots" },
  { key: "videopoker", program: "Video Poker", blurb: "Jacks or Better: hold, draw, hit the royal.", icon: "videopoker" },
  { key: "craps", program: "Craps", blurb: "Roll the dice. Pass line, odds, come, field, place.", icon: "craps" },
  { key: "baccarat", program: "Baccarat", blurb: "Player, Banker or Tie. The cards do the rest.", icon: "baccarat" },
]
const byProgram = (name) => GAMES.find((g) => g.program === name)?.key || "lobby"
const titleOf = (key) => GAMES.find((g) => g.key === key)?.program || "Casino 98"
const PREFS = "98ish.casino.prefs"
const loadPrefs = () => {
  try {
    return { sound: true, ...JSON.parse(localStorage.getItem(PREFS) || "{}") }
  } catch {
    return { sound: true }
  }
}

const HOW = {
  lobby: ["Pick a game. Every game bets from the same chips. They're play chips: no real money, and when you run out the house gives you a free refill."],
  holdem: [
    "Everyone gets two cards of their own; five shared cards come out in the middle (the flop, the turn and the river). Make the best five-card hand from all seven, or make everyone else fold.",
    "On your turn: Fold, Check (when there's nothing to call), Call, or Raise (drag the slider or tap ½ Pot, Pot, All-in).",
    "Against the computer you buy in from your chips and Cash Out whenever you like. The last player with chips wins the table.",
  ],
  blackjack: [
    "Get closer to 21 than the dealer without going over. Face cards are 10, aces 1 or 11. Two cards making 21 is a Blackjack and pays 3 to 2.",
    "Hit for another card, Stand to stop, Double to double your bet for exactly one more card, Split a pair into two hands. The dealer draws to 17.",
  ],
  roulette: ["Tap a chip, then tap numbers or the outside bets (Red, Odd, 1st 12...). Spin. A single number pays 35 to 1, red/black even money. Split, street, corner and six-line bets are under More options."],
  slots: ["Pick how many lines and the coin, then Spin. Three of a kind on a line pays; the 98 Wild stands in for anything, and three Wilds hit the jackpot. Cherries pay from the left."],
  videopoker: ["Deal five cards, tap the ones to hold, then Draw. A pair of Jacks or better pays. Bet Max (5 coins) for the big royal flush payout."],
  craps: [
    "Bet the Pass Line and roll. 7 or 11 wins, 2, 3 or 12 loses; any other number is the point. Roll the point again before a 7 to win.",
    "With a point set, back your bet with Odds: they pay true odds, with no house edge. Come, Don't Pass, Field and Place bets are under More options.",
  ],
  baccarat: ["Bet on the Player, the Banker or a Tie, then Deal. The hand closest to 9 wins (only the last digit counts). The cards follow fixed rules. Banker wins pay 19 to 20 (5% commission); a tie pays 8 to 1."],
}

const Casino = ({ program = "Casino 98", mobile = false, onClose, onTitle }) => {
  const bank = useBank()
  const [game, setGame] = useState(() => byProgram(program))
  const [prefs, setPrefs] = useState(loadPrefs)
  const [dialog, setDialog] = useState(null)

  useEffect(() => {
    setSoundOn(prefs.sound)
    try {
      localStorage.setItem(PREFS, JSON.stringify(prefs))
    } catch {
      // private window
    }
  }, [prefs])
  useEffect(() => {
    onTitle?.(titleOf(game))
  }, [game])

  const go = (key) => setGame(key)
  const toLobby = () => setGame("lobby")

  const menus = [
    {
      label: "Game",
      items: [
        { label: "Casino Lobby", onClick: toLobby },
        "-",
        ...GAMES.map((g) => ({ label: g.program, checked: game === g.key, onClick: () => go(g.key) })),
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    {
      label: "Options",
      items: [
        { label: "Sound", checked: prefs.sound, onClick: () => setPrefs((p) => ({ ...p, sound: !p.sound })) },
        { label: "Free Refill", disabled: bank.balance >= 1000, onClick: () => bank.refill() },
      ],
    },
    {
      label: "Help",
      items: [helpItem({ program: game === "lobby" ? "Casino 98" : titleOf(game) }), "-", { label: "How to Play...", onClick: () => setDialog("how") }, { label: "About Casino 98...", onClick: () => setDialog("about") }],
    },
  ]

  const props = { bank, mobile, prefs, setPrefs, onLobby: toLobby }
  let body
  if (game === "holdem") body = <Holdem {...props} />
  else if (game === "blackjack") body = <Blackjack {...props} />
  else if (game === "roulette") body = <Roulette {...props} />
  else if (game === "slots") body = <Slots {...props} />
  else if (game === "videopoker") body = <VideoPoker {...props} />
  else if (game === "craps") body = <Craps {...props} />
  else if (game === "baccarat") body = <Baccarat {...props} />
  else
    body = (
      <>
        <ChipBar title="Casino 98" bank={bank} />
        <Lobby games={GAMES} bank={bank} onPick={go} mobile={mobile} />
      </>
    )

  return (
    <div className={`csRoot${mobile ? " is-mobile" : ""}`} data-game={game}>
      <MenuBar menus={menus} />
      <div className="csBody">
        <Suspense fallback={null}>{body}</Suspense>
      </div>
      {dialog === "how" && (
        <Dialog title={`How to Play ${titleOf(game)}`} onOk={() => setDialog(null)} onCancel={() => setDialog(null)}>
          <div className="csHow">
            {(HOW[game] || HOW.lobby).map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </Dialog>
      )}
      {dialog === "about" && (
        <Dialog title="About Casino 98" onOk={() => setDialog(null)} onCancel={() => setDialog(null)}>
          <div className="csHow">
            <p>
              <b>Casino 98</b>: seven table games and one chip bank.
            </p>
            <p>Play chips only. Nothing here can be bought, cashed or won for real. You have {formatChips(bank.balance)} chips.</p>
          </div>
        </Dialog>
      )}
    </div>
  )
}

export default Casino
