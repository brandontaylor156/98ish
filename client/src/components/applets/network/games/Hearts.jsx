import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import MenuBar from "../../../shared/MenuBar"
import GameChat, { useGameChatMenuItem } from "../../../shared/GameChat"
import Dialog from "../../../shared/Dialog"
import { useNet } from "../NetContext"
import { Card, cardName } from "./Cards"
import { OnlinePeople } from "../../../shared/online/PlayOnline"
import { GlobeIcon } from "../../../shared/online/PlayOnlineButton"
import "../../../shared/online/Online.css"
import { helpItem } from "../../../../utils/help"

// Hearts at a table of four. Humans join from invitations; the computer plays the empty
// seats (and takes over for anyone who leaves). The server deals, checks every card and
// keeps score.

const DIRECTION_LABEL = { left: "Pass Left", right: "Pass Right", across: "Pass Across" }
const PLACES = ["bottom", "left", "top", "right"] // relative to you, clockwise

// Lay out a hand so all its cards fit the width, overlapping as needed
const useFan = (count) => {
  const [el, setEl] = useState(null) // the hand appears once the cards are dealt
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [el])
  const cardW = width < 420 ? Math.max(40, Math.min(56, Math.floor(width / 6.5))) : 64
  const step = Math.max(0, count > 1 ? Math.min(cardW + 4, (width - cardW - 8) / (count - 1)) : 0)
  // centered under the table
  const start = Math.max(0, (width - (step * (count - 1) + cardW)) / 2)
  return { ref: setEl, cardW, step, start }
}

const LobbyInvite = ({ matchId, seats, pending }) => {
  const net = useNet()
  const free = seats.filter((s) => !s.name).length - pending.length
  return (
    <div className="htInviteList" id={`ht-invite-${matchId}`}>
      <b>
        <GlobeIcon size={16} /> Play online: invite people who are on now
      </b>
      <OnlinePeople
        onInvite={(c) => net.inviteToTable(matchId, { id: c.id })}
        exclude={[...seats.map((s) => s.name).filter(Boolean), ...pending]}
        disabled={free <= 0}
        emptyText="Nobody else is online right now. Deal to play against the computer, or send a friend the link to 98ish and invite them when they show up."
      />
    </div>
  )
}

const ScoreTable = ({ view }) => {
  const order = [0, 1, 2, 3]
  return (
    <table className="htScores">
      <thead>
        <tr>
          <th>Hand</th>
          {order.map((i) => (
            <th key={i} className={i === view.you ? "is-you" : undefined}>
              {view.seats[i].name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {view.history.map((hand, h) => (
          <tr key={h}>
            <td>{h + 1}</td>
            {hand.map((p, i) => (
              <td key={i}>{p}</td>
            ))}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th>Total</th>
          {view.seats.map((s, i) => (
            <th key={i}>{s.score}</th>
          ))}
        </tr>
      </tfoot>
    </table>
  )
}

const Hearts = ({ matchId, onClose }) => {
  const net = useNet()
  const view = net.matches[matchId]
  const chatItem = useGameChatMenuItem("hearts")
  const [chosen, setChosen] = useState([])
  const [error, setError] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [busy, setBusy] = useState(false)
  const fan = useFan(view?.hand?.length || 13)

  // a new deal: nothing chosen
  useEffect(() => setChosen([]), [view?.hand_no, view?.phase === "passing"])
  useEffect(() => setError(null), [view?.turn, view?.phase])
  // The score sheet between hands and at the end
  const autoSheet = useRef(false)
  useEffect(() => {
    if (view?.phase === "handOver" || view?.phase === "gameOver") {
      autoSheet.current = true
      setDialog("scores")
    }
    // the next deal closes it (every fourth hand skips passing and goes straight to play);
    // a sheet opened from the menu mid-hand stays until OK
    else if (autoSheet.current && (view?.phase === "passing" || view?.phase === "playing")) {
      autoSheet.current = false
      setDialog((d) => (d === "scores" ? null : d))
    }
  }, [view?.phase, view?.hand_no])

  if (!view) {
    return (
      <div className="netApp htRoot">
        <p className="netWaitText">Setting up the table...</p>
      </div>
    )
  }

  const you = view.you
  const seatAt = (place) => (you + PLACES.indexOf(place)) % 4
  const lobby = view.phase === "lobby"
  const passing = view.phase === "passing"
  const yourTurn = view.phase === "playing" && view.turn === you
  const legal = new Set(view.legal)
  const received = new Set(view.received)

  const act = async (fn) => {
    setBusy(true)
    const result = await fn()
    setBusy(false)
    if (!result.ok) setError(result.error)
    return result
  }

  const toggle = (card) => setChosen((c) => (c.includes(card) ? c.filter((x) => x !== card) : c.length < 3 ? [...c, card] : c))

  const clickCard = (card) => {
    if (passing && !view.passed) return toggle(card)
    if (yourTurn && legal.has(card) && !busy) return act(() => net.play(matchId, card))
    if (yourTurn) {
      const led = view.trick[0]?.card
      setError(
        view.tricks === 0 && !view.trick.length
          ? "The 2 of clubs leads the first trick."
          : led && view.hand.some((c) => c[1] === led[1])
            ? "You have to follow suit."
            : !led && card[1] === "H"
              ? "Hearts haven't been broken yet."
              : "You can't play that card on the first trick."
      )
    }
  }

  const name = (seat) => view.seats[seat]?.name || "(empty)"
  const winners = view.winners?.map((w) => (w === you ? "You" : name(w))) || []

  const status = error
    ? error
    : lobby
      ? view.host
        ? "Invite people from the network, then click Deal. The computer plays any empty seats."
        : `Waiting for ${view.hostName} to deal...`
      : passing
        ? view.passed
          ? "Waiting for the others to pass..."
          : `Choose 3 cards to pass ${view.direction}.`
        : view.phase === "trickEnd"
          ? `${name(view.trick.reduce((best, p) => (p.card[1] === view.trick[0].card[1] && "23456789TJQKA".indexOf(p.card[0]) > "23456789TJQKA".indexOf(best.card[0]) ? p : best), view.trick[0]).seat)} takes the trick.`
          : view.phase === "playing"
            ? yourTurn
              ? view.tricks === 0 && !view.trick.length
                ? "Your lead: play the 2 of clubs."
                : "Your turn."
              : `Waiting for ${name(view.turn)}...`
            : view.phase === "handOver"
              ? "Hand over. Next deal coming up..."
              : `Game over! ${winners.join(" and ")} ${winners.length > 1 || winners[0] === "You" ? "win" : "wins"}.`

  const menus = [
    {
      label: "Game",
      items: [
        { label: "Deal", disabled: !view.host || !(lobby || view.phase === "gameOver"), onClick: () => act(() => net.startTable(matchId)) },
        { label: "Score...", disabled: lobby, onClick: () => setDialog("scores") },
        { label: "Play Online...", disabled: !lobby || !view.host, onClick: () => document.getElementById(`ht-invite-${matchId}`)?.scrollIntoView({ block: "center" }) },
        "-",
        { label: "Leave Table", onClick: onClose },
      ],
    },
    { label: "Options", items: [chatItem] },
    { label: "Help", items: [helpItem({ program: "Hearts" }), "-", { label: "Rules...", onClick: () => setDialog("rules") }] },
  ]

  const Opponent = ({ place }) => {
    const seat = seatAt(place)
    const s = view.seats[seat]
    const backs = Math.min(s.cards, 13)
    return (
      <div className={`htSeat htSeat--${place}${view.turn === seat && view.phase === "playing" ? " is-turn" : ""}`} data-seat={seat}>
        <div className="htSeatName">
          <b>{s.name || "(empty)"}</b>
          {s.bot && <span className="htBadge">CPU</span>}
          {s.away && <span className="htBadge htBadge--away">offline</span>}
        </div>
        <div className="htSeatInfo">
          {s.score} pts{!lobby && s.points ? ` (+${s.points})` : ""}
          {passing && s.passed ? " - passed" : ""}
        </div>
        {!lobby && (
          <div className="htBacks" aria-label={`${backs} cards`}>
            {Array.from({ length: backs }, (_, i) => (
              <Card key={i} faceDown className="htBack" />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="netApp htRoot">
      <MenuBar menus={menus} />
      {/* with other people at the table, a chat just for them; alone with the computer, the Hearts lobby */}
      <GameChat game="hearts" title="Hearts" room={view.seats.filter((s) => s.name && !s.bot).length > 1 ? `match:${matchId}` : undefined} />
      <div className="htTable">
        {lobby ? (
          <div className="htLobby">
            <h2>Hearts table</h2>
            <p className="htMuted">Play with people online: invite them below. The computer plays any empty seats.</p>
            <ol className="htSeatsList">
              {view.seats.map((s, i) => (
                <li key={i}>
                  <span className="htSeatNo">Seat {i + 1}</span>
                  {s.name ? <b>{s.name}{i === you ? " (you)" : ""}</b> : <span className="htMuted">{view.pending[0] && i === view.seats.findIndex((x) => !x.name) ? "invited..." : "Computer player"}</span>}
                </li>
              ))}
            </ol>
            {view.pending.length > 0 && <p className="htMuted">Waiting for {view.pending.join(", ")} to answer...</p>}
            {view.host && <LobbyInvite matchId={matchId} seats={view.seats} pending={view.pending} />}
            {view.host && (
              <button type="button" className="htDeal" disabled={busy} onClick={() => act(() => net.startTable(matchId))}>
                Deal
              </button>
            )}
          </div>
        ) : (
          <>
            <Opponent place="top" />
            <Opponent place="left" />
            <Opponent place="right" />
            <div className="htCenter">
              {view.trick.map((p) => (
                <Card key={p.card} card={p.card} className={`htPlayed htPlayed--${PLACES[(p.seat - you + 4) % 4]}`} />
              ))}
              {view.heartsBroken && <span className="htBroken" title="Hearts are broken">&hearts;</span>}
            </div>
            <div className={`htYou${yourTurn ? " is-turn" : ""}`}>
              <div className="htYouInfo">
                <b>You</b> {view.seats[you].score} pts{view.seats[you].points ? ` (+${view.seats[you].points})` : ""}
                {passing && !view.passed && (
                  <button type="button" className="htPass" disabled={chosen.length !== 3 || busy} onClick={() => act(() => net.pass(matchId, chosen))}>
                    {DIRECTION_LABEL[view.direction]}
                  </button>
                )}
              </div>
              <div className="htHand" ref={fan.ref} style={{ "--card-w": `${fan.cardW}px` }}>
                {view.hand.map((card, i) => {
                  const selectable = (passing && !view.passed) || yourTurn
                  return (
                    <Card
                      key={card}
                      card={card}
                      className={`htInHand${received.has(card) ? " is-received" : ""}${yourTurn && !legal.has(card) ? " is-dim" : ""}`}
                      style={{ left: fan.start + i * fan.step }}
                      selected={chosen.includes(card)}
                      onClick={selectable ? () => clickCard(card) : undefined}
                      label={`${cardName(card)}${yourTurn && legal.has(card) ? ", playable" : ""}`}
                    />
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="status-bar">
        <p className={error ? "status-bar-field htError" : "status-bar-field"} role="status">
          {status}
        </p>
      </div>

      {dialog === "scores" && !lobby && (
        <Dialog
          title={view.phase === "gameOver" ? "Game Over" : "Score"}
          okLabel={view.phase === "gameOver" && view.host ? "New Game" : "OK"}
          onOk={() => {
            if (view.phase === "gameOver" && view.host) act(() => net.startTable(matchId))
            setDialog(null)
          }}
          onCancel={view.phase === "gameOver" ? () => setDialog(null) : undefined}
          cancelLabel="Close"
        >
          {view.moon !== null && view.handPoints && (view.phase === "handOver" || view.phase === "gameOver") && (
            <p className="dialogText htMoon">{view.moon === you ? "You shot the moon!" : `${name(view.moon)} shot the moon!`}</p>
          )}
          {view.phase === "gameOver" && <p className="dialogText">{winners.join(" and ")} {winners.length > 1 || winners[0] === "You" ? "win" : "wins"}!</p>}
          <ScoreTable view={view} />
        </Dialog>
      )}

      {dialog === "rules" && (
        <Dialog title="Hearts Rules" onOk={() => setDialog(null)}>
          <p className="dialogText">
            Avoid taking hearts (1 point each) and the queen of spades (13 points). Before each hand, pass three cards: left,
            right, across, then no pass. The 2 of clubs leads first. Follow suit if you can; the highest card of the suit led
            wins the trick. Hearts can't be led until one has been played.
            <br />
            <br />
            Take every heart and the queen to shoot the moon: everyone else gets 26. The game ends when someone reaches 100;
            the lowest score wins.
          </p>
        </Dialog>
      )}
    </div>
  )
}

export default Hearts
