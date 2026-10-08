import React from "react"
import { useAim } from "./AimContext"
import { useLongPress } from "../../../hooks/useLongPress"
import { PictureBubble, ReactionChips, VoiceBubble } from "./history/ImExtras"

// Messages are plain text plus one style for the whole message (your default font and
// color), never HTML, so nothing a buddy sends can inject markup.

const URL_PATTERN = /(https?:\/\/[^\s<>"]+[^\s<>".,:;'!?)\]])/g

// youtube.com/watch?v=, youtu.be/ and /embed/ links all play in a View Video window
const youtubeEmbed = (url) => {
  const match = url.match(/(?:youtube\.com\/(?:embed\/|watch\?(?:.*&)?v=)|youtu\.be\/)([\w-]{11})/)
  return match && `https://www.youtube.com/embed/${match[1]}`
}

export const textStyle = (style = {}) => ({
  fontFamily: style.font,
  fontSize: style.size ? `${style.size}px` : undefined,
  color: style.color,
  fontWeight: style.bold ? "bold" : undefined,
  fontStyle: style.italic ? "italic" : undefined,
  textDecoration: style.underline ? "underline" : undefined,
})

export const MessageText = ({ text, style }) => {
  const { openVideo } = useAim()
  const parts = String(text).split(URL_PATTERN)

  return (
    <span className="aimText" style={textStyle(style)}>
      {parts.map((part, i) => {
        if (i % 2 === 0) return part
        const video = youtubeEmbed(part)
        return (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              if (!video) return
              event.preventDefault()
              openVideo(video)
            }}
          >
            {part}
          </a>
        )
      })}
    </span>
  )
}

const clock = (time) => new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })

// One transcript line: "ScreenName (10:42:15 PM): message", yours in red, theirs in blue.
// A picture or voice message shows under the name; reactions under the message. Right-click
// (or hold, on a touch screen) opens the reaction picker: onMenu(message, x, y).
export const TranscriptLine = React.memo(({ message, me, meKey, onMenu, onReact, getBlob, onOpenPicture, onAction }) => {
  const press = useLongPress((x, y) => onMenu?.(message, x, y))
  if (message.system) {
    return (
      <div className={message.error ? "aimSystem aimSystem--error" : "aimSystem"}>
        {message.text}
        {/* an invitation line ("Rosie started Watch Together." [Join]) */}
        {message.action && onAction && (
          <>
            {" "}
            <button type="button" className="aimSystemAction" onClick={() => onAction(message.action)}>
              {message.action.label}
            </button>
          </>
        )}
      </div>
    )
  }
  const mine = message.mine || message.from === me
  const canReact = !!onMenu && !message.pending && !message.failed && message.id && !String(message.id).startsWith("t-") && !message.auto
  const media = message.media
  return (
    <div
      className={`aimLine aimMsg${message.failed ? " is-failed" : ""}`}
      data-msg-id={message.id}
      {...(canReact ? press : {})}
      onContextMenu={
        canReact
          ? (e) => {
              e.preventDefault()
              e.stopPropagation()
              onMenu(message, e.clientX, e.clientY)
            }
          : undefined
      }
    >
      <span className={mine ? "aimName aimName--me" : "aimName aimName--them"}>
        {message.from}
        {message.auto && " <AUTO-RESPONSE>"}
      </span>
      <span className="aimTime"> ({clock(message.time)})</span>
      <span className={mine ? "aimName aimName--me" : "aimName aimName--them"}>: </span>
      {message.text && <MessageText text={message.text} style={message.style} />}
      {media?.k === "image" && (
        <span className="aimMsgBody">
          <PictureBubble message={message} getBlob={getBlob} onOpen={onOpenPicture} />
        </span>
      )}
      {media?.k === "audio" && (
        <span className="aimMsgBody">
          <VoiceBubble message={message} getBlob={getBlob} />
        </span>
      )}
      {/* a 3D model from 3D Viewer 98: Open saves it to C:\My 3D and shows it */}
      {media?.k === "model" && (
        <span className="aimMsgBody aimModelCard" data-model-card>
          <span aria-hidden="true">🧊</span> <b>{media.t || "3D model"}</b> <small>3D model{media.tr ? ` · ${Number(media.tr).toLocaleString()} triangles` : ""}</small>{" "}
          {onAction && !message.pending && (
            <button type="button" className="aimSystemAction" onClick={() => onAction({ kind: "model", message })} data-model-open>
              Open
            </button>
          )}
        </span>
      )}
      {/* "Meet me at <venue>" (pickleball/play/meet.js): Play here opens My Park there, Directions opens Maps 98 */}
      {message.card?.k === "venue" && (
        <span className="aimMsgBody aimVenueCard" data-venue-card={message.card.id}>
          <span aria-hidden="true">📍</span> <b>Meet me at {message.card.n}</b>
          {message.card.c && <small> {message.card.c}</small>}
          {onAction && !message.pending && (
            <span className="aimVenueCardButtons">
              <button type="button" className="aimSystemAction" onClick={() => onAction({ kind: "venue", card: message.card })} data-venue-play>
                Play here
              </button>
              <button type="button" className="aimSystemAction" onClick={() => onAction({ kind: "directions", card: message.card })} data-venue-directions>
                Directions
              </button>
            </span>
          )}
        </span>
      )}
      {message.r && <ReactionChips r={message.r} meKey={meKey} onToggle={canReact && onReact ? (emoji) => onReact(message, emoji) : undefined} />}
    </div>
  )
})
