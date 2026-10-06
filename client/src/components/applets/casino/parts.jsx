import React, { useEffect, useState } from "react"
import { faceUrl, backUrl, DEFAULT_BACK } from "../cards/art"
import { getBank, formatChips } from "./bank"
import { sfx } from "./sounds"
import { unlock } from "../../../utils/achievements"

// Pieces every casino game uses: the chip bank as React state, the balance bar, the chip
// rack you bet from, chips on the felt, and playing cards (Solitaire's art).

export const useBank = () => {
  const bank = getBank()
  const [, setTick] = useState(0)
  useEffect(
    () =>
      bank.subscribe((d) => {
        setTick((t) => t + 1)
        if (d.balance >= 10000) unlock("casino-highroller")
      }),
    [bank]
  )
  return bank
}

export const DENOMS = [5, 25, 100, 500, 1000]
const CHIP_CLASS = { 1: "c1", 2: "c1", 5: "c5", 10: "c5", 25: "c25", 50: "c25", 100: "c100", 500: "c500", 1000: "c1000" }
export const chipLabel = (n) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 10_000 ? `${Math.round(n / 100) / 10}K` : n >= 1000 && n % 1000 === 0 ? `${n / 1000}K` : String(n))
// the chip colour for an amount: the biggest denomination it reaches
const classFor = (n) => {
  const d = [...DENOMS, 1].sort((a, b) => b - a).find((x) => n >= x) || 1
  return CHIP_CLASS[d]
}

// one chip (or a stack's worth) on the felt
export const Chip = ({ amount, small = false, title, className = "" }) =>
  amount > 0 ? (
    <span className={`csChip ${classFor(amount)}${small ? " is-small" : ""} ${className}`} title={title || `${formatChips(amount)} chips`}>
      <span>{chipLabel(amount)}</span>
    </span>
  ) : null

// the rack: pick the chip each tap bets
export const ChipPicker = ({ value, onChange, max = Infinity, denoms = DENOMS }) => (
  <div className="csRack" role="radiogroup" aria-label="Chip">
    {denoms.map((d) => (
      <button
        key={d}
        type="button"
        role="radio"
        aria-checked={value === d}
        aria-label={`${d} chip`}
        className={`csChip ${classFor(d)} csRackChip${value === d ? " is-on" : ""}`}
        disabled={d > max}
        onClick={() => {
          sfx.chip()
          onChange(d)
        }}
      >
        <span>{chipLabel(d)}</span>
      </button>
    ))}
  </div>
)

// the bar under the menus: back to the lobby, the game's name, and your chips
export const ChipBar = ({ title, onLobby, extra = null, bank }) => (
  <div className="csBar">
    {onLobby && (
      <button type="button" className="csLobbyBtn" onClick={onLobby} data-lobby>
        « Lobby
      </button>
    )}
    <b className="csBarTitle">{title}</b>
    {extra}
    <span className="csBalance" data-balance={bank.balance}>
      <Chip amount={Math.max(1, Math.min(bank.balance, 1000))} small />
      <b>{formatChips(bank.balance)}</b>
      <span className="csBalanceUnit">chips</span>
    </span>
    {bank.needsRefill() && (
      <button type="button" className="csRefill" onClick={() => (bank.refill(), sfx.chips())} data-refill>
        Free refill
      </button>
    )}
  </div>
)

// a playing card: face up (card) or down (card null / down)
export const PlayingCard = ({ card, down = false, small = false, dim = false, glow = false, delay = 0, className = "" }) => {
  const src = !card || down ? backUrl(DEFAULT_BACK) : faceUrl(card)
  return (
    <span className={`csCard${small ? " is-small" : ""}${dim ? " is-dim" : ""}${glow ? " is-glow" : ""} ${className}`} style={delay ? { animationDelay: `${delay}ms` } : undefined}>
      <img src={src} alt={!card || down ? "Face-down card" : cardAlt(card)} draggable="false" />
    </span>
  )
}

const RANKS = ["", "Ace", "2", "3", "4", "5", "6", "7", "8", "9", "10", "Jack", "Queen", "King"]
const SUITS = ["clubs", "diamonds", "hearts", "spades"]
export const cardAlt = (c) => `${RANKS[c.rank]} of ${SUITS[c.suit]}`

// "+120" / "-40" / "even"
export const signed = (n) => (n > 0 ? `+${formatChips(n)}` : n < 0 ? `-${formatChips(-n)}` : "even")

export { formatChips }
