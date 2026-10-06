import React, { useCallback, useState } from "react"
import { keyOf, useAim } from "./AimContext"
import { useOpenGesture } from "../../../hooks/useMediaQuery"
import Dialog from "../../shared/Dialog"
import { Composer, useScrollBack, useStickToBottom } from "./ImWindow"
import { TranscriptLine } from "./MessageText"
import { ReactionPicker } from "./history/ImExtras"

// A Buddy Chat room: transcript (saved like IMs, for the people who were there), who's here,
// and a box to talk in. Right-click or hold a line to react.
const ChatRoom = ({ room }) => {
  const aim = useAim()
  const openGesture = useOpenGesture()
  const current = aim.rooms[keyOf(room)]
  const messages = current?.messages || []
  const members = current?.members || []
  const ck = `#${keyOf(room)}`
  const [dialog, setDialog] = useState(null)
  const [picker, setPicker] = useState(null)
  const transcript = useStickToBottom([messages.length, messages.at(-1)?.id])
  const scrollBack = useScrollBack(transcript.ref, messages, current?.older !== false ? () => aim.loadOlder(ck) : null)
  const meKey = keyOf(aim.me?.screenName)
  const openMenu = useCallback((message, x, y) => setPicker({ message, x, y }), [])
  const toggle = useCallback((message, emoji) => aim.react(ck, message, emoji), [ck, aim.react])
  // "Join" on a Watch Together invitation
  const onAction = useCallback((action) => action.kind === "together" && aim.openTogether({ together: action.id }), [aim.openTogether])

  if (!aim.me) return null

  const invite = async () => {
    const names = dialog.to.split(",").map((s) => s.trim()).filter(Boolean)
    const result = await aim.invite(current?.name || room, names, dialog.message)
    setDialog({
      kind: "alert",
      text: !result.ok
        ? result.error
        : result.invited.length
          ? `Invitation sent to ${result.invited.join(", ")}.`
          : "None of those buddies are signed on right now.",
    })
  }

  return (
    <div className="aimChat">
      <div className="aimChatMain">
        <div
          className="aimTranscript"
          data-selectable="mouse"
          ref={transcript.ref}
          onScroll={() => {
            transcript.onScroll()
            scrollBack()
          }}
        >
          {current?.loadingOlder && <div className="aimSystem">Loading older messages...</div>}
          {messages.map((message) => (
            <TranscriptLine
              key={message.id}
              message={message.system ? message : { ...message, mine: keyOf(message.from) === meKey }}
              me={aim.me.screenName}
              meKey={meKey}
              onMenu={openMenu}
              onReact={toggle}
              getBlob={aim.getMediaBlob}
              onAction={onAction}
            />
          ))}
        </div>
        <Composer
          autoFocus
          disabled={!current}
          onSend={async (text) => {
            const result = await aim.say(current.name, text)
            if (!result.ok && result.error) setDialog({ kind: "alert", text: result.error })
          }}
        />
      </div>
      <aside className="aimChatSide">
        <div className="aimChatCount">{members.length} {members.length === 1 ? "person" : "people"} here</div>
        <ul className="tree-view aimChatMembers">
          {members.map((name) => (
            <li key={name} {...(name !== aim.me.screenName ? openGesture(() => aim.openIm(name)) : {})}>
              {name}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setDialog({ kind: "invite", to: "", message: `Join me in ${current?.name || room}!` })}>
          Invite...
        </button>
        <button type="button" className="aimWatch" disabled={!current} onClick={() => aim.openTogether({ room: current?.name || room, start: true })}>
          Watch Together
        </button>
        <button type="button" onClick={() => setDialog({ kind: "clear" })} disabled={!messages.some((m) => !m.system)}>
          Clear History
        </button>
      </aside>

      {picker && <ReactionPicker x={picker.x} y={picker.y} current={picker.message.r?.[meKey]} text={picker.message.text} onPick={(emoji) => aim.react(ck, picker.message, emoji)} onClose={() => setPicker(null)} />}

      {dialog?.kind === "invite" && (
        <Dialog title="Buddy Chat Invitation" okLabel="Send" okDisabled={!dialog.to.trim()} onOk={invite} onCancel={() => setDialog(null)}>
          <label className="dialogLabel">Screen names to invite (separate with commas):</label>
          <input value={dialog.to} onChange={(e) => setDialog({ ...dialog, to: e.target.value })} />
          <label className="dialogLabel">Invitation message:</label>
          <input value={dialog.message} maxLength={256} onChange={(e) => setDialog({ ...dialog, message: e.target.value })} />
        </Dialog>
      )}
      {dialog?.kind === "clear" && (
        <Dialog
          title="Clear History"
          okLabel="Clear"
          onOk={() => {
            setDialog(null)
            aim.clearHistory(ck)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">Clear this room's messages from this device and from your copy on the 98ish server? The others in the room keep theirs.</p>
        </Dialog>
      )}
      {dialog?.kind === "alert" && (
        <Dialog title="Chat" onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
    </div>
  )
}

export default ChatRoom
