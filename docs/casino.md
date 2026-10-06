# Casino 98

Seven casino games sharing one bank of play chips: Texas Hold'em (vs computer + online), Blackjack, Roulette, Slots, Video Poker, Craps, Baccarat. Start > Programs > **Casino** (a new Start menu group; "Casino 98" is also in Games). Help: `applets/help/topics/casino.js` (one topic per program).

## Layout

- One window component, `client/src/components/applets/casino/Casino.jsx` (`app: "casino"`); each of the 8 programs in `utils/programs.js` opens it and `window.program` picks the game ("Casino 98" opens the lobby). Switching games inside the window renames it (`onTitle`). All 8 share the lazy chunk `Casino` (AddRemove CHUNKS).
- Program files live in `C:\Programs\Casino\` (`utils/fs.js`), DOS commands `casino holdem poker texas blackjack bj roulette slots vpoker videopoker craps dice baccarat`.
- **Pure rules** (no React; Node tests import them; the server imports `holdem.js`):
  - `cards.js` (shoes built on `../cards/deck.js`; ids carry the deck number, `QH.3`), `poker.js` (best-5-of-7 evaluator, `compare`, Monte Carlo `equity`).
  - `holdem.js`: room-module shape (`create/action/view/isOver/bot/botDelay`), freeze-out NLHE. `holdemBot.js`: equity + pot odds + position + style; easy/normal/hard.
  - `blackjack.js`, `roulette.js`, `slots.js` (reel strips, exact `rtp()` = 94.8%), `videoPoker.js` (9/6 Jacks or Better + a hold hint), `craps.js`, `baccarat.js`.
  - `bank.js`: the chip bank, localStorage `98ish.casino.bank` (per user through `utils/userStorage.js`), 1,000 to start, free refill to 1,000 under 5 chips. Device-only, so no Delete My Account step (listed in Help's privacy-device topic).
  - `local.js`: runs a room-shaped rules module in the browser (timers, quickest bot first), like `lastcard/local.js` but takes `rules`.
- **UI**: `parts.jsx` (useBank, ChipBar, ChipPicker, Chip, PlayingCard with Solitaire's art), `sounds.js` (synth via `utils/audio.js` createBus), one `<Game>Game.jsx` per game, `HoldemTable.jsx` (seats on an oval, raise slider + Min/½ Pot/Pot/All-in), `Casino.css`.
- **Online Hold'em**: `server/arcade/games/holdem.js` loads the client's `holdem.js` (like Last Card); 2-8 seats, turn clock forced on (30 s default), Quick Match buckets by seats+blind+stack, computer players fill seats and take over leavers. Online tables use their own chips, never the bank; nothing is stored.

## Rules worth knowing

- Hold'em: heads-up the button posts the SB and acts first preflop; short all-in raises don't reopen betting (`actedAt < fullRaises`); uncalled bets refunded before pots are built; `buildPots` merges levels with the same eligible set; odd chips go to the first winner left of the button; all-in runouts deal a street every 1.3 s with the hands face up; busted players get places (more chips at the start of the hand places higher).
- Blackjack: S17 default (h17 option), peek on A/10, insurance 2:1, split same value up to 4 hands, split aces one card (21 there pays 1:1), DAS on, late surrender option, 6 decks with a 75% cut card.
- Roulette: European default, American (00 = pocket 37) under More options; inside bets by tapping with a "bet type" mode; on a phone the layout stands up (1 2 3 across). Note 98.css owns the class `.is-vertical` (4 px wide), so the layout uses `.is-upright`.
- Craps: odds capped 3-4-5x; place and come odds are off on the come-out; don't odds are laid (the cap is on the win).
- Closing a window mid-round settles fairly (Blackjack stands, Video Poker keeps its hand, chips on Roulette/Craps/Baccarat felt come back, Hold'em cashes out).

## Tests

- `node --test client/src/components/applets/casino/holdem.test.js` (23: evaluator incl. wheel/kickers/two trips, equity, side pots, odd chips, heads-up order, min-raise, short all-in reopening, runouts, eliminations, turn clock, full bot tables to a winner with chips conserved, the local runner).
- `node --test client/src/components/applets/casino/casino.test.js` (25: blackjack naturals/insurance/S17-H17/splits/surrender/2000-hand basic strategy run, roulette payouts + layout geometry + wheel edges, slots paytable + exact and simulated RTP, video poker paytable + hold/draw, craps line/odds/field/place/come + long session, baccarat third-card table + coups + payouts + frequencies, the bank).
- `server/arcade/test/holdem.test.js` (7, in root `npm test`): hidden hole cards and deck, server-side refusals, the server turn clock, a 5-seat computer table to a winner, leaver replaced by a computer player keeping the chips, Quick Match buckets.
- Browser (scratchpad, playwright-core): each game plays a round at 1280x860 and 390x844 touch, checking the bank arithmetic and that the primary button is on screen; online Hold'em with two browsers in a private room (each sees only their own cards).

## Achievements

`casino-blackjack`, `casino-holdem`, `casino-holdem-online`, `casino-royal`, `casino-jackpot`, `casino-highroller` (10,000 chips).

## Left / ideas

- No video poker "perfect play" hint (the hint is the classic simplified strategy).
- Hold'em online has no rebuys or cash-game mode (freeze-out only); no showing/mucking choice (everyone left in shows at a showdown).
- Craps has no hardways/props/buy/lay bets.
