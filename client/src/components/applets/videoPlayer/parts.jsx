import React from "react"
import { formatCount, formatDuration, timeAgo, videoIdFrom } from "./api"

export const Logo = () => (
  <span className="ytLogo">
    <span className="ytLogoYou">You</span>
    <span className="ytLogoTube">Tube</span>
    <span className="ytLogo98">'98</span>
    <span className="ytTagline">Broadcast Yourself&trade;</span>
  </span>
)

export const Thumb = ({ video, size = "medium", onClick }) => (
  <button type="button" className={`ytThumb ytThumb--${size}`} onClick={onClick} aria-label={video.title}>
    {video.thumbnail ? <img src={video.thumbnail} alt="" loading="lazy" draggable="false" /> : <span className="ytThumbBlank" />}
    {video.live ? <span className="ytDuration ytDuration--live">LIVE</span> : video.duration ? <span className="ytDuration">{formatDuration(video.duration)}</span> : null}
  </button>
)

const open = (navigate, video) => () => navigate({ type: "watch", id: video.id })

// Grid card (home page, favorites)
export const VideoCard = ({ video, navigate }) => (
  <div className="ytCard">
    <Thumb video={video} onClick={open(navigate, video)} />
    <button type="button" className="ytTitleLink" onClick={open(navigate, video)}>
      {video.title}
    </button>
    {video.views != null && <div className="ytMeta">{formatCount(video.views)} views</div>}
    <div className="ytMeta">
      From: <span className="ytChannel">{video.channelTitle}</span>
    </div>
  </div>
)

// Search result row: thumbnail left, details right
export const VideoRow = ({ video, navigate }) => (
  <div className="ytRow">
    <Thumb video={video} onClick={open(navigate, video)} />
    <div className="ytRowText">
      <button type="button" className="ytTitleLink ytTitleLink--big" onClick={open(navigate, video)}>
        {video.title}
      </button>
      <p className="ytSnippet">{video.description}</p>
      <div className="ytMeta">
        Added: {timeAgo(video.publishedAt)}
        <span className="ytDot">&middot;</span>
        From: <span className="ytChannel">{video.channelTitle}</span>
        {video.views != null && (
          <>
            <span className="ytDot">&middot;</span>
            Views: {formatCount(video.views)}
          </>
        )}
      </div>
    </div>
  </div>
)

// Small sidebar row (More From, Related Videos)
export const SideRow = ({ video, navigate, active }) => (
  <div className={active ? "ytSideRow is-active" : "ytSideRow"}>
    <Thumb video={video} size="small" onClick={open(navigate, video)} />
    <div className="ytSideText">
      <button type="button" className="ytTitleLink" onClick={open(navigate, video)}>
        {video.title}
      </button>
      {video.views != null && <div className="ytMeta">{formatCount(video.views)} views</div>}
    </div>
  </div>
)

// Plain text with links: YouTube links open inside the app, others in a new tab
const URL_PATTERN = /(https?:\/\/[^\s<>"]+[^\s<>".,:;'!?)\]])/g
export const LinkedText = ({ text, navigate }) => (
  <>
    {String(text || "")
      .split(URL_PATTERN)
      .map((part, i) => {
        if (i % 2 === 0) return part
        const id = videoIdFrom(part)
        return (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if (!id) return
              e.preventDefault()
              navigate({ type: "watch", id })
            }}
          >
            {part}
          </a>
        )
      })}
  </>
)

// Classic error page
export const ErrorPage = ({ error, onRetry }) => (
  <div className="ytError">
    <h2>We're sorry...</h2>
    <p>
      {error.reason === "quotaExceeded" || error.reason === "dailyLimitExceeded"
        ? "YouTube '98 has used up today's free YouTube lookups. Please try again tomorrow. Videos and pages you've already visited may still load."
        : error.reason === "config"
          ? "YouTube '98 isn't set up yet: the server has no YouTube API key."
          : error.message}
    </p>
    {onRetry && (
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    )}
  </div>
)

export const Loading = ({ label = "Loading..." }) => <div className="ytLoading">{label}</div>
