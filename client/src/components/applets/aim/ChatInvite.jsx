import React from "react"
import { useAim } from "./AimContext"
import { MessageText } from "./MessageText"

// "Bob has invited you to a Buddy Chat": Accept joins the room, Decline closes
const ChatInvite = ({ invite, onClose }) => {
  const aim = useAim()

  return (
    <div className="aimInvite">
      <p>
        <b>{invite.from}</b> has invited you to join the chat room <b>{invite.room}</b>:
      </p>
      {invite.message && (
        <div className="aimInviteMessage">
          <MessageText text={invite.message} />
        </div>
      )}
      <div className="aimInfoButtons">
        <button
          type="button"
          onClick={async () => {
            onClose()
            await aim.joinRoom(invite.room)
          }}
        >
          Accept
        </button>
        <button type="button" onClick={onClose}>
          Decline
        </button>
      </div>
    </div>
  )
}

export default ChatInvite

// A message box from the service ("You have been warned...")
export const AimNotice = ({ text, onClose }) => (
  <div className="aimInvite">
    <div className="aimNotice">
      <img src="/assets/program_icons/aim2-48.png" alt="" />
      <p>{text}</p>
    </div>
    <div className="aimInfoButtons">
      <button type="button" onClick={onClose} autoFocus>
        OK
      </button>
    </div>
  </div>
)
