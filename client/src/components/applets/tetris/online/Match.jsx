import { useEffect, useRef, useState } from "react"
import TetrisWindow from "../components/TetrisWindow"
import { useTetris } from "../hooks/useTetris"
import { useTetrisAchievements } from "../hooks/useTetrisAchievements"
import { receiveGarbage, respawn, stackHeight, sweepRows, toSnapshot } from "../utils/engine"
import { ITEM_INFO, LINES_PER_ITEM, randomItem } from "../utils/items"
import { MODES, formatTime } from "../utils/modes"
import { unlock } from "../../../../utils/achievements"
import { MiniBoard, Stars, placeName, useNow, useSize } from "./parts"

const SEND_EVERY = 150 // ms between board snapshots (about 6 a second)
const TARGETS = [
  ["random", "Random"],
  ["leader", "Leader (most sent)"],
  ["danger", "Finisher (tallest stack)"],
  ["attackers", "Revenge (my attackers)"],
]

// One opponent: board, name and the numbers that matter in this mode
const Opponent = ({ p, board, mode, targeted, big }) => (
  <div className={`tetrisOpp${big ? " tetrisOpp--big" : ""}${p.alive ? "" : " is-out"}${targeted ? " is-target" : ""}`} data-player={p.id}>
    <div className="tetrisOppName" title={p.name}>
      {targeted && <span aria-label="your target">▶ </span>}
      {p.name}
    </div>
    <div className="tetrisOppBoard">
      <MiniBoard snap={board?.b} dead={!p.alive} />
      {!p.alive && <div className="tetrisOppOut">{p.place ? placeName(p.place) : "OUT"}</div>}
      {p.finishTime != null && <div className="tetrisOppOut tetrisOppDone">{formatTime(p.finishTime)}</div>}
      {p.away && <div className="tetrisOppOut">away</div>}
    </div>
    <div className="tetrisOppStats">
      {mode === "race" ? (
        <>
          <div className="tetrisRaceBar" aria-label={`${p.lines} of 40 lines`}>
            <div style={{ width: `${Math.min(100, ((board?.l ?? p.lines) / 40) * 100)}%` }} />
          </div>
          <span>{Math.min(40, board?.l ?? p.lines)}/40</span>
        </>
      ) : (
        <>
          <span>{p.kos} KO</span>
          <span>{board?.s ?? p.sent} sent</span>
        </>
      )}
    </div>
  </div>
)

// The end of a match: places, and stars earned
const Results = ({ room, ranks, onAgain, onLobby }) => {
  const { result } = room
  const mine = result.placements.find((p) => p.id === room.you)
  const rank = ranks[room.mode]
  const title = result.draw ? "Draw!" : mine?.place === 1 ? "You win!" : mine ? `You placed ${placeName(mine.place)}` : "Match over"
  return (
    <div className="tetrisResults" role="dialog" aria-label="Match results">
      <div className="tetrisResultsBox">
        <div className="tetrisResultsTitle">{title}</div>
        <ol className="tetrisPlaces">
          {result.placements.map((p) => (
            <li key={p.id} className={p.id === room.you ? "is-you" : ""}>
              <span className="tetrisPlaceNo">{placeName(p.place)}</span>
              <span className="tetrisPlaceName">
                {p.name}
                {p.bot && <small className="tetrisMuted"> (computer)</small>}
                {p.left && <small className="tetrisMuted"> (left)</small>}
              </span>
              <span className="tetrisPlaceStat">
                {room.mode === "race" ? (p.time != null ? formatTime(p.clientTime ?? p.time) : `${p.lines} lines`) : `${p.kos} KO · ${p.sent} sent`}
              </span>
              {p.stars > 0 && <span className="tetrisPlaceStars">+{p.stars}★</span>}
            </li>
          ))}
        </ol>
        {rank ? (
          <p className="tetrisRankLine">
            {rank.gained > 0 ? `+${rank.gained} star${rank.gained === 1 ? "" : "s"}! ` : ""}
            {MODES[room.mode].name} rank {rank.rank} <Stars into={rank.into} need={rank.need} />
          </p>
        ) : !result.ranked ? (
          <p className="tetrisMuted">Unranked: stars need another person or hard computer players.</p>
        ) : !mine?.stars && mine && !room.players.find((p) => p.id === room.you)?.ranked ? (
          <p className="tetrisMuted">Sign on to 98 Messenger to earn stars.</p>
        ) : null}
        <div className="tetrisResultsButtons">
          {room.private ? (
            room.host ? (
              <button type="button" className="tetrisAgain" onClick={onAgain} autoFocus>Play again</button>
            ) : (
              <span className="tetrisMuted">Waiting for {room.hostName} to start again...</span>
            )
          ) : (
            <button type="button" className="tetrisAgain" onClick={onAgain} autoFocus>Find another match</button>
          )}
          <button type="button" onClick={onLobby}>Lobby</button>
        </div>
      </div>
    </div>
  )
}

const Match = ({ online, onExit }) => {
  const { room, boards, feed, ranks, act, request, socket, offset, leave } = online
  const mode = room.mode
  const me = room.players.find((p) => p.id === room.you)
  const now = useNow(100) + offset.current
  const started = room.phase === "playing" || (room.phase === "countdown" && now >= room.startAt)
  const [out, setOut] = useState(false) // topped out (Arena, Race)
  const [finished, setFinished] = useState(null) // race time
  const [ko, setKo] = useState(0) // when we were last K.O.'d (Battle)
  const [item, setItem] = useState(null)
  const [dark, setDark] = useState(false)
  const [mirror, setMirror] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [lastTarget, setLastTarget] = useState(null) // who our last attack hit
  const noteTarget = (r) => r?.target && setLastTarget(r.target)
  const running = started && room.phase !== "over" && !out && finished === null && me?.alive !== false

  // the window's game chat switches to this match's room while we're in it
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("98ish:tetris-match", { detail: room.id }))
    return () => window.dispatchEvent(new CustomEvent("98ish:tetris-match", { detail: null }))
  }, [room.id])

  const itemRef = useRef(null)
  itemRef.current = item
  const roomRef = useRef(room)
  roomRef.current = room

  const onAction = (action) => {
    if (action !== "item" || mode !== "arena" || !itemRef.current) return
    const used = itemRef.current
    setItem(null)
    if (used === "shield") tetris.update((s) => ({ ...s, shield: true }))
    if (used === "sweep") tetris.update((s) => sweepRows(s, 3))
    request("tetris:item", { roomId: room.id, item: used }).then(noteTarget)
  }

  const tetris = useTetris(mode, { seed: room.seed, running, onAction })
  const { game } = tetris
  useTetrisAchievements(game, mode)

  // garbage and item effects aimed at us
  useEffect(() => {
    const timers = []
    const ends = {}
    const onGarbage = (g) => {
      if (g.roomId === roomRef.current.id) tetris.update((s) => receiveGarbage(s, g))
    }
    const onEffect = (e) => {
      if (e.roomId !== roomRef.current.id) return
      const set = e.item === "mirror" ? (on) => (tetris.setMirror(on), setMirror(on)) : setDark
      set(true)
      // a second hit of the same item restarts its clock (the first one's timer ended it early)
      clearTimeout(ends[e.item])
      ends[e.item] = setTimeout(() => set(false), e.ms || 5000)
      timers.push(ends[e.item])
    }
    socket.on("tetris:garbage", onGarbage)
    socket.on("tetris:effect", onEffect)
    return () => {
      socket.off("tetris:garbage", onGarbage)
      socket.off("tetris:effect", onEffect)
      timers.forEach(clearTimeout)
    }
  }, [socket])

  // our attacks go to the server, which picks who they hit
  useEffect(() => {
    const a = game.attack
    if (a && a.sent > 0 && room.phase === "playing") request("tetris:attack", { roomId: room.id, lines: a.sent }).then(noteTarget)
  }, [game.attack?.id])

  // Arena: every few lines cleared earns an item (one at a time)
  const linesAt = useRef(0)
  useEffect(() => {
    if (mode !== "arena") return
    if (game.lines - linesAt.current >= LINES_PER_ITEM) {
      linesAt.current = game.lines
      if (!itemRef.current) setItem(randomItem())
    }
  }, [game.lines])

  // our board, a few times a second, when it has changed
  const gameRef = tetris.gameRef
  useEffect(() => {
    if (room.phase !== "playing") return
    let lastSent = null
    const id = setInterval(() => {
      const g = gameRef.current
      const b = toSnapshot(g)
      if (b + g.lines === lastSent) return
      lastSent = b + g.lines
      socket.emit("tetris:state", { roomId: room.id, b, lines: g.lines, height: stackHeight(g.board) })
    }, SEND_EVERY)
    return () => clearInterval(id)
  }, [room.phase])

  const onGameOver = (g) => {
    if (roomRef.current.phase !== "playing") return
    if (mode === "race" && g.endReason === "goal") {
      setFinished(g.time)
      request("tetris:finish", { roomId: room.id, time: Math.round(g.time), lines: g.lines })
      return
    }
    if (g.endReason !== "topout") return
    request("tetris:topout", { roomId: room.id })
    if (mode === "battle") {
      setKo(Date.now())
      tetris.update(respawn)
    } else setOut(true)
  }

  // the first Battle win
  useEffect(() => {
    if (room.phase !== "over" || mode !== "battle") return
    const mine = room.result?.placements.find((p) => p.id === room.you)
    if (mine?.place === 1 && !room.result.draw) unlock("tetris-battle")
  }, [room.phase])

  // dev-only hooks for the browser tests
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__tetrisOnline = {
      room: () => roomRef.current,
      attack: (lines) => request("tetris:attack", { roomId: roomRef.current.id, lines }).then(noteTarget),
      topout: () => tetris.update((s) => ({ ...s, status: "over", endReason: "topout" })),
      finish: () => tetris.update((s) => ({ ...s, lines: 40 })),
      giveItem: (name) => setItem(name),
      game: () => gameRef.current,
    }
    return () => delete window.__tetrisOnline
  }, [])

  // layout: opponents beside the board, or a strip above it in narrow windows (phones)
  const areaRef = useRef(null)
  const size = useSize(areaRef)
  const narrow = size ? size.width < 620 : false
  const others = room.players.filter((p) => p.id !== room.you)
  const target = lastTarget ?? me?.target

  // the clock: Battle and Race count down; Arena counts to overtime
  let clock = null
  if (room.phase === "countdown" && !started) clock = "Get ready"
  else if (room.endsAt) clock = formatTime(Math.max(0, room.endsAt - now), false)
  else if (room.escalateAt) clock = now < room.escalateAt ? formatTime(room.escalateAt - now, false) : "Overtime!"

  const countdown = room.phase === "countdown" && !started ? Math.max(1, Math.ceil((room.startAt - now) / 1000)) : null
  const showGo = room.phase !== "over" && started && now - room.startAt < 800
  const koFlash = ko && Date.now() - ko < 1200
  const myPlace = me?.place

  const overlay =
    countdown !== null ? (
      <div className="tetrisOverlay tetrisCountdown"><div>{countdown}</div></div>
    ) : showGo ? (
      <div className="tetrisOverlay tetrisOverlay--clear tetrisCountdown"><div>GO!</div></div>
    ) : koFlash ? (
      <div className="tetrisOverlay tetrisOverlay--clear tetrisKo"><div>K.O.!</div></div>
    ) : finished !== null ? (
      <div className="tetrisOverlay"><div>Finished!</div><div>{formatTime(finished)}</div><div className="tetrisOverlayHint">Waiting for the others...</div></div>
    ) : out || me?.alive === false ? (
      <div className="tetrisOverlay"><div>Topped out</div>{myPlace && <div>{placeName(myPlace)} place</div>}<div className="tetrisOverlayHint">Watching the rest...</div></div>
    ) : null

  const stats =
    mode === "race"
      ? [
          { label: "Time", value: formatTime(started ? game.time : 0) },
          { label: "Lines left", value: Math.max(0, 40 - game.lines) },
        ]
      : [
          { label: mode === "battle" ? "KOs" : "K.O.", value: me?.kos ?? 0 },
          { label: "Sent", value: game.stats.sent },
        ]

  return (
    <div className={`tetrisMatch${narrow ? " tetrisMatch--narrow" : ""}${chatOpen ? " tetrisMatch--chat" : ""}`} data-mode={mode} data-room-id={room.id} data-match-id={`${room.id}:${room.round}`} ref={areaRef}>
      <div className="tetrisMatchBar">
        <b>{room.modeName}</b>
        {clock && <span className="tetrisClock" aria-label="match clock">{clock}</span>}
        {mode === "battle" && (
          <span className="tetrisScore">
            KOs {me?.kos ?? 0} : {others[0]?.kos ?? 0}
          </span>
        )}
        {mode === "arena" && (
          <select aria-label="Target" className="tetrisTargetSelect" value={room.strategy} onChange={(e) => act("tetris:target", { roomId: room.id, strategy: e.target.value })}>
            {TARGETS.map(([v, label]) => (
              <option key={v} value={v}>Target: {label}</option>
            ))}
          </select>
        )}
        {mirror && <span className="tetrisEffect">Mirrored!</span>}
        {dark && <span className="tetrisEffect">Lights out!</span>}
        <span className="tetrisBarSpacer" />
        <button type="button" className="tetrisChatToggle" aria-expanded={chatOpen} onClick={() => setChatOpen((o) => !o)}>Chat</button>
        <button type="button" onClick={leave}>Leave</button>
      </div>
      <div className="tetrisOpponents" data-count={others.length}>
        {others.map((p) => (
          <Opponent key={p.id} p={p} board={boards[p.id]} mode={mode} targeted={mode === "arena" && target === p.id} big={!narrow && mode === "battle"} />
        ))}
      </div>
      <div className="tetrisMatchMain">
        <TetrisWindow
          tetris={tetris}
          online
          stats={stats}
          item={mode === "arena" ? item : undefined}
          dark={dark}
          overlay={overlay}
          onGameOver={onGameOver}
          onQuit={leave}
        />
      </div>
      {/* match events (KOs, items...); talking happens in the window's game chat */}
      <aside className="tetrisChatSlot" data-room-id={room.id} hidden={!chatOpen} aria-label="Match events">
        {feed.length ? (
          <ul className="tetrisFeed" aria-live="polite">
            {feed.slice(-12).map((f) => (
              <li key={f.id}>{f.text}</li>
            ))}
          </ul>
        ) : (
          <p className="tetrisMuted">Match events show up here.</p>
        )}
      </aside>
      {!chatOpen && feed.length > 0 && <div className="tetrisFeedToast" key={feed.at(-1).id}>{feed.at(-1).text}</div>}
      {room.phase === "over" && room.result && (
        <Results
          room={room}
          ranks={ranks}
          onAgain={() => (room.private ? act("tetris:start", { roomId: room.id }) : act("tetris:quick", { mode }))}
          onLobby={leave}
        />
      )}
    </div>
  )
}

export default Match
