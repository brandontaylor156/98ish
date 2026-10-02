import React, { useState } from "react"
import { keyOf, useAim } from "./AimContext"
import { useOpenGesture } from "../../../hooks/useMediaQuery"
import AimDialog from "./AimDialog"
import { Composer, useStickToBottom } from "./ImWindow"
import { TranscriptLine } from "./MessageText"

// A Buddy Chat room: transcript, who's here, and a box to talk in
const ChatRoom = ({ room }) => {
  const aim = useAim()
  const openGesture = useOpenGesture()
  const current = aim.rooms[keyOf(room)]
  const messages = current?.messages || []
  const members = current?.members || []
  const [dialog, setDialog] = useState(null)
  const transcript = useStickToBottom([messages.length])

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
        <div className="aimTranscript" ref={transcript.ref} onScroll={transcript.onScroll}>
          {messages.map((message, i) => (
            <TranscriptLine
              key={i}
              message={message.system ? message : { ...message, mine: message.from === aim.me.screenName }}
              me={aim.me.screenName}
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
        <div className="aimChatCount">{members.length} people here</div>
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
      </aside>

      {dialog?.kind === "invite" && (
        <AimDialog title="Buddy Chat Invitation" okLabel="Send" okDisabled={!dialog.to.trim()} onOk={invite} onCancel={() => setDialog(null)}>
          <label className="aimDialogLabel">Screen names to invite (separate with commas):</label>
          <input value={dialog.to} onChange={(e) => setDialog({ ...dialog, to: e.target.value })} />
          <label className="aimDialogLabel">Invitation message:</label>
          <input value={dialog.message} maxLength={256} onChange={(e) => setDialog({ ...dialog, message: e.target.value })} />
        </AimDialog>
      )}
      {dialog?.kind === "alert" && (
        <AimDialog title="Chat" onOk={() => setDialog(null)}>
          <p className="aimDialogText">{dialog.text}</p>
        </AimDialog>
      )}
    </div>
  )
}

export default ChatRoom
