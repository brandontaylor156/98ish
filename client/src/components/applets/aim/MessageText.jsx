import React from "react"
import { useAim } from "./AimContext"

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

// One transcript line: "ScreenName (10:42:15 PM): message", yours in red, theirs in blue
export const TranscriptLine = React.memo(({ message, me }) => {
  if (message.system) {
    return <div className={message.error ? "aimSystem aimSystem--error" : "aimSystem"}>{message.text}</div>
  }
  const mine = message.mine || message.from === me
  return (
    <div className="aimLine">
      <span className={mine ? "aimName aimName--me" : "aimName aimName--them"}>
        {message.from}
        {message.auto && " <AUTO-RESPONSE>"}
      </span>
      <span className="aimTime"> ({clock(message.time)})</span>
      <span className={mine ? "aimName aimName--me" : "aimName aimName--them"}>: </span>
      <MessageText text={message.text} style={message.style} />
    </div>
  )
})
