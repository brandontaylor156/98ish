import { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import PlayOnlineButton from "../../shared/online/PlayOnlineButton"
import { ConnectionPanel } from "../../shared/online/PlayOnline"
import { useServerStatus } from "../../shared/online/useOnlineRoom"
import Dialog from "../../shared/Dialog"
import GameChat, { useGameChatMenuItem } from "../../shared/GameChat"
import { useAim } from "../aim/AimContext"
import { useNet } from "../network/NetContext"
import { launch } from "../../../utils/programs"
import { loadAllPacks } from "./shared/packs.js"
import { quizApi } from "./api"
import { createSounds } from "./audio"
import { setQuizData, statsOf, useQuizData } from "./storage"
import { Loading, Notice, QuizCtx, Screen, usePartner, useQuiz } from "./parts"
import { Heart, ModeIcon } from "./art"
import { LIVE_MODES, LiveRoom, useLive } from "./Live"
import { AsyncSend, ChallengeView, Inbox } from "./Async"
import { AboutUs, CompatScreen, DeepSolo, History, PartyPack } from "./Modes"
import { Builder } from "./Builder"
import "./Quiz.css"

// Lovebirds Quiz Show: game-show quizzes for two (and parties of friends). How Well Do
// You Know Me (live or answer-later), This or That, compatibility quizzes, Deep Talk
// cards, Trivia About Us, a Party Pack of trivia, and a quiz builder. Live games run on
// the network (server/quiz/live.js); quizzes sent to answer later go through
// server/quiz (98 Messenger accounts); scores, streaks and badges are kept here too.

const TILES = [
  { id: "knowme", title: "How Well Do You Know Me?", text: "Answer about yourself, they guess. Soulmate level?", go: { id: "menu", mode: "knowme" }, star: true },
  { id: "tot", title: "This or That", text: "Rapid-fire pairs. Where do you match?", go: { id: "menu", mode: "tot" } },
  { id: "compat", title: "Compatibility", text: "Love notes, date nights, travel styles.", go: { id: "compat" } },
  { id: "deep", title: "Deep Talk Cards", text: "Light to deep conversation starters.", go: { id: "deep" } },
  { id: "aboutus", title: "Trivia About Us", text: "How well do you remember each other?", go: { id: "aboutus" } },
  { id: "party", title: "Party Pack", text: "Trivia for any group of friends.", go: { id: "party" } },
  { id: "builder", title: "Quiz Builder", text: "Write your own and send it.", go: { id: "builder" } },
  { id: "inbox", title: "Inbox", text: "Quizzes for you, and results.", go: { id: "inbox" } },
  { id: "history", title: "History & Badges", text: "Scores, streaks and rosettes.", go: { id: "history" } },
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

const TitleScreen = ({ go, inboxCount }) => {
  const data = useQuizData()
  const { aim, sounds } = useQuiz()
  const partner = usePartner()
  const stats = statsOf(data)
  return (
    <div className="qzTitle">
      <Marquee />
      <p className="qzTagline">
        {partner ? (
          <>
            Tonight's contestants: <b>you</b> and <b>{partner}</b>!
          </>
        ) : (
          "How well do you really know each other?"
        )}
      </p>
      <div className="qzTiles">
        {TILES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`qzTile${t.star ? " is-star" : ""}`}
            data-tile={t.id}
            onClick={() => {
              sounds.tap()
              go(t.go)
            }}
          >
            <ModeIcon mode={t.id} size={t.star ? 40 : 32} />
            <span className="qzTileText">
              <b>{t.title}</b>
              <small>{t.text}</small>
            </span>
            {t.id === "inbox" && inboxCount > 0 && <span className="qzCount">{inboxCount}</span>}
          </button>
        ))}
      </div>
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
      <div className="qzTitleFoot">
        <span>{aim?.status === "online" ? `Signed on as ${aim.me?.screenName}` : "Sign on to 98 Messenger to send quizzes"}</span>
        {stats.streak > 0 && (
          <span className="qzStreak">
            <Heart size={12} /> {stats.streak}-day streak
          </span>
        )}
      </div>
    </div>
  )
}

// Play Live Online: pick a live game, then invite whoever's online (Live.jsx)
const OnlineMenu = ({ back, startLive }) => {
  const server = useServerStatus()
  return (
    <Screen title="Play Live Online" mode="knowme" onBack={back}>
      <p className="qzIntro">Play live with someone who's online right now: you both answer at the same time and reveal together. Pick a game, then invite them.</p>
      {!server.online && <ConnectionPanel server={server} />}
      <div className="qzMenu">
        {Object.entries(LIVE_MODES).map(([mode, info]) => (
          <button key={mode} type="button" className="qzMenuItem" data-live={mode} disabled={!server.online} onClick={() => startLive(mode)}>
            <b>{info.name}</b>
            <small>{info.players}</small>
          </button>
        ))}
      </div>
    </Screen>
  )
}

// How Well Do You Know Me / This or That: live, or answer now and send
const ModeMenu = ({ mode, go, back, startLive }) => {
  const { aim, sounds } = useQuiz()
  const info = {
    knowme: { title: "How Well Do You Know Me?", intro: "One of you answers questions about yourself; the other guesses. Then swap! Match answers to fill the heart." },
    tot: { title: "This or That", intro: "Quick pairs and would-you-rathers. Pick your side, then see where you match." },
  }[mode]
  return (
    <Screen title={info.title} mode={mode} onBack={back}>
      <p className="qzIntro">{info.intro}</p>
      <div className="qzMenu">
        <button type="button" className="qzMenuItem" data-action="live" onClick={() => (sounds.tap(), startLive(mode))}>
          <b>Play live</b>
          <small>Both online now: answer at the same time, reveal together.</small>
        </button>
        <button type="button" className="qzMenuItem" data-action="send" onClick={() => (sounds.tap(), go({ id: "send", kind: mode }))}>
          <b>Answer now, send for later</b>
          <small>They play whenever they like; results wait in your Inbox.{aim?.status !== "online" ? " (Needs 98 Messenger.)" : ""}</small>
        </button>
        <button type="button" className="qzMenuItem" onClick={() => go({ id: "inbox" })}>
          <b>Inbox</b>
          <small>Quizzes waiting for you, and results.</small>
        </button>
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
  const [packs, setPacks] = useState(null)
  const [packError, setPackError] = useState(null)
  const [stack, setStack] = useState([{ id: "title" }])
  const [inboxCount, setInboxCount] = useState(0)
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

  // how many quizzes are waiting for you
  const countInbox = async () => {
    if (!token) return setInboxCount(0)
    const r = await api.inbox()
    if (r.ok) setInboxCount(r.challenges.filter((c) => !c.mine && c.status === "waiting").length)
  }
  useEffect(() => {
    countInbox()
    const socket = net?.socket
    if (!socket) return
    const onNew = ({ from }) => {
      countInbox()
      setToast(`${from} sent you a quiz! It's in your Inbox.`)
      sounds.pop()
    }
    const onDone = ({ by, percent }) => {
      countInbox()
      setToast(`${by} took your quiz: ${percent}%! See your Inbox.`)
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
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  const go = (next) => setStack((s) => (next.id === "title" ? [{ id: "title" }] : [...s, next]))
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
  const home = () => setStack([{ id: "title" }])
  const openMessenger = () => dispatch?.({ type: "open_window", payload: launch("98 Messenger") })
  const startLive = async (mode, options) => {
    if (!net || net.status !== "online") return setToast("Live games need the network, and it isn't answering right now.")
    await live.create(mode, options)
  }

  useEffect(() => {
    const titles = { inbox: "Inbox", builder: "Quiz Builder", history: "History & Badges", compat: "Compatibility", deep: "Deep Talk Cards", party: "Party Pack", aboutus: "Trivia About Us" }
    const part = live.room ? LIVE_MODES[live.room.mode]?.name : titles[screen.id]
    onTitle?.(part ? `Lovebirds Quiz Show - ${part}` : "Lovebirds Quiz Show")
  }, [screen.id, live.room?.mode])

  const value = { aim, net, api, packs, sounds, mobile, dispatch, openMessenger, go, back, live }

  const menus = [
    {
      label: "Game",
      items: [
        { label: "Main Menu", onClick: () => (live.room ? live.leave() : null, home()) },
        { label: "Play Live Online...", disabled: !!live.room, onClick: () => go({ id: "online" }) },
        { label: "Inbox", onClick: () => go({ id: "inbox" }) },
        { label: "History & Badges", onClick: () => go({ id: "history" }) },
        "-",
        { label: "Exit", onClick: () => onClose?.() },
      ],
    },
    {
      label: "Options",
      items: [{ label: "Sound", checked: data.sound, onClick: () => setQuizData({ sound: !data.sound }) }, chatItem],
    },
    { label: "Help", items: [{ label: "About Lovebirds Quiz Show", onClick: () => setAbout(true) }] },
  ]

  let body
  if (packError) body = <Notice kind="is-error">{packError}</Notice>
  else if (!packs) body = <Loading text="Warming up the studio lights..." />
  else if (live.room) body = <LiveRoom live={live} />
  else {
    const props = { onBack: back, go }
    switch (screen.id) {
      case "menu":
        body = <ModeMenu mode={screen.mode} go={go} back={back} startLive={startLive} />
        break
      case "online":
        body = <OnlineMenu back={back} startLive={startLive} />
        break
      case "send":
        body = <AsyncSend key={`${screen.kind}:${screen.preset?.screenName}`} kind={screen.kind} preset={screen.preset} {...props} />
        break
      case "inbox":
        body = <Inbox {...props} />
        break
      case "challenge":
        body = <ChallengeView key={screen.challengeId} challengeId={screen.challengeId} onBack={() => (back(), countInbox())} go={go} />
        break
      case "compat":
        body = <CompatScreen {...props} />
        break
      case "deep":
        body = <DeepSolo {...props} onLive={() => startLive("deep")} />
        break
      case "aboutus":
        body = <AboutUs {...props} />
        break
      case "party":
        body = <PartyPack {...props} onLive={() => startLive("trivia")} />
        break
      case "builder":
        body = <Builder {...props} />
        break
      case "history":
        body = <History {...props} />
        break
      default:
        body = <TitleScreen go={go} inboxCount={inboxCount} />
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
          <button type="button" className="qzToast" onClick={() => (setToast(null), go({ id: "inbox" }))}>
            <Heart size={16} /> {toast}
          </button>
        )}
        {about && (
          <Dialog title="About Lovebirds Quiz Show" onOk={() => setAbout(false)} onCancel={() => setAbout(false)}>
            <p>Lovebirds Quiz Show</p>
            <p>Quizzes for two, and for friends. Play live over the network, or answer now and send it for later through 98 Messenger.</p>
            <p>Every question is original. Have fun getting to know each other!</p>
          </Dialog>
        )}
      </div>
    </QuizCtx.Provider>
  )
}

export default Quiz
