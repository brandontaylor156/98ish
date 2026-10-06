import React, { useState } from "react"
import MoreOptions from "../../shared/MoreOptions"
import Dialog from "../../shared/Dialog"
import { formatChips } from "./parts"
import { START } from "./bank"

// The casino floor: a tile per game, your chips, and (under More options) your record and a
// fresh start.
const Lobby = ({ games, bank, onPick }) => {
  const [confirm, setConfirm] = useState(false)
  const d = bank.data
  return (
    <div className="csLobby">
      <div className="csMarquee" aria-hidden="true">
        <span>CASINO</span>
        <b>98</b>
      </div>
      <p className="csTag">Pick a table. Every game plays from the same chips (play chips, never real money).</p>
      <div className="csTiles">
        {games.map((g) => (
          <button key={g.key} type="button" className="csTile" onClick={() => onPick(g.key)} data-pick={g.key}>
            <img src={`/assets/program_icons/${g.icon}.svg`} alt="" draggable="false" />
            <b>{g.program}</b>
            <small>{g.blurb}</small>
          </button>
        ))}
      </div>
      <MoreOptions id="casino.lobby" className="csMore" summary={`Biggest win ${formatChips(d.biggestWin)} · ${d.refills} refill${d.refills === 1 ? "" : "s"}`}>
        <table className="csStats">
          <tbody>
            <tr>
              <th>Chips</th>
              <td>{formatChips(d.balance)}</td>
            </tr>
            <tr>
              <th>Won in total</th>
              <td>{formatChips(d.won)}</td>
            </tr>
            <tr>
              <th>Lost in total</th>
              <td>{formatChips(d.lost)}</td>
            </tr>
            <tr>
              <th>Biggest win</th>
              <td>{formatChips(d.biggestWin)}</td>
            </tr>
            <tr>
              <th>Free refills</th>
              <td>{d.refills}</td>
            </tr>
          </tbody>
        </table>
        <div className="csRow">
          <button type="button" onClick={() => setConfirm(true)}>
            Start Over...
          </button>
        </div>
      </MoreOptions>
      {confirm && (
        <Dialog
          title="Start Over"
          onOk={() => {
            bank.reset()
            setConfirm(false)
          }}
          onCancel={() => setConfirm(false)}
          okLabel="Start Over"
        >
          <p>Go back to {formatChips(START)} chips and clear your record?</p>
        </Dialog>
      )}
    </div>
  )
}

export default Lobby
