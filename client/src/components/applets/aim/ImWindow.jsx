import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import { BOT_NAME, keyOf, useAim } from "./AimContext"
import { PicturePicker, PictureViewer, ReactionPicker, VoiceBar } from "./history/ImExtras"
import { lastStatus, newestIncoming } from "./history/historyCore"
import Dialog from "../../shared/Dialog"
import ContextMenu from "../../shared/ContextMenu"
import { useNet } from "../network/NetContext"
import { RaceLevelDialog } from "../network/ComputerFolder"
import FormatBar from "./FormatBar"
import MoreOptions from "../../shared/MoreOptions"
import { useDisclosure } from "../../../utils/disclosure"
import { TranscriptLine, textStyle } from "./MessageText"
import { useIsTouch } from "../../../hooks/useMediaQuery"
import { CallButtons } from "./call/CallButtons"

const TYPING_PAUSE_MS = 3000

const typingText = (screenName, typing) =>
  typing === "typing" ? `${screenName} is typing...` : typing === "entered" ? `${screenName} has entered text.` : ""

// Keeps a transcript scrolled to the newest line unless the reader scrolled up
export const useStickToBottom = (deps) => {
  const ref = useRef(null)
  const stuck = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (el && stuck.current) el.scrollTop = el.scrollHeight
  }, deps)
  // the box getting shorter (the phone keyboard coming up, the window resized) keeps the
  // newest line in view instead of leaving it below the fold
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => {
      if (stuck.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const onScroll = () => {
    const el = ref.current
    stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }
  return { ref, onScroll }
}

// Scrolling back: near the top, ask for older messages, and keep the line you were reading
// where it was when they arrive above it
export const useScrollBack = (ref, messages, onOlder) => {
  const anchor = useRef(null)
  const first = messages.find((m) => !m.system)?.id
  useLayoutEffect(() => {
    const el = ref.current
    const a = anchor.current
    if (el && a && a.first !== first) el.scrollTop = el.scrollHeight - a.fromBottom
    anchor.current = null
  }, [first])
  return () => {
    const el = ref.current
    if (!el || el.scrollTop > 60 || !onOlder) return
    anchor.current = { first, fromBottom: el.scrollHeight - el.scrollTop }
    onOlder()
  }
}

// Composer shared by IM windows and chat rooms: Enter sends, Shift+Enter is a new line.
// `onAttach` adds the "+" button (Picture, Voice Message) in IM windows.
export const Composer = ({ onSend, onTypingChange, disabled, autoFocus, onAttach }) => {
  const [format, setFormat] = useDisclosure("messenger.format", false)
  const { prefs } = useAim()
  const touch = useIsTouch()
  const input = useRef(null)

  // Ready to type when you open the window yourself (not on phones: no surprise keyboard)
  useEffect(() => {
    if (autoFocus && !touch) input.current?.focus({ preventScroll: true })
  }, [])
  const [text, setText] = useState("")
  const pause = useRef(null)
  const sentState = useRef("none")

  const report = (state) => {
    if (!onTypingChange || sentState.current === state) return
    sentState.current = state
    onTypingChange(state)
  }

  useEffect(() => () => clearTimeout(pause.current), [])

  const change = (value) => {
    setText(value)
    clearTimeout(pause.current)
    if (!value.trim()) return report("none")
    report("typing")
    pause.current = setTimeout(() => report("entered"), TYPING_PAUSE_MS)
  }

  const send = () => {
    const message = text.trim()
    if (!message || disabled) return
    onSend(message)
    clearTimeout(pause.current)
    setText("")
    report("none")
  }

  return (
    <div className="aimComposer">
      {format && <FormatBar />}
      <div className="aimComposerRow">
        {/* font, size, bold, color: tucked behind "Aa" (docs/simplicity.md), remembered */}
        <button type="button" className={`aimFormatToggle${format ? " is-on" : ""}`} aria-expanded={format} aria-label="Text formatting" title="Font, size and color" onClick={() => setFormat(!format)}>
          Aa
        </button>
        {onAttach && (
          <button
            type="button"
            className="aimAttach"
            aria-label="Send a picture or voice message"
            title="Picture or voice message"
            disabled={disabled}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              onAttach(r.left, r.top)
            }}
          >
            +
          </button>
        )}
        <textarea
          ref={input}
          className="aimInput"
          value={text}
          maxLength={1024}
          style={textStyle(prefs.style)}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          aria-label="Message"
          enterKeyHint="send"
        />
        <button type="button" className="aimSend" onClick={send} disabled={disabled || !text.trim()}>
          Send
        </button>
      </div>
    </div>
  )
}

const ImWindow = ({ buddy, focusInput }) => {
  const aim = useAim()
  const key = keyOf(buddy)
  const convo = aim.convos[key]
  const presence = aim.presence[key]
  const screenName = presence?.screenName || convo?.screenName || buddy
  const messages = convo?.messages || []
  const blocked = aim.me?.blocked.includes(key)
  const inList = aim.me?.groups.some((g) => g.buddies.some((b) => keyOf(b) === key))
  const [dialog, setDialog] = useState(null)
  const [gamesMenu, setGamesMenu] = useState(null)
  const [attachMenu, setAttachMenu] = useState(null)
  const [voice, setVoice] = useState(false)
  const [picker, setPicker] = useState(null) // reactions: { message, x, y }
  const [viewing, setViewing] = useState(null)
  const touch = useIsTouch()
  const net = useNet()
  const isBot = key === keyOf(BOT_NAME)
  const transcript = useStickToBottom([messages.length, messages.at(-1)?.id])
  const scrollBack = useScrollBack(transcript.ref, messages, convo?.older !== false ? () => aim.loadOlder(key) : null)
  const lastIncoming = [...messages].reverse().find((m) => !m.mine && !m.system)

  // this device's saved copy of the conversation, when the window opens
  useEffect(() => {
    if (aim.status === "online") aim.loadConvo(screenName)
  }, [key, aim.status])

  // "Read": this window is in front (and the page is), so the newest message from them is seen
  const front = (aim.windows || []).some((w) => !w.closed && w.active && !w.minimized && w.aimId === `im:${key}`)
  const [pageSeen, setPageSeen] = useState(() => document.visibilityState === "visible" && document.hasFocus())
  useEffect(() => {
    const check = () => setPageSeen(document.visibilityState === "visible" && document.hasFocus())
    const events = ["focus", "blur", "visibilitychange", "pageshow"]
    events.forEach((e) => window.addEventListener(e, check))
    document.addEventListener("visibilitychange", check)
    return () => {
      events.forEach((e) => window.removeEventListener(e, check))
      document.removeEventListener("visibilitychange", check)
    }
  }, [])
  const incoming = newestIncoming(messages)
  useEffect(() => {
    if (front && pageSeen && incoming && !isBot) aim.markRead(key, incoming.time)
  }, [front, pageSeen, incoming?.id])
  const receipt = lastStatus(messages, aim.me?.prefs?.receipts === false ? null : aim.reads?.[key], { name: screenName })

  const react = (message, emoji) => aim.react(key, message, emoji)
  const openMenu = React.useCallback((message, x, y) => setPicker({ message, x, y }), [])
  const toggleReaction = React.useCallback((message, emoji) => aim.react(key, message, emoji), [key, aim.react])
  // "Join" on a Watch Together invitation
  const onAction = React.useCallback(
    (action) => (action.kind === "together" ? aim.openTogether({ together: action.id }) : action.kind === "vb98" ? aim.openVbApp(action.id) : action.kind === "model" && aim.openModel(key, action.message)),
    [aim.openTogether, aim.openVbApp, aim.openModel, key]
  )
  const meKey = keyOf(aim.me?.screenName)
  const status =
    typingText(screenName, convo?.typing) ||
    (presence?.online && presence.away ? `${screenName} is away.` : "") ||
    (!presence?.online ? `${screenName} is not signed on.` : "") ||
    (lastIncoming ? `Last message received at ${new Date(lastIncoming.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "")

  if (!aim.me) return null

  const warn = async (anonymous) => {
    const result = await aim.warn(screenName, anonymous)
    setDialog({
      kind: "alert",
      title: "Warn",
      text: result.ok ? `${screenName}'s warning level is now ${result.warning}%.` : result.error,
    })
  }

  const toggleBlock = async () => {
    const result = await aim.block(screenName, !blocked)
    setDialog(result.ok ? null : { kind: "alert", title: "Block", text: result.error })
  }

  // Network games, played with whoever is on the other end of this IM
  const playGame = async (game, options) => {
    const result = await net.invite({ screenName }, game, options)
    if (!result.ok) setDialog({ kind: "alert", title: "Games", text: result.error })
  }
  const gameItems = [
    { label: "Checkers", onClick: () => playGame("checkers") },
    { label: "Minesweeper Race...", onClick: () => setDialog({ kind: "race" }) },
    { label: "Hearts", onClick: () => playGame("hearts") },
    { label: "Reversi", onClick: () => playGame("reversi") },
    { label: "Chess", onClick: () => playGame("chess") },
    { label: "Battleship", onClick: () => playGame("battleship") },
    { label: "Tetris Battle", onClick: () => playGame("tetris") },
    { label: "Doodle Together", onClick: () => playGame("doodle") },
    { label: "Quiz Show", onClick: () => playGame("quiz") },
    { label: "Sunny Acres Co-op", onClick: () => playGame("town") },
  ].sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" })) // A to Z

  const addBuddy = async () => {
    const [first, ...rest] = aim.me.groups
    if (!first) return
    await aim.saveGroups([{ ...first, buddies: [...first.buddies, screenName] }, ...rest])
  }

  return (
    <div className="aimIm">
      <div className="aimImHeader">
        <span className="aimImTo">
          To: <b>{screenName}</b>
        </span>
        {key !== keyOf(BOT_NAME) && (
          <CallButtons
            screenName={screenName}
            disabled={!presence?.online || blocked}
            onError={(text) => setDialog({ kind: "alert", title: "Call", text })}
          />
        )}
        {key !== keyOf(BOT_NAME) && (
          <button type="button" className="callStart aimWatch" disabled={blocked} onClick={() => aim.openTogether({ with: screenName, start: true })} title={`Watch YouTube together with ${screenName}`}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="1" y="3" width="14" height="10" fill="#000080" stroke="#000" />
              <rect x="2.5" y="4.5" width="11" height="7" fill="#7fd0ff" />
              <path d="M7 6.2 L10.2 8 L7 9.8 Z" fill="#fff" />
              <path d="M5 1 L8 3 L11 1" stroke="#000" fill="none" />
            </svg>
            <span>Watch</span>
          </button>
        )}
        <span className="aimImWarning">Warning Level: {presence?.warning || 0}%</span>
      </div>

      <div
        className="aimTranscript"
        data-selectable="mouse"
        ref={transcript.ref}
        onScroll={() => {
          transcript.onScroll()
          scrollBack()
        }}
      >
        {convo?.loadingOlder && <div className="aimSystem">Loading older messages...</div>}
        {messages.map((message) => (
          <TranscriptLine key={message.id} message={message} me={aim.me.screenName} meKey={meKey} onMenu={isBot ? undefined : openMenu} onReact={toggleReaction} getBlob={aim.getMediaBlob} onOpenPicture={setViewing} onAction={onAction} />
        ))}
        {receipt && (
          <div className={`aimReceipt aimReceipt--${receipt.kind}`} role="status">
            {receipt.text}
          </div>
        )}
      </div>

      {voice ? (
        <VoiceBar
          onClose={() => setVoice(false)}
          onSend={(rec) => {
            setVoice(false)
            aim.sendMedia(screenName, { kind: "audio", blob: rec.blob, d: rec.d, wf: rec.wf })
          }}
        />
      ) : (
        <Composer
          autoFocus={focusInput}
          disabled={blocked}
          onSend={(text) => aim.sendIm(screenName, text)}
          onTypingChange={(state) => key !== keyOf(BOT_NAME) && aim.typing(screenName, state)}
          onAttach={isBot ? undefined : (x, y) => setAttachMenu({ x, y })}
        />
      )}

      {attachMenu && (
        <ContextMenu
          x={attachMenu.x}
          y={attachMenu.y}
          items={[
            { label: "Picture...", onClick: () => setDialog({ kind: "picture" }) },
            { label: "Voice Message", onClick: () => setVoice(true) },
          ]}
          onClose={() => setAttachMenu(null)}
        />
      )}
      {dialog?.kind === "picture" && (
        <PicturePicker
          touch={touch}
          onCancel={() => setDialog(null)}
          onPick={(pic) => {
            setDialog(null)
            aim.sendMedia(screenName, { kind: "image", blob: pic.blob, thumb: pic.thumb, w: pic.width, h: pic.height })
          }}
        />
      )}
      {picker && (
        <ReactionPicker
          x={picker.x}
          y={picker.y}
          current={picker.message.r?.[meKey]}
          text={picker.message.text}
          onPick={(emoji) => react(picker.message, emoji)}
          onClose={() => setPicker(null)}
        />
      )}
      {viewing && <PictureViewer message={viewing} getBlob={aim.getMediaBlob} onClose={() => setViewing(null)} />}

      {/* Warn, Block, Add Buddy, Get Info, Games: under More (docs/simplicity.md) */}
      <MoreOptions id="messenger.im" label="More" lessLabel="Less" inline className="aimImMore">
        <div className="aimImButtons">
          <button type="button" onClick={() => setDialog({ kind: "warn", anonymous: false })} disabled={!presence?.online}>
            Warn
          </button>
          <button type="button" onClick={() => (blocked ? toggleBlock() : setDialog({ kind: "block" }))} disabled={key === keyOf(BOT_NAME)}>
            {blocked ? "Unblock" : "Block"}
          </button>
          <button type="button" onClick={addBuddy} disabled={inList}>
            Add Buddy
          </button>
          <button type="button" onClick={() => aim.openInfo(screenName)}>
            Get Info
          </button>
          <button type="button" onClick={() => setDialog({ kind: "clear" })} disabled={!messages.some((m) => !m.system)}>
            Clear History
          </button>
          {net && key !== keyOf(BOT_NAME) && (
            <button
              type="button"
              disabled={!presence?.online || blocked}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setGamesMenu({ x: r.left, y: r.bottom })
              }}
            >
              Games
            </button>
          )}
        </div>
      </MoreOptions>

      {gamesMenu && <ContextMenu x={gamesMenu.x} y={gamesMenu.y} items={gameItems} onClose={() => setGamesMenu(null)} />}

      <div className="status-bar aimStatusBar" data-kb-status="keep">
        <p className="status-bar-field">{blocked ? `You have blocked ${screenName}.` : status || " "}</p>
      </div>

      {dialog?.kind === "warn" && (
        <Dialog title="Warn" okLabel="Warn" onOk={() => warn(dialog.anonymous)} onCancel={() => setDialog(null)}>
          <p className="dialogText">
            Are you sure you want to warn {screenName}? Warnings slow down how fast someone can send messages.
          </p>
          <label className="aimCheck">
            <input type="checkbox" checked={dialog.anonymous} onChange={(e) => setDialog({ ...dialog, anonymous: e.target.checked })} />
            <span>Warn anonymously</span>
          </label>
        </Dialog>
      )}

      {dialog?.kind === "clear" && (
        <Dialog
          title="Clear History"
          okLabel="Clear"
          onOk={() => {
            setDialog(null)
            aim.clearHistory(key)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">
            Clear your conversation with {screenName}? It's deleted from this device and from your copy saved on the 98ish server, so your other devices won't show it either. {isBot ? "" : `${screenName} keeps their own copy.`}
          </p>
        </Dialog>
      )}

      {dialog?.kind === "block" && (
        <Dialog title="Block" okLabel="Block" onOk={toggleBlock} onCancel={() => setDialog(null)}>
          <p className="dialogText">
            Block {screenName}? They won't be able to send you messages or see when you're online.
          </p>
        </Dialog>
      )}

      {dialog?.kind === "race" && (
        <RaceLevelDialog
          onPick={(level) => {
            setDialog(null)
            playGame("race", { level })
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "alert" && (
        <Dialog title={dialog.title} onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
    </div>
  )
}

export default ImWindow
