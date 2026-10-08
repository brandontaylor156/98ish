import { useState } from "react"
import { MODES, ONLINE_MODES } from "../utils/modes"
import { useNow } from "./parts"

const LEVELS = [
  ["easy", "Easy"],
  ["medium", "Medium"],
  ["hard", "Hard"],
]

const BotLevel = ({ value, onChange, name }) => (
  <div className="tetrisBotLevels" role="radiogroup" aria-label="Computer players">
    {LEVELS.map(([v, label]) => (
      <span key={v}>
        <input id={`${name}-${v}`} type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
        <label htmlFor={`${name}-${v}`}>{label}</label>
      </span>
    ))}
  </div>
)

// Friends to invite: everyone on the network who isn't you (98 Messenger users show up
// under their screen names)
const InviteList = ({ online, room }) => {
  const { net } = online
  const [sent, setSent] = useState({})
  const others = (net.computers || []).filter((c) => !c.me && !room.players.some((p) => p.id === c.id))
  const invite = async (c) => {
    setSent((s) => ({ ...s, [c.id]: "..." }))
    const r = await net.invite({ id: c.id }, "tetris", { roomId: room.id })
    setSent((s) => ({ ...s, [c.id]: r.ok ? "Invited" : r.error }))
  }
  return (
    <fieldset className="tetrisPanel">
      <legend>Invite a Friend</legend>
      {others.length ? (
        <ul className="tetrisRoomList">
          {others.map((c) => (
            <li key={c.id}>
              <span>
                {c.name} <small className="tetrisMuted">{c.user ? "98 Messenger" : "guest"}{c.device === "phone" ? ", handheld" : ""}{c.busy ? ", playing" : ""}</small>
              </span>
              {sent[c.id] && sent[c.id] !== "..." ? (
                <small className="tetrisMuted">{sent[c.id]}</small>
              ) : (
                <button type="button" disabled={!!sent[c.id]} onClick={() => invite(c)}>Invite</button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="tetrisMuted">Nobody else is on the network right now. Add computer players instead, or open 98ish in another window.</p>
      )}
    </fieldset>
  )
}

// Waiting for a match: Quick Match looking for players (computer players offered after a
// while), or a private room the host sets up
const Room = ({ online, onExit }) => {
  const { room, act, error, offset, leave } = online
  const now = useNow(500) + offset.current
  const [level, setLevel] = useState("medium")
  const mode = MODES[room.mode]
  const count = room.players.length
  const botIn = Math.max(0, Math.ceil((room.waitingSince + 10_000 - now) / 1000))

  return (
    <div className="tetrisOnline tetrisRoom" data-room-id={room.id}>
      <div className="tetrisOnlineHead">
        <h2>{room.private ? `${mode.name}: Private Room` : `Quick Match: ${mode.name}`}</h2>
        <button type="button" onClick={leave}>Leave</button>
      </div>
      <p className="tetrisMuted">{mode.blurb}</p>
      {error && <p className="tetrisError" role="alert">{error}</p>}

      <fieldset className="tetrisPanel">
        <legend>Players ({count}/{room.max})</legend>
        <ul className="tetrisSeats">
          {room.players.map((p) => (
            <li key={p.id}>
              <b>{p.name}</b>
              {p.id === room.you && " (you)"}
              {room.private && room.hostName === p.name && <small className="tetrisMuted"> host</small>}
              {p.bot && <small className="tetrisMuted"> computer, {p.bot}</small>}
              {!p.bot && !p.ranked && <small className="tetrisMuted"> guest</small>}
            </li>
          ))}
          {room.invited.map((name) => (
            <li key={`inv-${name}`} className="tetrisMuted">
              {name} (invited...)
            </li>
          ))}
        </ul>
      </fieldset>

      {!room.private && (
        <div className="tetrisPanel tetrisSearching">
          <div className="tetrisHourglass" aria-hidden="true" />
          <div>
            {count >= room.min ? <p>Found {count - 1} opponent{count === 2 ? "" : "s"}. Starting in a moment...</p> : <p>Looking for players...</p>}
            {room.mode === "race" && count < room.min ? (
              // a Sprint Race fills in computer racers by itself (server: MODES.race.autoFill)
              <div className="tetrisBotOffer" data-race-autofill>
                <p>{botIn > 0 ? `If nobody turns up in ${botIn}s, computer racers join and the race starts.` : "Computer racers are joining..."}</p>
                <BotLevel value={level} onChange={(v) => (setLevel(v), act("tetris:botLevel", { roomId: room.id, level: v }))} name={`bots-${room.id}`} />
                <button type="button" className="tetrisFillBots" onClick={() => act("tetris:bots", { roomId: room.id, level })}>
                  Race computer players now
                </button>
              </div>
            ) : room.canFillBots ? (
              <div className="tetrisBotOffer">
                <p>Nobody else is around right now. Play against computer players?</p>
                <BotLevel value={level} onChange={setLevel} name={`bots-${room.id}`} />
                <button type="button" className="tetrisFillBots" onClick={() => act("tetris:bots", { roomId: room.id, level })}>
                  Play with computer players
                </button>
              </div>
            ) : count < room.min && botIn > 0 ? (
              <p className="tetrisMuted">If nobody turns up in {botIn}s you can play computer players instead.</p>
            ) : null}
          </div>
        </div>
      )}

      {room.private && room.host && (
        <>
          <fieldset className="tetrisPanel">
            <legend>Room Setup</legend>
            <div className="tetrisFriendRow">
              <label htmlFor={`mode-${room.id}`}>Mode:</label>
              <select id={`mode-${room.id}`} value={room.mode} onChange={(e) => act("tetris:mode", { roomId: room.id, mode: e.target.value })}>
                {ONLINE_MODES.map((m) => (
                  <option key={m} value={m} disabled={count > MODES[m].players[1]}>
                    {MODES[m].name}
                  </option>
                ))}
              </select>
            </div>
            {room.canFillBots && (
              <div className="tetrisFriendRow">
                <BotLevel value={level} onChange={setLevel} name={`addbot-${room.id}`} />
                <button type="button" className="tetrisAddBot" onClick={() => act("tetris:bots", { roomId: room.id, level })}>
                  Add computer player
                </button>
              </div>
            )}
            <button type="button" className="tetrisStartMatch" disabled={count < room.min} onClick={() => act("tetris:start", { roomId: room.id })}>
              Start {mode.name}
            </button>
            {count < room.min && <p className="tetrisMuted">Needs {room.min} players to start.</p>}
          </fieldset>
          <InviteList online={online} room={room} />
        </>
      )}
      {room.private && !room.host && <p className="tetrisPanel">Waiting for {room.hostName} to start the match...</p>}
      <div className="tetrisRoomFoot">
        <button type="button" onClick={onExit}>Back to Tetris</button>
      </div>
    </div>
  )
}

export default Room
