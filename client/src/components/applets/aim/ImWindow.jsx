import React, { useEffect, useRef, useState } from "react"
import { BOT_NAME, keyOf, useAim } from "./AimContext"
import Dialog from "../../shared/Dialog"
import ContextMenu from "../../shared/ContextMenu"
import { useNet } from "../network/NetContext"
import { RaceLevelDialog } from "../network/ComputerFolder"
import FormatBar from "./FormatBar"
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

// Composer shared by IM windows and chat rooms: Enter sends, Shift+Enter is a new line
export const Composer = ({ onSend, onTypingChange, disabled, autoFocus }) => {
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
      <FormatBar />
      <div className="aimComposerRow">
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
  const net = useNet()
  const transcript = useStickToBottom([messages.length])
  const lastIncoming = [...messages].reverse().find((m) => !m.mine && !m.system)
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
  ]

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
        <span className="aimImWarning">Warning Level: {presence?.warning || 0}%</span>
      </div>

      <div className="aimTranscript" ref={transcript.ref} onScroll={transcript.onScroll}>
        {messages.map((message, i) => (
          <TranscriptLine key={i} message={message} me={aim.me.screenName} />
        ))}
      </div>

      <Composer
        autoFocus={focusInput}
        disabled={blocked}
        onSend={(text) => aim.sendIm(screenName, text)}
        onTypingChange={(state) => key !== keyOf(BOT_NAME) && aim.typing(screenName, state)}
      />

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
