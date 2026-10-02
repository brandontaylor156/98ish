import { useEffect, useState } from "react"
import { MODES, ONLINE_MODES } from "../utils/modes"
import { Stars } from "./parts"

const PLAYERS = { battle: "2 players", arena: "2-6 players", race: "2-5 players" }

// Rankings for one mode: the top 20 by stars, and you
const Rankings = ({ online }) => {
  const [mode, setMode] = useState("battle")
  const [data, setData] = useState(null)
  useEffect(() => {
    let live = true
    setData(null)
    online.request("tetris:leaderboard", { mode }).then((r) => live && setData(r))
    return () => {
      live = false
    }
  }, [mode])
  return (
    <fieldset className="tetrisPanel tetrisRankings">
      <legend>Rankings</legend>
      <div className="tetrisTabs" role="tablist">
        {ONLINE_MODES.map((m) => (
          <button key={m} type="button" role="tab" aria-selected={m === mode} className={m === mode ? "is-active" : ""} onClick={() => setMode(m)}>
            {MODES[m].name}
          </button>
        ))}
      </div>
      {!data ? (
        <p className="tetrisMuted">Loading...</p>
      ) : !data.ok ? (
        <p className="tetrisMuted">{data.error}</p>
      ) : (
        <>
          {data.me && (
            <div className="tetrisMyRank">
              You: Rank {data.me.rank} <Stars into={data.me.into} need={data.me.need} /> ({data.me.wins} win{data.me.wins === 1 ? "" : "s"} in {data.me.played})
            </div>
          )}
          {data.top.length ? (
            <ol className="tetrisBoardList">
              {data.top.map((r, i) => (
                <li key={r.screenName}>
                  <span className="tetrisRankNo">{i + 1}.</span>
                  <span className="tetrisRankName">{r.screenName}</span>
                  <span>Rank {r.rank}</span>
                  <span className="tetrisMuted">{r.stars}★</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="tetrisMuted">Nobody has ranked in {MODES[mode].name} yet. Be the first!</p>
          )}
        </>
      )}
    </fieldset>
  )
}

const Lobby = ({ online, onExit }) => {
  const { net, act, error } = online
  const [rooms, setRooms] = useState([])
  const [friendMode, setFriendMode] = useState("battle")
  const signedIn = !!net.me?.user

  // the open rooms, refreshed every few seconds
  useEffect(() => {
    let live = true
    const load = () => online.request("tetris:list").then((r) => live && r.ok && setRooms(r.rooms))
    load()
    const id = setInterval(load, 4000)
    return () => {
      live = false
      clearInterval(id)
    }
  }, [])

  return (
    <div className="tetrisOnline tetrisLobby">
      <div className="tetrisOnlineHead">
        <h2>Tetris Online</h2>
        <button type="button" onClick={onExit}>Back</button>
      </div>
      <p className="tetrisIdentity">
        {signedIn ? (
          <>Signed on as <b>{net.me.name}</b>. Wins earn stars and rank you up.</>
        ) : (
          <>Playing as <b>{net.me?.name || "a guest"}</b>. Sign on to 98 Messenger to earn stars and appear in the rankings.</>
        )}
      </p>
      {error && <p className="tetrisError" role="alert">{error}</p>}

      <fieldset className="tetrisPanel">
        <legend>Quick Match</legend>
        <div className="tetrisModeCards">
          {ONLINE_MODES.map((mode) => (
            <button key={mode} type="button" className="tetrisModeCard" data-quick={mode} onClick={() => act("tetris:quick", { mode })}>
              <b>{MODES[mode].name}</b>
              <span>{MODES[mode].blurb}</span>
              <small>{PLAYERS[mode]}</small>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="tetrisPanel">
        <legend>Play with a Friend</legend>
        <div className="tetrisFriendRow">
          <select aria-label="Mode" value={friendMode} onChange={(e) => setFriendMode(e.target.value)}>
            {ONLINE_MODES.map((m) => (
              <option key={m} value={m}>{MODES[m].name}</option>
            ))}
          </select>
          <button type="button" className="tetrisCreateRoom" onClick={() => act("tetris:create", { mode: friendMode, isPrivate: true })}>
            Create a room...
          </button>
        </div>
        <p className="tetrisMuted">Then invite anyone on Network Neighborhood or 98 Messenger. Empty seats can be filled with computer players.</p>
      </fieldset>

      <fieldset className="tetrisPanel">
        <legend>Open Rooms</legend>
        {rooms.length ? (
          <ul className="tetrisRoomList">
            {rooms.map((r) => (
              <li key={r.id}>
                <span>
                  <b>{r.modeName}</b> {r.players.join(", ")} ({r.players.length}/{r.max})
                </span>
                <button type="button" onClick={() => act("tetris:join", { roomId: r.id })}>Join</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="tetrisMuted">No open rooms right now. Start a Quick Match and others will find you.</p>
        )}
      </fieldset>

      <Rankings online={online} />
    </div>
  )
}

export default Lobby
