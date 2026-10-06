import React, { useEffect, useMemo, useRef, useState } from "react"
import { BOT_NAME, keyOf, useAim } from "../aim/AimContext"
import MoreOptions from "../../shared/MoreOptions"
import { launch } from "../../../utils/programs"
import { createPlayer } from "./player"
import * as store from "./togetherStore"
import { canControl, clock, current, decide, expectedPos, parseYouTube, peopleLine, RATES, REACTIONS, userJumped } from "./syncCore"
import "./Together.css"

// Watch & Listen Together: a YouTube video (and an Up Next queue) playing in sync for an IM
// conversation or a chat room, with reactions floating over it and a little chat strip.
// The baseline view is the video, play/pause and the seek bar, reactions and "Add a video";
// Up Next, speed, who controls, Mini player and End are under More options.

const TICK_MS = 1000
const SELF_MS = 900 // a player change we caused ourselves (not the person tapping YouTube's controls)

// a video's title for Up Next: YouTube '98's lookup, then YouTube's oEmbed, then a plain name
const titleFor = async (id) => {
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), ms))])
  try {
    const { getVideo } = await import("../videoPlayer/api")
    const data = await withTimeout(getVideo(id), 2500)
    const title = data?.video?.title || data?.title
    if (title) return title
  } catch {
    // no API key, or offline
  }
  try {
    const res = await withTimeout(fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`), 2500)
    if (res.ok) return (await res.json()).title || ""
  } catch {
    // CORS or offline
  }
  return ""
}

const TvIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="tgIcon">
    <rect x="1" y="3" width="14" height="10" fill="#000080" stroke="#000" />
    <rect x="2.5" y="4.5" width="11" height="7" fill="#7fd0ff" />
    <path d="M7 6.2 L10.2 8 L7 9.8 Z" fill="#fff" />
    <path d="M5 1 L8 3 L11 1" stroke="#000" fill="none" />
  </svg>
)

// ---- the start screen ----

const StartView = ({ aim, handoff, mobile }) => {
  const snap = store.useTogether()
  const [target, setTarget] = useState("")
  const [link, setLink] = useState("")
  const [invites, setInvites] = useState([])
  const [search, setSearch] = useState(null) // { q, results, busy, error }
  const online = useMemo(
    () =>
      Object.values(aim.presence || {})
        .filter((p) => p.online && !p.bot && keyOf(p.screenName) !== keyOf(BOT_NAME) && keyOf(p.screenName) !== keyOf(aim.me?.screenName))
        .map((p) => p.screenName)
        .sort((a, b) => a.localeCompare(b)),
    [aim.presence, aim.me]
  )
  const rooms = Object.values(aim.rooms || {}).map((r) => r.name)

  useEffect(() => {
    let alive = true
    const refresh = () => store.mine().then((res) => alive && res?.ok && setInvites(res.sessions.filter((s) => !s.joined)))
    refresh()
    const t = setInterval(refresh, 10_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  // prefilled from an IM window, a chat room or YouTube '98
  useEffect(() => {
    if (!handoff) return
    if (handoff.with) setTarget(`im:${handoff.with}`)
    if (handoff.room) setTarget(`room:${handoff.room}`)
    if (handoff.video) setLink(`https://youtu.be/${handoff.video}`)
  }, [handoff?.id])

  const choice = target || (online[0] ? `im:${online[0]}` : rooms[0] ? `room:${rooms[0]}` : "")
  const parsed = parseYouTube(link)
  const begin = async () => {
    if (!choice) return
    const [kind, ...rest] = choice.split(":")
    const name = rest.join(":")
    const options = kind === "room" ? { room: name } : { with: name }
    if (parsed) {
      options.video = parsed.id
      options.start = parsed.start
      options.title = handoff?.video === parsed.id && handoff.title ? handoff.title : await titleFor(parsed.id)
    }
    const res = await store.start(options)
    // tell them in the conversation too (the invite reaches them either way)
    if (res?.ok && !res.joined && kind === "im") aim.addNotice?.(name, "You started Watch Together. They've been invited.")
  }

  const runSearch = async () => {
    const q = (search?.q || "").trim()
    if (!q) return
    setSearch({ ...search, busy: true, error: null })
    try {
      const { searchVideos } = await import("../videoPlayer/api")
      const data = await searchVideos(q)
      setSearch({ q, results: (data.videos || []).slice(0, 10), busy: false })
    } catch (error) {
      setSearch({ q, results: [], busy: false, error: error.message || "Search isn't working right now. Paste a link instead." })
    }
  }

  return (
    <div className="tgStart">
      <div className="tgHero">
        <TvIcon size={32} />
        <div>
          <b>Watch &amp; Listen Together</b>
          <div className="tgHint">A YouTube video plays for you and your buddies at the same moment. Pause, skip and react together.</div>
        </div>
      </div>

      {invites.length > 0 && (
        <fieldset className="tgInvites">
          <legend>Invitations</legend>
          {invites.map((s) => (
            <div key={s.id} className="tgInvite">
              <span>
                <b>{s.host}</b>
                {s.room ? ` in ${s.room}` : ""}
                {s.title ? `: ${s.title}` : ""}
              </span>
              <button type="button" onClick={() => store.join(s.id)}>
                Join
              </button>
            </div>
          ))}
        </fieldset>
      )}

      <div className="tgField">
        <label htmlFor="tg-with">Watch with:</label>
        <select id="tg-with" value={choice} onChange={(e) => setTarget(e.target.value)} disabled={!online.length && !rooms.length}>
          {!online.length && !rooms.length && <option value="">(no buddies online)</option>}
          {online.map((name) => (
            <option key={name} value={`im:${name}`}>
              {name}
            </option>
          ))}
          {/* a buddy picked in an IM window who isn't online (they'll get a notification) */}
          {target.startsWith("im:") && !online.includes(target.slice(3)) && <option value={target}>{target.slice(3)}</option>}
          {rooms.map((room) => (
            <option key={room} value={`room:${room}`}>
              Chat room: {room}
            </option>
          ))}
        </select>
      </div>

      <div className="tgField">
        <label htmlFor="tg-link">Video:</label>
        <input id="tg-link" type="url" inputMode="url" placeholder="Paste a YouTube link (or add one later)" value={link} onChange={(e) => setLink(e.target.value)} />
      </div>
      {link && !parsed && <div className="tgError">That doesn't look like a YouTube link.</div>}

      <button type="button" className="tgPrimary" disabled={!choice || snap.joining || (!!link && !parsed)} onClick={begin}>
        <TvIcon /> {snap.joining ? "Starting..." : "Start Watching"}
      </button>
      {snap.error && <div className="tgError">{snap.error}</div>}

      <MoreOptions id="together.start" summary="Search YouTube">
        <div className="tgField">
          <label htmlFor="tg-search">Search:</label>
          <input id="tg-search" value={search?.q || ""} onChange={(e) => setSearch({ ...search, q: e.target.value })} onKeyDown={(e) => e.key === "Enter" && runSearch()} />
          <button type="button" onClick={runSearch} disabled={search?.busy}>
            Search
          </button>
        </div>
        {search?.error && <div className="tgError">{search.error}</div>}
        <SearchResults results={search?.results} onPick={(v) => setLink(`https://youtu.be/${v.id}`)} mobile={mobile} />
      </MoreOptions>
    </div>
  )
}

const SearchResults = ({ results, onPick }) =>
  results?.length ? (
    <ul className="tgResults">
      {results.map((v) => (
        <li key={v.id}>
          <button type="button" onClick={() => onPick(v)}>
            {v.thumbnail && <img src={v.thumbnail} alt="" width="64" height="36" loading="lazy" />}
            <span>
              <b>{v.title}</b>
              <small>{v.channelTitle}</small>
            </span>
          </button>
        </li>
      ))}
    </ul>
  ) : null

// ---- the session ----

const SessionView = ({ aim, mobile }) => {
  const snap = store.useTogether()
  const state = snap.state
  const me = keyOf(aim.me?.screenName)
  const control = canControl(state, me)
  const item = current(state)
  const host = useRef(null)
  const player = useRef(null)
  const [ready, setReady] = useState(false)
  const [playerError, setPlayerError] = useState(null)
  const [localPlaying, setLocalPlaying] = useState(false)
  const [needsTap, setNeedsTap] = useState(false)
  const [now, setNow] = useState(0)
  const [say, setSay] = useState("")
  const [link, setLink] = useState("")
  const [note, setNote] = useState(null)
  const [mini, setMini] = useState(false)
  const [scrub, setScrub] = useState(null) // seconds while dragging the seek bar
  const t = useRef({ loaded: null, lastSeek: 0, lastSelf: 0, lastActual: null, lastTick: 0, wasPlaying: false, rate: 1, endedFor: null, wantSince: null })
  const stateRef = useRef(state)
  stateRef.current = state
  const controlRef = useRef(control)
  controlRef.current = control

  // the player, once per session (after "Joining..." has given way to the stage)
  const hasStage = !!state
  useEffect(() => {
    if (!host.current) return
    let alive = true
    let made = null
    setReady(false)
    t.current.loaded = null
    createPlayer(host.current, {
      onReady: () => alive && setReady(true),
      onError: (text) => alive && setPlayerError(text),
      onState: (s) => {
        if (!alive) return
        setLocalPlaying(s === "playing")
        const st = stateRef.current
        const k = t.current
        if (!st || Date.now() - k.lastSelf < SELF_MS) return
        // the person used YouTube's own controls: share it (or undo it without control)
        if (s === "paused" && st.playing && controlRef.current) store.cmd("pause", { pos: made?.time() })
        if (s === "playing" && !st.playing && controlRef.current) store.cmd("play", { pos: made?.time() })
      },
    })
      .then((p) => {
        if (!alive) return p.destroy()
        made = p
        player.current = p
      })
      .catch((error) => alive && setPlayerError(error.message))
    return () => {
      alive = false
      made?.destroy()
      player.current = null
    }
  }, [snap.id, hasStage])

  // steer this player toward the shared state: on every change and once a second
  const apply = () => {
    const p = player.current
    const st = stateRef.current
    const k = t.current
    if (!p || !st) return
    const cur = current(st)
    const self = (fn) => {
      k.lastSelf = Date.now()
      fn()
    }
    if (!cur) {
      if (p.state() === "playing") self(() => p.pause())
      return
    }
    const expected = expectedPos(st, store.serverNow())
    if (k.loaded !== cur.id) {
      k.loaded = cur.id
      k.lastSeek = Date.now()
      k.lastActual = null
      k.endedFor = null
      setPlayerError(null)
      self(() => p.load(cur.v, expected, st.playing))
      return
    }
    if (k.rate !== st.rate) {
      k.rate = st.rate
      p.setRate(st.rate)
    }
    const ps = p.state()
    if (ps === "ended") {
      if (st.playing && k.endedFor !== cur.id) {
        k.endedFor = cur.id
        store.cmd("ended", { index: st.index, pos: p.time() })
      }
      return
    }
    const actual = p.time()
    const at = Date.now()
    const isPlaying = ps === "playing"
    if (controlRef.current && userJumped({ last: k.lastActual, actual, elapsedMs: at - k.lastTick, rate: st.rate, wasPlaying: k.wasPlaying, sinceSeekMs: at - k.lastSeek })) {
      // they scrubbed YouTube's own bar: everyone goes there
      k.lastSeek = at
      store.cmd("seek", { pos: actual })
    } else {
      const d = decide({ expected, actual, shouldPlay: st.playing, isPlaying, buffering: ps === "buffering", sinceSeekMs: at - k.lastSeek })
      if (d.seek != null) {
        k.lastSeek = at
        self(() => p.seek(d.seek))
      }
      if (d.play) self(() => p.play())
      if (d.pause) self(() => p.pause())
    }
    // should be playing but isn't (iPhone wants a tap before a video can start)
    if (st.playing && !isPlaying && ps !== "buffering") {
      k.wantSince ??= at
      setNeedsTap(at - k.wantSince > 2000)
    } else {
      k.wantSince = null
      setNeedsTap(false)
    }
    k.lastActual = p.time()
    k.lastTick = at
    k.wasPlaying = isPlaying
  }

  useEffect(() => {
    if (ready) apply()
  }, [ready, state?.rev, state?.index])

  useEffect(() => {
    const timer = setInterval(() => {
      if (ready) apply()
      setNow(Date.now())
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [ready])

  if (!state) return <div className="tgEmpty">{snap.joining ? "Joining..." : "Connecting..."}</div>

  const position = scrub ?? (player.current && item ? player.current.time() : expectedPos(state, store.serverNow()))
  const duration = player.current?.duration() || 0
  const posOf = () => player.current?.time() ?? expectedPos(state, store.serverNow())
  const togglePlay = () => {
    // inside the tap: an iPhone only starts a video from a tap
    if (!state.playing) {
      t.current.lastSelf = Date.now()
      player.current?.play()
    }
    store.cmd(state.playing ? "pause" : "play", { pos: posOf() }).then((res) => !res?.ok && res?.error && setNote(res.error))
  }
  const add = async () => {
    const parsed = parseYouTube(link)
    if (!parsed) return setNote("Paste a YouTube link.")
    setLink("")
    const res = await store.addVideo(parsed.id, await titleFor(parsed.id))
    setNote(res?.ok ? (state.queue.length ? "Added to Up Next." : null) : res?.error || "Couldn't add it.")
  }
  const send = async () => {
    const text = say.trim()
    if (!text) return
    setSay("")
    const res = await store.say(text)
    if (!res?.ok && res?.error) setNote(res.error)
  }
  const isHost = state.hostKey === me
  const where = state.kind === "room" ? `Chat room: ${state.room}` : peopleLine(state.people)

  return (
    <div className={`tgSession${mini ? " is-mini" : ""}`}>
      <div className="tgTop">
        <TvIcon />
        <span className="tgWho" title={state.people.map((p) => p.name).join(", ")}>
          {where}
        </span>
        <span className="tgHost">{isHost ? "You're the host" : `Host: ${state.host}`}</span>
        <button type="button" className="tgLeave" onClick={() => store.leave()}>
          Leave
        </button>
      </div>

      <div className="tgStage" data-touch-surface>
        <div className="tgPlayer" ref={host} />
        {!item && <div className="tgCover">Nothing playing yet. Add a YouTube link below.</div>}
        {playerError && <div className="tgCover tgCover--error">{playerError}</div>}
        {needsTap && !playerError && (
          <button type="button" className="tgTap" onClick={togglePlay}>
            ▶ Tap to join the video
          </button>
        )}
        <div className="tgFloat" aria-hidden="true">
          {snap.reactions.map((r) => (
            <span key={r.n} className="tgBubble" style={{ left: `${r.x}%` }}>
              {r.emoji}
              <small>{r.from}</small>
            </span>
          ))}
        </div>
      </div>

      <div className="tgNow" title={item?.title}>
        {item ? (
          <>
            <b>{item.title}</b> <small>added by {item.by}</small>
          </>
        ) : (
          " "
        )}
      </div>

      <div className="tgControls">
        <button type="button" aria-label="Previous" disabled={!control || !item} onClick={() => store.cmd("prev")}>
          ⏮
        </button>
        <button type="button" className="tgPlay" aria-label={state.playing ? "Pause" : "Play"} disabled={!control || !item} onClick={togglePlay}>
          {state.playing ? "❚❚" : "▶"}
        </button>
        <button type="button" aria-label="Next" disabled={!control || state.index + 1 >= state.queue.length} onClick={() => store.cmd("next")}>
          ⏭
        </button>
        <input
          type="range"
          className="tgSeek"
          aria-label="Position"
          min="0"
          max={Math.max(1, Math.floor(duration))}
          step="1"
          value={Math.min(Math.floor(position), Math.max(1, Math.floor(duration)))}
          disabled={!control || !item || !duration}
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={() => {
            if (scrub == null) return
            store.cmd("seek", { pos: scrub })
            t.current.lastSeek = 0
            setScrub(null)
          }}
          onKeyUp={() => {
            if (scrub == null) return
            store.cmd("seek", { pos: scrub })
            setScrub(null)
          }}
        />
        <span className="tgTime">
          {clock(position)}
          {duration ? ` / ${clock(duration)}` : ""}
        </span>
      </div>
      {!control && <div className="tgHint">Only {state.host} can control the video.</div>}

      <div className="tgReacts" role="group" aria-label="Reactions">
        {REACTIONS.map((emoji) => (
          <button key={emoji} type="button" onClick={() => store.react(emoji)} aria-label={`React ${emoji}`}>
            {emoji}
          </button>
        ))}
      </div>

      {!mini && (
        <>
          <div className="tgChat" data-selectable="mouse">
            {snap.chat.slice(-4).map((line, i) => (
              <div key={`${line.time}-${i}`}>
                <b className={keyOf(line.from) === me ? "tgMe" : "tgThem"}>{line.from}:</b> {line.text}
              </div>
            ))}
            {!snap.chat.length && <div className="tgHint">Say something while you watch.</div>}
          </div>
          <div className="tgRow">
            <input aria-label="Message" placeholder="Message" value={say} maxLength={200} onChange={(e) => setSay(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
            <button type="button" onClick={send} disabled={!say.trim()}>
              Send
            </button>
          </div>
          <div className="tgRow">
            <input aria-label="YouTube link" type="url" inputMode="url" placeholder="Add a video: paste a YouTube link" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
            <button type="button" onClick={add} disabled={!link.trim()}>
              Add
            </button>
          </div>
        </>
      )}
      {note && (
        <div className="tgNote" role="status" onClick={() => setNote(null)}>
          {note}
        </div>
      )}

      <MoreOptions id="together.session" summary={`Up Next: ${Math.max(0, state.queue.length - state.index - 1)} · ${state.anyone ? "Anyone can control" : "Host controls"}${state.rate !== 1 ? ` · ${state.rate}x` : ""}`}>
        <fieldset className="tgQueue">
          <legend>Up Next</legend>
          {!state.queue.length && <div className="tgHint">Nothing yet.</div>}
          <ol>
            {state.queue.map((q, i) => (
              <li key={q.id} className={i === state.index ? "is-now" : ""}>
                <button type="button" className="tgQTitle" disabled={!control} onClick={() => store.cmd("select", { index: i })} title="Play this">
                  {i === state.index ? "▶ " : ""}
                  {q.title}
                  <small> ({q.by})</small>
                </button>
                <span className="tgQBtns">
                  <button type="button" aria-label="Move up" disabled={!control || i === 0} onClick={() => store.moveItem(q.id, i - 1)}>
                    ▲
                  </button>
                  <button type="button" aria-label="Move down" disabled={!control || i === state.queue.length - 1} onClick={() => store.moveItem(q.id, i + 1)}>
                    ▼
                  </button>
                  <button type="button" aria-label="Remove" disabled={!control} onClick={() => store.removeItem(q.id)}>
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </fieldset>
        <div className="tgField">
          <label htmlFor="tg-rate">Speed:</label>
          <select id="tg-rate" value={String(state.rate)} disabled={!control} onChange={(e) => store.cmd("rate", { rate: Number(e.target.value) })}>
            {RATES.map((r) => (
              <option key={r} value={String(r)}>
                {r === 1 ? "Normal" : `${r}x`}
              </option>
            ))}
          </select>
        </div>
        <label className="tgCheck">
          <input type="checkbox" checked={state.anyone} disabled={!isHost} onChange={(e) => store.setAnyone(e.target.checked)} /> Anyone can control the video{isHost ? "" : " (the host decides)"}
        </label>
        <label className="tgCheck">
          <input type="checkbox" checked={mini} onChange={(e) => setMini(e.target.checked)} /> Mini player (just the video and the buttons)
        </label>
        <div className="tgHint">People: {state.people.map((p) => `${p.name}${p.away ? " (reconnecting)" : ""}`).join(", ")}</div>
        {isHost && (
          <button type="button" onClick={() => store.endForEveryone()}>
            End for Everyone
          </button>
        )}
        {mobile && <div className="tgHint">On iPhone, YouTube stops when 98ish goes to the background or the screen locks. Keep 98ish open to keep watching.</div>}
      </MoreOptions>
    </div>
  )
}

// ---- the window ----

const Together = ({ mobile, handoff, dispatch }) => {
  const aim = useAim()
  const snap = store.useTogether()
  const online = aim?.status === "online"

  // an invitation ("Join" in an IM, a notification) or a start from an IM window/chat room
  useEffect(() => {
    if (!handoff || !online) return
    if (handoff.together) store.join(handoff.together)
    else if (handoff.start === true && (handoff.with || handoff.room)) store.start(handoff.room ? { room: handoff.room } : { with: handoff.with })
  }, [handoff?.id, online])

  if (!aim) return null
  if (!online) {
    return (
      <div className="tg tgStart">
        <div className="tgHero">
          <TvIcon size={32} />
          <div>
            <b>Watch &amp; Listen Together</b>
            <div className="tgHint">Sign on to 98 Messenger to watch YouTube with your buddies.</div>
          </div>
        </div>
        <button type="button" className="tgPrimary" onClick={() => dispatch?.({ type: "open_window", payload: launch("98 Messenger") })}>
          Open 98 Messenger
        </button>
      </div>
    )
  }
  return (
    <div className="tg">
      {snap.ended && !snap.id && (
        <div className="tgNote" role="status" onClick={store.dismissEnded}>
          {snap.ended.reason === "ended" ? "The host ended Watch Together." : snap.ended.reason === "signedoff" ? "You signed off, so you left Watch Together." : "Watch Together ended."} (tap to close)
        </div>
      )}
      {snap.id ? <SessionView aim={aim} mobile={mobile} /> : <StartView aim={aim} handoff={handoff} mobile={mobile} />}
    </div>
  )
}

export default Together
