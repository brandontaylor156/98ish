import { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import PlayOnlineButton from "../../shared/online/PlayOnlineButton"
import { ConnectionPanel } from "../../shared/online/PlayOnline"
import { useServerStatus } from "../../shared/online/useOnlineRoom"
import Dialog from "../../shared/Dialog"
import MoreOptions from "../../shared/MoreOptions"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import { useAim } from "../aim/AimContext"
import { useNet } from "../network/NetContext"
import { launch } from "../../../utils/programs"
import { loadAllPacks } from "./shared/packs.js"
import { quizApi } from "./api"
import { createSounds } from "./audio"
import { setQuizData, statsOf, useQuizData } from "./storage"
import { Loading, Notice, QuizCtx, Screen, usePartnerInfo, useQuiz } from "./parts"
import { Heart, ModeIcon } from "./art"
import { Host } from "./Host"
import { HowTo } from "./HowTo"
import { LIVE_MODES, LiveRoom, useLive } from "./Live"
import { AsyncSend, ChallengeView, Inbox } from "./Async"
import { AboutUs, CompatScreen, DeepSolo, History, PartyPack } from "./Modes"
import { Builder } from "./Builder"
import { Setup } from "./Setup"
import { PassPlay } from "./PassPlay"
import { hostLine } from "./shared/show.js"
import "./Quiz.css"
import "./Show.css"
import { helpItem } from "../../../utils/help"

// Lovebirds Quiz Show: a TV game show for two (and parties of friends), hosted by Lulu the
// lovebird. The studio's four games: How Well Do You Know Me? and This or That (shows with
// rounds, double points, a lightning round and a final bet; played live on two screens,
// passing one phone, or taking turns), Deep Talk cards and Party Trivia. Plus
// compatibility quizzes, Trivia About Us, a quiz builder, an Inbox and your history.
// Live games run on the network (server/quiz/live.js); taken-turns quizzes go through
// server/quiz (98 Messenger accounts).

const SHOWS = [
  { id: "knowme", title: "How Well Do You Know Me?", text: "One of you answers secretly, the other guesses. Then swap!", tag: "The main event", go: { id: "setup", mode: "knowme" } },
  { id: "tot", title: "This or That", text: "Quick picks, both at once. Same side? You both score.", tag: "Fast & silly", go: { id: "setup", mode: "tot" } },
  { id: "deep", title: "Deep Talk Cards", text: "Conversation cards, light to deep. No points, just talking.", tag: "Cozy", go: { id: "deep" } },
  { id: "party", title: "Party Trivia", text: "Classic trivia. Fast right answers score the most.", tag: "Friends welcome", go: { id: "party" } },
]
const MORE = [
  { id: "compat", title: "Compatibility", go: { id: "compat" } },
  { id: "aboutus", title: "Trivia About Us", go: { id: "aboutus" } },
  { id: "builder", title: "Quiz Builder", go: { id: "builder" } },
]

const Marquee = () => (
  <div className="qzMarquee">
    <div className="qzBulbs" aria-hidden="true">
      {Array.from({ length: 22 }, (_, i) => (
        <i key={i} style={{ "--i": i }} />
      ))}
    </div>
    <div className="qzMarqueeText">
      <span className="qzMarqueeSmall">
        <Heart size={14} /> live from your desktop <Heart size={14} />
      </span>
      <span className="qzMarqueeBig">LOVEBIRDS</span>
      <span className="qzMarqueeSub">QUIZ SHOW</span>
    </div>
  </div>
)

// The studio: Lulu, the four games, and what's waiting for you
const Home = ({ go, inbox }) => {
  const data = useQuizData()
  const { aim, sounds } = useQuiz()
  const { partner, online } = usePartnerInfo()
  const stats = statsOf(data)
  const [n] = useState(() => Math.floor(Math.random() * 4))
  const waiting = inbox.filter((c) => !c.mine && c.status === "waiting")
  const results = inbox.filter((c) => c.mine && c.status === "done" && !data.seenResults.includes(c.id))
  const line = waiting.length
    ? `Psst! ${waiting[0].from} played their turn. Now it's yours!`
    : results.length
      ? `${results[0].to} played your quiz! The reveal is waiting in your Inbox.`
      : partner && online
        ? `${partner} is online! Perfect time for a live show.`
        : partner
          ? `Tonight's contestants: you and ${partner}! Pick a game.`
          : hostLine("welcome", n)
  const last = data.history.find((h) => h.headline)
  const showCard = (s) => (
    <button
      key={s.id}
      type="button"
      className={`qzShowCard is-${s.id}${s.id === SHOWS[0].id ? " is-star" : ""}`}
      data-tile={s.id}
      onClick={() => {
        sounds.tap()
        go(s.go)
      }}
    >
      <span className="qzShowIcon">
        <ModeIcon mode={s.id} size={s.id === SHOWS[0].id ? 44 : 34} />
      </span>
      <span className="qzShowText">
        <small className="qzShowTag">{s.tag}</small>
        <b>{s.title}</b>
        <span>{s.text}</span>
      </span>
    </button>
  )
  return (
    <div className="qzHome">
      <Marquee />
      <Host line={line} size="big" />
      {waiting.length > 0 && (
        <button type="button" className="qzTurn" data-action="your-turn" onClick={() => (sounds.tap(), go(waiting.length === 1 ? { id: "challenge", challengeId: waiting[0].id } : { id: "inbox" }))}>
          <span className="qzTurnBadge">Your turn!</span>
          <span>
            <b>{waiting[0].from}</b> sent you {waiting[0].title || waiting[0].kindName}
            {waiting.length > 1 ? ` (+${waiting.length - 1} more)` : ""}
          </span>
          <span aria-hidden="true">&#9654;&#xFE0E;</span>
        </button>
      )}
      {/* the launcher pattern (docs/simplicity.md): the main event and Play Live Online; the other
          games, the extras and Past shows under "More games »" (remembered) */}
      <div className="qzShows">{SHOWS.slice(0, 1).map(showCard)}</div>
      <div className="qzOnline">
        <PlayOnlineButton
          label="Play Live Online"
          sub="Answer together in real time with someone online now"
          onClick={() => {
            sounds.tap()
            go({ id: "online" })
          }}
        />
      </div>
      <div className="qzHomeFoot">
        <button type="button" className="qzFootBtn" data-tile="inbox" onClick={() => go({ id: "inbox" })}>
          <ModeIcon mode="inbox" size={20} /> Inbox
          {waiting.length + results.length > 0 && <span className="qzCount">{waiting.length + results.length}</span>}
        </button>
        {stats.streak > 0 && (
          <span className="qzStreak">
            <Heart size={12} /> {stats.streak}-day streak
          </span>
        )}
      </div>
      <MoreOptions id="quiz.modes" className="qzMoreGames" label="More games" lessLabel="Fewer games" summary={[...SHOWS.slice(1), ...MORE].map((m) => m.title).concat("Past shows").join(" · ")}>
        <div className="qzShows">{SHOWS.slice(1).map(showCard)}</div>
        <div className="qzMoreRow">
          <span className="qzMoreLabel">More fun:</span>
          {MORE.map((m) => (
            <button key={m.id} type="button" className="qzMore" data-tile={m.id} onClick={() => (sounds.tap(), go(m.go))}>
              <ModeIcon mode={m.id} size={18} /> {m.title}
            </button>
          ))}
          <button type="button" className="qzMore" data-tile="history" onClick={() => go({ id: "history" })}>
            <ModeIcon mode="history" size={18} /> Past shows
          </button>
        </div>
      </MoreOptions>
      <p className="qzHomeNote">
        {last ? `Last show: ${last.headline}` : aim?.status === "online" ? `Signed on as ${aim.me?.screenName}` : "Tip: sign on to 98 Messenger to play live or take turns."}
      </p>
    </div>
  )
}

// Play Live Online: pick a live game, then invite whoever's online (Live.jsx)
const OnlineMenu = ({ back, go, startLive }) => {
  const server = useServerStatus()
  return (
    <Screen title="Play Live Online" mode="knowme" onBack={back}>
      <p className="qzIntro">Play live with someone who's online right now: you both answer at the same time and reveal together. Pick a game, then invite them.</p>
      {!server.online && <ConnectionPanel server={server} />}
      <div className="qzMenu">
        {Object.entries(LIVE_MODES).map(([mode, info]) => (
          <button key={mode} type="button" className="qzMenuItem" data-live={mode} disabled={!server.online} onClick={() => (mode === "knowme" || mode === "tot" ? go({ id: "setup", mode }) : startLive(mode))}>
            <b>{info.name}</b>
            <small>{info.players}</small>
          </button>
        ))}
      </div>
    </Screen>
  )
}

const Quiz = ({ mobile, dispatch, onClose, onTitle }) => {
  const aim = useAim()
  const net = useNet()
  const data = useQuizData()
  const chatItem = useGameChatMenuItem("quiz")
  const soundsRef = useRef(null)
  if (!soundsRef.current) soundsRef.current = createSounds()
  const sounds = soundsRef.current
  const { partner } = usePartnerInfo()
  const partnerRef = useRef(partner)
  partnerRef.current = partner
  const [packs, setPacks] = useState(null)
  const [packError, setPackError] = useState(null)
  const [stack, setStack] = useState([{ id: "title" }])
  const [inbox, setInbox] = useState([])
  const [toast, setToast] = useState(null)
  const [about, setAbout] = useState(false)
  const live = useLive(net)
  const token = aim?.token || null
  const api = useMemo(() => quizApi(token), [token])
  const screen = stack[stack.length - 1]

  useEffect(() => {
    loadAllPacks().then(setPacks, () => setPackError("The questions didn't load. Check your connection and try again."))
    return () => sounds.close()
  }, [])
  useEffect(() => {
    sounds.setEnabled(data.sound)
  }, [data.sound])

  // closing the window leaves a live game
  const leaveRef = useRef(live.leave)
  leaveRef.current = live.leave
  useEffect(() => () => leaveRef.current(), [])

  // what's waiting in the Inbox (your turns, and results)
  const loadInbox = async () => {
    if (!token) return setInbox([])
    const r = await api.inbox()
    if (r.ok) setInbox(r.challenges)
  }
  useEffect(() => {
    loadInbox()
    const socket = net?.socket
    if (!socket) return
    // (your partner's turns get a desktop toast from Us already; the home screen shows them too)
    const onNew = ({ from }) => {
      loadInbox()
      if (from === partnerRef.current) return
      setToast(`${from} played their turn. Now it's yours!`)
      sounds.pop()
    }
    const onDone = ({ by, percent }) => {
      loadInbox()
      if (by === partnerRef.current) return
      setToast(`${by} played your quiz: ${percent}% matched! See the reveal.`)
      sounds.pop()
    }
    socket.on("quiz:new", onNew)
    socket.on("quiz:done", onDone)
    return () => {
      socket.off("quiz:new", onNew)
      socket.off("quiz:done", onDone)
    }
  }, [token])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  const go = (next) => setStack((s) => (next.id === "title" ? [{ id: "title" }] : [...s, next]))
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
  const home = () => setStack([{ id: "title" }])
  const openMessenger = () => dispatch?.({ type: "open_window", payload: launch("98 Messenger") })
  const startLive = async (mode, options) => {
    if (!net || net.status !== "online") return setToast("Live games need the network, and it isn't answering right now.")
    return live.create(mode, options)
  }
  // a show, live: open the studio and invite your partner straight away
  const startShowLive = async (mode, options) => {
    const r = await startLive(mode, options)
    if (r?.ok && partner) await live.invite({ screenName: partner }, r.roomId)
  }

  // a toast elsewhere on the desktop asked to show something ("your turn!")
  useEffect(() => {
    const onView = (e) => {
      if (e.detail?.program !== "Lovebirds Quiz Show" || live.room) return
      if (e.detail.challengeId) go({ id: "challenge", challengeId: e.detail.challengeId })
      else if (e.detail.view === "inbox") go({ id: "inbox" })
    }
    window.addEventListener("98ish:couple-view", onView)
    return () => window.removeEventListener("98ish:couple-view", onView)
  }, [live.room])

  useEffect(() => {
    const titles = { inbox: "Inbox", builder: "Quiz Builder", history: "Past Shows", compat: "Compatibility", deep: "Deep Talk Cards", party: "Party Trivia", aboutus: "Trivia About Us", setup: LIVE_MODES[screen.mode]?.name, pass: LIVE_MODES[screen.mode]?.name }
    const part = live.room ? LIVE_MODES[live.room.mode]?.name : titles[screen.id]
    onTitle?.(part ? `Lovebirds Quiz Show - ${part}` : "Lovebirds Quiz Show")
  }, [screen.id, live.room?.mode])

  const value = { aim, net, api, packs, sounds, mobile, dispatch, openMessenger, go, back, home, live }

  const menus = [
    {
      label: "Game",
      items: [
        { label: "Main Menu", onClick: () => (live.room ? live.leave() : null, home()) },
        { label: "Play Live Online...", disabled: !!live.room, onClick: () => go({ id: "online" }) },
        { label: "Inbox", onClick: () => go({ id: "inbox" }) },
        { label: "Past Shows & Badges", onClick: () => go({ id: "history" }) },
        "-",
        { label: "Exit", onClick: () => onClose?.() },
      ],
    },
    {
      label: "Options",
      items: [{ label: "Sound", checked: data.sound, onClick: () => setQuizData({ sound: !data.sound }) }, chatItem],
    },
    {
      label: "Help",
      items: [helpItem({ program: "Lovebirds Quiz Show" }), "-",
        { label: "How to Play: Know Me", onClick: () => go({ id: "howto", mode: "knowme" }) },
        { label: "How to Play: This or That", onClick: () => go({ id: "howto", mode: "tot" }) },
        "-",
        { label: "About Lovebirds Quiz Show", onClick: () => setAbout(true) },
      ],
    },
  ]

  let body
  if (packError) body = <Notice kind="is-error">{packError}</Notice>
  else if (!packs) body = <Loading text="Warming up the studio lights..." />
  else if (live.room) body = <LiveRoom live={live} />
  else {
    const props = { onBack: back, go }
    switch (screen.id) {
      case "setup":
        body = (
          <Setup
            key={screen.mode}
            mode={screen.mode}
            onBack={back}
            onLive={(options) => startShowLive(screen.mode, options)}
            onPass={(options) => go({ id: "pass", mode: screen.mode, options })}
            onTurns={(options) => go({ id: "send", kind: screen.mode, preset: partner ? { screenName: partner } : null, options })}
          />
        )
        break
      case "pass":
        body = <PassPlay key={`${screen.mode}:${stack.length}`} mode={screen.mode} options={screen.options} initialNames={[aim?.me?.screenName || "Player 1", partner || "Player 2"]} onHome={home} />
        break
      case "howto":
        body = <HowTo mode={screen.mode} onDone={back} />
        break
      case "online":
        body = <OnlineMenu back={back} go={go} startLive={startLive} />
        break
      case "send":
        body = <AsyncSend key={`${screen.kind}:${screen.preset?.screenName}`} kind={screen.kind} preset={screen.preset} options={screen.options} {...props} />
        break
      case "inbox":
        body = <Inbox {...props} />
        break
      case "challenge":
        body = <ChallengeView key={screen.challengeId} challengeId={screen.challengeId} onBack={() => (back(), loadInbox())} go={go} />
        break
      case "compat":
        body = <CompatScreen {...props} />
        break
      case "deep":
        body = (
          <>
            <DeepSolo {...props} onLive={() => startLive("deep")} />
            {!data.howto?.deep && <HowTo mode="deep" onDone={() => {}} />}
          </>
        )
        break
      case "aboutus":
        body = <AboutUs {...props} />
        break
      case "party":
        body = (
          <>
            <PartyPack {...props} onLive={() => startLive("trivia")} />
            {!data.howto?.trivia && <HowTo mode="trivia" onDone={() => {}} />}
          </>
        )
        break
      case "builder":
        body = <Builder {...props} />
        break
      case "history":
        body = <History {...props} />
        break
      default:
        body = <Home go={go} inbox={inbox} />
    }
  }

  return (
    <QuizCtx.Provider value={value}>
      <div className={`qzRoot${mobile ? " is-mobile" : ""}`}>
        <MenuBar menus={menus} />
        <GameChat game="quiz" title="Quiz Show" room={live.room && live.room.players.length > 1 ? `match:${live.room.id}` : undefined} />
        <div className="qzMain">
          {body}
          {live.error && !live.room && <Notice kind="is-error">{live.error}</Notice>}
        </div>
        {toast && (
          <button type="button" className="qzToast" onClick={() => (setToast(null), live.room ? null : go({ id: "inbox" }))}>
            <Heart size={16} /> {toast}
          </button>
        )}
        {about && (
          <Dialog title="About Lovebirds Quiz Show" onOk={() => setAbout(false)} onCancel={() => setAbout(false)}>
            <p>Lovebirds Quiz Show, hosted by Lulu the lovebird.</p>
            <p>Play live on two screens, pass one phone around, or take turns through 98 Messenger. Finish shows to unlock new question packs!</p>
            <p>Every question is original. Have fun getting to know each other!</p>
          </Dialog>
        )}
      </div>
    </QuizCtx.Provider>
  )
}

export default Quiz
