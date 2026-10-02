import React, { useRef } from "react"
import ClipArt from "./ClipArt"
import { CLIPART, FONTS, SONGS, safeColor, safeImage, safeLink } from "./schema"
import { usePageMusic } from "./usePageMusic"
import "./member.css"

// Draws a member homepage from its structured document: in Internet Explorer at
// http://www.98ish.com/~name (live) and in HomePage Studio (preview, where clicking a
// block selects it). Everything visitors wrote is rendered as text, never as HTML.

const GUESTBOOK = "http://www.98ish.com/guestbook"

// *bold* and _italic_, nothing else
const inline = (text) =>
  String(text)
    .split(/(\*[^*\n]+\*|_[^_\n]+_)/)
    .map((part, i) =>
      /^\*[^*\n]+\*$/.test(part) ? <b key={i}>{part.slice(1, -1)}</b> : /^_[^_\n]+_$/.test(part) ? <i key={i}>{part.slice(1, -1)}</i> : part
    )

export const Odometer = ({ count, digits = 6 }) => {
  const text = count === null || count === undefined ? "-".repeat(digits) : count < 0 ? "?".repeat(digits) : String(count).padStart(digits, "0")
  return (
    <span className="mpOdometer" data-count={count ?? ""}>
      {[...text].map((d, i) => (
        <span key={i}>{d}</span>
      ))}
    </span>
  )
}

// A trail of twinkling stars behind the mouse
const useSparkles = (containerRef) => {
  const last = useRef(0)
  const onPointerMove = (e) => {
    const root = containerRef.current
    if (!root || e.pointerType === "touch" || Date.now() - last.current < 30) return
    last.current = Date.now()
    if (root.querySelectorAll(".mpSparkle").length > 24) return
    const rect = root.getBoundingClientRect()
    const star = document.createElement("span")
    star.className = "mpSparkle"
    star.textContent = ["✦", "✧", "★", "·"][Math.floor(Math.random() * 4)]
    star.style.left = `${e.clientX - rect.left + root.scrollLeft + (Math.random() * 12 - 6)}px`
    star.style.top = `${e.clientY - rect.top + root.scrollTop + (Math.random() * 12 - 6)}px`
    star.style.color = ["#fff", "#ffff66", "#ff99ff", "#66ffff"][Math.floor(Math.random() * 4)]
    root.appendChild(star)
    setTimeout(() => star.remove(), 800)
  }
  return onPointerMove
}

const LinkTo = ({ url, onOpen, children, className }) => {
  const href = safeLink(url)
  if (!href) return <span className={className}>{children}</span>
  return (
    <a
      className={className}
      href={href}
      onClick={(e) => {
        e.preventDefault()
        onOpen?.(href)
      }}
    >
      {children}
    </a>
  )
}

const MusicBar = ({ song, music, preview }) => (
  <div className="mpMusic" onPointerDown={(e) => e.stopPropagation()}>
    <span className="mpNote" aria-hidden="true">
      ♫
    </span>
    <span className="mpMusicText">
      {music.state === "playing" ? "Now playing" : "Background music"}: <b>{song.title}</b> ({song.file})
      {music.state === "idle" && !preview && <span className="mpMusicHint"> - click anywhere on the page to play</span>}
    </span>
    {music.state === "playing" || music.state === "loading" ? (
      <button type="button" onClick={music.stop}>
        Stop
      </button>
    ) : (
      <button type="button" onClick={music.play}>
        Play
      </button>
    )}
  </div>
)

const WebRingBox = ({ ring, onOpen }) =>
  ring ? (
    <div className="mpRing">
      <div className="mpRingTitle">~ This page is a member of the 98ish Web Ring ~</div>
      <div className="mpRingLinks">
        <LinkTo url={ring.prev} onOpen={onOpen}>
          &lt;&lt; Prev
        </LinkTo>
        <LinkTo url={ring.random} onOpen={onOpen}>
          Random
        </LinkTo>
        <LinkTo url={ring.next} onOpen={onOpen}>
          Next &gt;&gt;
        </LinkTo>
        <LinkTo url="http://www.98ish.com/members" onOpen={onOpen}>
          All Members
        </LinkTo>
      </div>
    </div>
  ) : null

const Block = ({ block, hits, ring, onOpen }) => {
  const color = safeColor(block.color, undefined)
  switch (block.type) {
    case "heading": {
      const Tag = ["h1", "h2", "h3"].includes(block.size) ? block.size : "h1"
      return (
        <Tag className={`mpHeading mpEffect--${block.effect || "none"}`} style={{ textAlign: block.align, color }}>
          {block.text}
        </Tag>
      )
    }
    case "paragraph":
      return (
        <p
          className={`mpParagraph mpSize--${block.size || "normal"}`}
          style={{ textAlign: block.align, color, fontWeight: block.bold ? "bold" : undefined, fontStyle: block.italic ? "italic" : undefined, textDecoration: block.underline ? "underline" : undefined }}
        >
          {inline(block.text)}
        </p>
      )
    case "marquee":
      return (
        <div className={`mpMarquee mpMarquee--${block.speed || "normal"} mpMarquee--${block.direction || "left"}`} style={{ color, background: safeColor(block.bgColor, undefined) }}>
          <div className="mpMarqueeTrack">{block.text}</div>
        </div>
      )
    case "blink":
      return (
        <div className="mpBlinkRow" style={{ textAlign: block.align }}>
          <span className="mpBlink" style={{ color }}>
            {block.text}
          </span>
        </div>
      )
    case "image": {
      const src = !block.art && safeImage(block.src)
      return (
        <div className="mpImage" style={{ textAlign: block.align }}>
          {block.art ? <ClipArt id={block.art} label={block.alt || CLIPART.find((c) => c.id === block.art)?.label} /> : src ? <img src={src} alt={block.alt || ""} /> : <span className="mpBroken">[picture]</span>}
        </div>
      )
    }
    case "divider":
      return block.style === "rainbow" ? <ClipArt id="rainbow" label="divider" /> : <hr className={`mpHr mpHr--${block.style || "line"}`} />
    case "links":
      return (
        <div className="mpLinks">
          {block.title && <h3>{block.title}</h3>}
          <ul>
            {(block.items || []).map((item, i) => (
              <li key={i}>
                <LinkTo url={item.url} onOpen={onOpen}>
                  {item.label}
                </LinkTo>
              </li>
            ))}
          </ul>
        </div>
      )
    case "counter":
      return (
        <div className="mpCounter">
          <span>{block.label || "You are visitor number"}</span>
          <Odometer count={hits} />
        </div>
      )
    case "guestbook":
      return (
        <div className="mpGuestbook">
          <LinkTo url={GUESTBOOK} onOpen={onOpen} className={block.style === "link" ? "mpGuestLink" : "mpGuestButton"}>
            {block.text || "Sign My Guestbook!"}
          </LinkTo>
        </div>
      )
    case "webring":
      return <WebRingBox ring={ring} onOpen={onOpen} />
    default:
      return null
  }
}

// doc: { title, bg, bgColor, text, link, font, sparkle, badge, music, blocks }
// owner: { screenName }; hits: the page's count; ring: { prev, next, random } URLs
// preview: HomePage Studio (selected: a block id, onSelect(id))
const MemberPage = ({ doc, owner, hits = null, ring = null, onOpen, preview = false, selected = null, onSelect }) => {
  const rootRef = useRef(null)
  const song = SONGS.find((s) => s.id === doc.music)
  const music = usePageMusic(song?.id || "")
  const sparkle = useSparkles(rootRef)
  const font = FONTS.find((f) => f.id === doc.font) || FONTS[0]
  const style = {
    "--mp-bg": safeColor(doc.bgColor, "#000033"),
    "--mp-text": safeColor(doc.text, "#ffff66"),
    "--mp-link": safeColor(doc.link, "#66ffff"),
    fontFamily: font.css,
  }

  return (
    <div
      ref={rootRef}
      className={`mpRoot mpBg--${doc.bg || "stars"}${preview ? " is-preview" : ""}`}
      style={style}
      onPointerMove={doc.sparkle ? sparkle : undefined}
      // the first click anywhere starts the music (browsers block sound before one)
      onPointerDown={() => !preview && song && music.state === "idle" && music.play()}
    >
      <div className="mpPage">
        {song && <MusicBar song={song} music={music} preview={preview} />}
        {doc.blocks.length === 0 && <p className="mpEmpty">This page is empty. Add a block from the Insert menu!</p>}
        {doc.blocks.map((block, i) => (
          <div
            key={block.id || i}
            className={preview ? `mpBlockWrap${selected === block.id ? " is-selected" : ""}` : "mpBlockWrap"}
            data-block={block.type}
            onClick={preview ? () => onSelect?.(block.id) : undefined}
          >
            <Block block={block} hits={hits} ring={ring} onOpen={preview ? null : onOpen} />
          </div>
        ))}
        {doc.badge && (
          <div className="mpBadges">
            <span className="mpBadge">
              <span className="mpBadgeScreen" aria-hidden="true" />
              Best viewed in 800 x 600
            </span>
            <span className="mpBadge mpBadge--studio">Made with HomePage Studio 98ish</span>
          </div>
        )}
        {owner && (
          <p className="mpFooter">
            This homepage belongs to <b>{owner.screenName}</b>. Hosted free on 98ish.
          </p>
        )}
      </div>
    </div>
  )
}

export default MemberPage
