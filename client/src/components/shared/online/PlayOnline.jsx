import React, { useEffect, useState } from "react"
import { useNet } from "../../applets/network/NetContext"
import { GlobeIcon } from "./PlayOnlineButton"
import { joinLink } from "./useOnlineRoom"
import "./Online.css"

// The standard "Play Online" screens for games on the online room system: the choices
// (Quick Match, Create Room, Join with Code, Invite someone, Play the Computer), then the
// room's lobby (seats, ready, start, code to share, invite list). The game shows its own
// board once the room's phase is "playing" or "over" (see index.js).

const useNow = (ms = 1000) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}

const copy = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // older browsers: a hidden text box
    const box = document.createElement("textarea")
    box.value = text
    box.style.position = "fixed"
    box.style.opacity = "0"
    document.body.appendChild(box)
    box.select()
    const ok = document.execCommand?.("copy")
    box.remove()
    return !!ok
  }
}

// Connection trouble, in plain words, with the button that helps
export const ConnectionPanel = ({ server, onBack }) => (
  <div className={`olConnection olConnection--${server.state}`} role="status">
    {server.state === "waking" || server.state === "connecting" || server.state === "reconnecting" ? <div className="olHourglass" aria-hidden="true" /> : <span className="olWarn" aria-hidden="true">!</span>}
    <div>
      <p>{server.text}</p>
      {server.state === "waking" && <p className="olMuted">{server.seconds} seconds so far.</p>}
      <div className="olRow">
        {(server.state === "offline" || server.state === "no-internet") && (
          <button type="button" onClick={server.retry}>
            Try Again
          </button>
        )}
        {onBack && (
          <button type="button" onClick={onBack}>
            Back
          </button>
        )}
      </div>
    </div>
  </div>
)

// Everyone on the network right now, each with an Invite button.
// onInvite(computer) -> Promise<{ ok, error }>; exclude: names already in the game
export const OnlinePeople = ({ onInvite, exclude = [], disabled = false, emptyText }) => {
  const net = useNet()
  const [sent, setSent] = useState({})
  const others = (net?.computers || []).filter((c) => !c.me && !exclude.includes(c.name))
  const invite = async (c) => {
    setSent((s) => ({ ...s, [c.id]: { busy: true } }))
    const result = await onInvite(c)
    setSent((s) => ({ ...s, [c.id]: result.ok ? { text: "Invited!" } : { text: result.error, error: true } }))
  }
  if (!others.length) {
    return <p className="olMuted olEmpty">{emptyText || "Nobody else is online right now. Share the room code with a friend, or open 98ish in another window to try it yourself."}</p>
  }
  return (
    <ul className="olPeople">
      {others.map((c) => (
        <li key={c.id}>
          <span className="olPerson">
            <b>{c.name}</b>
            <small>
              {c.user ? "98 Messenger" : "guest"}
              {c.device === "phone" ? ", on a phone" : ""}
              {c.busy ? ", playing a game" : ""}
            </small>
          </span>
          {sent[c.id]?.text ? (
            <small className={sent[c.id].error ? "olError" : "olSent"}>{sent[c.id].text}</small>
          ) : (
            <button type="button" disabled={disabled || sent[c.id]?.busy} onClick={() => invite(c)}>
              Invite
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

const Choice = ({ title, text, onClick, busy, disabled, id }) => (
  <button type="button" className="olChoice" data-choice={id} onClick={onClick} disabled={disabled}>
    <b>{busy ? "Please wait..." : title}</b>
    <small>{text}</small>
  </button>
)

const Header = ({ title, icon, children }) => (
  <div className="olHeader">
    {icon ? <img src={icon} width="32" height="32" alt="" /> : <GlobeIcon />}
    <div>
      <h2>{title}</h2>
      {children}
    </div>
    {icon && <GlobeIcon size={24} />}
  </div>
)

// The choices before you're in a room
const Home = ({ online, title, icon, blurb, defaultSettings, renderSettings, quickSettings, computer, onBack, extra }) => {
  const [step, setStep] = useState(null) // null | create | quick | code | invite
  const [settings, setSettings] = useState(defaultSettings || {})
  const [code, setCode] = useState("")
  const { server, busy, error } = online
  const net = online.net
  const others = net?.status === "online" ? net.computers.filter((c) => !c.me).length : 0
  const off = !server.online || !!busy

  const create = async (wantInvite) => {
    const result = await online.createRoom(settings)
    if (result.ok && wantInvite) online.setError(null)
  }

  return (
    <div className="olHome">
      <Header title={`${title} Online`} icon={icon}>
        <p>{blurb || "Play against people anywhere. Share the code with a friend, or get matched with whoever's ready."}</p>
      </Header>

      {!server.online ? (
        <ConnectionPanel server={server} />
      ) : (
        <p className="olStatus">
          <span className="olLed" aria-hidden="true" />
          <span>
            Connected as <b>{online.me?.name || "a guest"}</b> · {others === 0 ? "nobody else online right now" : `${others} other ${others === 1 ? "person" : "people"} online`}
          </span>
        </p>
      )}
      {error && (
        <p className="olError" role="alert">
          {error}
        </p>
      )}
      {online.notice && (
        <p className="olNotice" role="status">
          {online.notice}
        </p>
      )}

      {step === null && (
        <div className="olChoices">
          <Choice
            id="quick"
            title="Quick Match"
            text="Play the next person who's looking for a game."
            busy={busy === "quick"}
            disabled={off}
            onClick={() => (renderSettings && quickSettings ? setStep("quick") : online.quickMatch(settings))}
          />
          <Choice id="create" title="Create Room" text={renderSettings ? "A private room with a code to share. You pick the settings." : "A private room with a code to share with friends."} busy={busy === "create"} disabled={off} onClick={() => (renderSettings ? setStep("create") : create(false))} />
          <Choice id="code" title="Join with Code" text="Got a code like K7QX from a friend? Type it in." busy={busy === "join"} disabled={off} onClick={() => setStep("code")} />
          <Choice id="invite" title="Invite Someone" text={others ? `Pick from the ${others} ${others === 1 ? "person" : "people"} online now.` : "Make a room, then invite people as they come online."} disabled={off} onClick={() => (renderSettings ? setStep("invite") : create(true))} />
          {computer && <Choice id="computer" title="Play the Computer" text="No waiting: computer players fill every other seat." busy={busy === "computer"} disabled={off} onClick={() => online.playComputer(settings)} />}
        </div>
      )}

      {(step === "create" || step === "quick" || step === "invite") && (
        <form
          className="olStep"
          onSubmit={(e) => {
            e.preventDefault()
            if (step === "quick") online.quickMatch(settings)
            else create(step === "invite")
          }}
        >
          <fieldset>
            <legend>{step === "quick" ? "Quick Match settings" : "Room settings"}</legend>
            {renderSettings(settings, setSettings, { disabled: false })}
          </fieldset>
          {step === "quick" && <p className="olMuted">You'll be matched with people who picked the same settings.</p>}
          <div className="olRow">
            <button type="submit" className="olPrimary" disabled={off}>
              {step === "quick" ? "Find Players" : "Create Room"}
            </button>
            <button type="button" onClick={() => setStep(null)}>
              Back
            </button>
          </div>
        </form>
      )}

      {step === "code" && (
        <form
          className="olStep"
          onSubmit={(e) => {
            e.preventDefault()
            online.joinCode(code)
          }}
        >
          <label className="olCodeLabel" htmlFor="ol-code">
            Room code:
          </label>
          <input
            id="ol-code"
            className="olCodeInput"
            value={code}
            maxLength={6}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="K7QX"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            autoFocus
          />
          <div className="olRow">
            <button type="submit" className="olPrimary" disabled={off || code.replace(/[^A-Z0-9]/gi, "").length !== 4}>
              Join
            </button>
            <button type="button" onClick={() => setStep(null)}>
              Back
            </button>
          </div>
        </form>
      )}

      {(onBack || extra) && (
        <div className="olFooter">
          {extra}
          {onBack && (
            <button type="button" onClick={onBack}>
              Back
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const Seat = ({ seat, index, room, online }) => {
  if (!seat) return <li className="olSeat olSeat--open">{index + 1}. (open seat)</li>
  return (
    <li className={seat.you ? "olSeat is-you" : "olSeat"}>
      <span>
        {index + 1}. <b>{seat.name}</b>
        {seat.you && " (you)"}
        {seat.host && <span className="olTag">host</span>}
        {seat.bot && <span className="olTag">computer</span>}
        {seat.away && <span className="olTag olTag--warn">connection lost</span>}
      </span>
      <span className="olSeatEnd">
        {room.private && !seat.bot && <span className={seat.ready ? "olReady is-ready" : "olReady"}>{seat.ready ? "✓ Ready" : "Not ready"}</span>}
        {room.host && !seat.you && room.private && (
          <button type="button" className="olSmall" onClick={() => online.kick(index)} title={`Remove ${seat.name}`}>
            Remove
          </button>
        )}
      </span>
    </li>
  )
}

// Waiting in a room: seats, the code, invitations, ready and start
const Lobby = ({ online, title, icon, renderSettings }) => {
  const { room, busy, error } = online
  const now = useNow(500)
  const [copied, setCopied] = useState(null)
  const [settings, setSettings] = useState(room.settings)
  useEffect(() => setSettings(room.settings), [JSON.stringify(room.settings)])
  const serverNow = now + (online.serverNow() - Date.now())
  const mine = room.you !== null ? room.seats[room.you] : null
  const filled = room.seats.filter(Boolean).length
  const open = room.seats.filter((s) => !s).length
  const botIn = room.botOfferAt ? Math.max(0, Math.ceil((room.botOfferAt - serverNow) / 1000)) : null
  const startIn = room.startsAt ? Math.max(0, Math.ceil((room.startsAt - serverNow) / 1000)) : null

  const doCopy = async (what) => {
    const ok = await copy(what === "code" ? room.code : joinLink(room.code))
    setCopied(ok ? what : "failed")
    setTimeout(() => setCopied(null), 2500)
  }

  return (
    <div className="olLobby" data-room-id={room.id} data-room-code={room.code || ""}>
      <Header title={room.quick ? `Quick Match: ${title}` : `${title}: Private Room`} icon={icon}>
        <p>{room.quick ? (filled < room.max ? "Looking for players..." : "Starting...") : room.host ? "You're the host. Invite people, then start the game." : `${room.hostName || "The host"} starts the game when everyone's ready.`}</p>
      </Header>

      {!online.server.online && <ConnectionPanel server={online.server} />}
      {error && (
        <p className="olError" role="alert">
          {error}
        </p>
      )}
      {room.notice && <p className="olNotice">{room.notice}</p>}

      {room.code && (
        <div className="olCodeBox">
          <div>
            <small>Room code</small>
            <span className="olCode" data-code={room.code}>
              {room.code}
            </span>
          </div>
          <div className="olCodeButtons">
            <button type="button" onClick={() => doCopy("code")}>
              {copied === "code" ? "Copied!" : "Copy Code"}
            </button>
            <button type="button" onClick={() => doCopy("link")}>
              {copied === "link" ? "Copied!" : "Copy Link"}
            </button>
          </div>
          <p className="olMuted">Share the code with a friend: they open {title}, choose Play Online, then Join with Code. Or send the link.</p>
        </div>
      )}

      <fieldset className="olFieldset">
        <legend>
          Players ({filled}/{room.max})
        </legend>
        <ul className="olSeats">
          {room.seats.map((s, i) => (
            <Seat key={i} seat={s} index={i} room={room} online={online} />
          ))}
        </ul>
        {room.spectators.length > 0 && <p className="olMuted">Watching: {room.spectators.join(", ")}</p>}
        {room.invited.length > 0 && <p className="olMuted">Invited: {room.invited.join(", ")} (waiting for an answer)</p>}
        {room.quick && filled < room.max && (
          <p className="olMuted" role="status">
            <span className="olHourglass olHourglass--inline" aria-hidden="true" />
            {startIn !== null ? `Starting in ${startIn}s (more players can still join)...` : room.canFillBots ? "Nobody else yet. Play the computer, or keep waiting." : botIn ? `Waiting for players... Computer players can fill in after ${botIn}s.` : "Waiting for players..."}
          </p>
        )}
      </fieldset>

      {renderSettings && room.private && (
        <fieldset className="olFieldset">
          <legend>Settings{room.host ? "" : " (the host picks)"}</legend>
          {renderSettings(settings, (next) => {
            const value = typeof next === "function" ? next(settings) : next
            setSettings(value)
            online.setSettings(value)
          }, { disabled: !room.host })}
        </fieldset>
      )}

      {!room.spectator && open > 0 && (
        <fieldset className="olFieldset">
          <legend>Invite someone online</legend>
          <OnlinePeople onInvite={(c) => online.invite({ id: c.id })} exclude={[...room.seats.filter(Boolean).map((s) => s.name), ...room.invited]} />
        </fieldset>
      )}

      <div className="olRow olActions">
        {room.spectator && <span className="olMuted">You're watching this room.</span>}
        {room.private && mine && !room.host && (
          <button type="button" className={mine.ready ? "" : "olPrimary"} disabled={busy === "ready"} onClick={() => online.setReady(!mine.ready)}>
            {mine.ready ? "Not Ready" : "I'm Ready"}
          </button>
        )}
        {room.private && room.host && (
          <button type="button" className="olPrimary" disabled={!room.canStart || busy === "start"} onClick={online.start} title={room.waitingFor || "Start the game"}>
            Start Game
          </button>
        )}
        {room.canFillBots && (
          <button type="button" disabled={busy === "bots"} onClick={online.fillBots}>
            {room.quick ? "Play the Computer" : "Add Computer Players"}
          </button>
        )}
        <button type="button" onClick={online.leave}>
          Leave
        </button>
      </div>
      {room.private && room.waitingFor && <p className="olMuted olWaiting">{mine && !room.host && !mine.ready ? "Click I'm Ready when you're set, and the host can start." : room.waitingFor}</p>}
      <p className="olMuted olChatHint">Chat with the room with the speech bubble in the title bar.</p>
    </div>
  )
}

// Who won, rematch votes, back to the lobby. For the game's own screen once phase is "over".
export const OnlineResultBar = ({ online, text }) => {
  const { room, busy } = online
  if (!room || room.phase !== "over") return null
  const r = room.result || {}
  const youWon = room.you !== null && r.winners?.includes(room.you)
  const headline = text || (r.draw && !r.winners?.length ? "It's a draw." : youWon ? (r.winners.length > 1 ? "Your side wins!" : "You win!") : `${(r.winnerNames || []).join(" and ")} ${r.winners?.length > 1 ? "win" : "wins"}.`)
  const voted = room.you !== null && room.rematch.includes(room.you)
  const wanting = room.rematch.filter((s) => s !== room.you).map((s) => room.seats[s]?.name).filter(Boolean)
  return (
    <div className="olResult" role="status">
      <b>{headline}</b>
      {wanting.length > 0 && !voted && <small>{wanting.join(", ")} {wanting.length > 1 ? "want" : "wants"} a rematch</small>}
      <span className="olRow">
        {!room.spectator && (
          <button type="button" className={voted ? "" : "olPrimary"} disabled={voted || busy === "rematch"} onClick={online.rematch}>
            {voted ? "Waiting for the others..." : wanting.length ? "Accept Rematch" : "Rematch"}
          </button>
        )}
        {room.host && room.private && (
          <button type="button" onClick={online.backToLobby}>
            Back to Lobby
          </button>
        )}
        <button type="button" onClick={online.leave}>
          Leave
        </button>
      </span>
    </div>
  )
}

// props: online (useOnlineRoom's result), title, icon, blurb, defaultSettings,
// renderSettings(settings, setSettings, { disabled }), quickSettings, computer, onBack, extra
const PlayOnline = (props) => {
  const { online } = props
  if (online.room && online.room.phase === "lobby") return <Lobby {...props} />
  return <Home {...props} />
}

export default PlayOnline
