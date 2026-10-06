import React, { useEffect, useState } from "react"
import { RING, SERVER_URL, localPath, localUrl, memberKey, pageFor, ringNeighbor, ringRandom } from "./site"
import { useAim } from "../../aim/AimContext"
import MemberPage, { Odometer } from "./member/MemberPage"
import { withIds } from "./member/schema"
import "./local.css"
import { unlock } from "../../../../utils/achievements"

// The 98ish Web Ring: a guestbook and a few homemade homepages, served from
// http://www.98ish.com/ inside Internet Explorer. Visitor-written text is always shown as
// plain text.

const MOODS = [
  ["smile", "Happy"],
  ["grin", "Grinning"],
  ["wink", "Winking"],
  ["cool", "Cool"],
  ["love", "In love"],
  ["tongue", "Silly"],
  ["wow", "Amazed"],
  ["sad", "Sad"],
  ["angry", "Grumpy"],
  ["alien", "Alien"],
]

export const Smiley = ({ mood = "smile", size = 28 }) => {
  const face = mood === "alien" ? "#7ce35a" : mood === "angry" ? "#ff7a4d" : "#ffe14d"
  const eyes = {
    wink: <path d="M10 13h4M19 12a1.6 1.6 0 1 1 0 .1z" stroke="#000" strokeWidth="2" strokeLinecap="round" />,
    cool: <path d="M6 11h20v2l-2 3h-5l-2-3h-2l-2 3H8l-2-3z" fill="#000" />,
    love: <path d="M9 10c-2-2-4 0-3 2l3 3 3-3c1-2-1-4-3-2zM23 10c-2-2-4 0-3 2l3 3 3-3c1-2-1-4-3-2z" fill="#e00030" />,
    angry: <path d="M8 10l5 2M24 10l-5 2M10 14h2M20 14h2" stroke="#000" strokeWidth="2" strokeLinecap="round" />,
    alien: <path d="M7 12c2-3 6-2 6 2-3 1-6 0-6-2zM25 12c-2-3-6-2-6 2 3 1 6 0 6-2z" fill="#000" />,
    wow: <path d="M11 13a1.8 2.4 0 1 1 0 .1zM21 13a1.8 2.4 0 1 1 0 .1z" fill="#000" />,
  }[mood] || <path d="M11 12.5a1.6 2 0 1 1 0 .1zM21 12.5a1.6 2 0 1 1 0 .1z" fill="#000" />
  const mouth = {
    grin: <path d="M9 19h14c0 4-3 6-7 6s-7-2-7-6z" fill="#fff" stroke="#000" strokeWidth="1.5" />,
    tongue: (
      <>
        <path d="M10 20q6 4 12 0" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" />
        <path d="M17 21q0 5 3 4t1-5z" fill="#ff6080" stroke="#000" />
      </>
    ),
    wow: <ellipse cx="16" cy="22" rx="3" ry="3.6" fill="#000" />,
    sad: <path d="M10 24q6-5 12 0" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" />,
    angry: <path d="M10 24q6-4 12 0" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" />,
    alien: <path d="M13 22h6" stroke="#000" strokeWidth="2" strokeLinecap="round" />,
  }[mood] || <path d="M9 19q7 7 14 0" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" />
  return (
    <svg className="lsSmiley" viewBox="0 0 32 32" width={size} height={size} role="img" aria-label={MOODS.find((m) => m[0] === mood)?.[1] || "smiley"}>
      {mood === "alien" ? <path d="M16 2c8 0 13 6 13 12 0 8-7 16-13 16S3 22 3 14C3 8 8 2 16 2z" fill={face} stroke="#000" strokeWidth="1.5" /> : <circle cx="16" cy="16" r="14" fill={face} stroke="#000" strokeWidth="1.5" />}
      {eyes}
      {mouth}
    </svg>
  )
}

// A real hit counter, odometer style. Counts once per visitor per page every 10 minutes.
export const HitCounter = ({ page }) => {
  const [count, setCount] = useState(null)
  useEffect(() => {
    let live = true
    fetch(`${SERVER_URL}/api/hits/${page}`, { method: "POST" })
      .then((r) => r.json())
      .then((data) => live && data.ok && setCount(data.count))
      .catch(() => live && setCount(-1))
    return () => {
      live = false
    }
  }, [page])
  const digits = count === null ? "------" : count < 0 ? "??????" : String(count).padStart(6, "0")
  return (
    <div className="lsCounter">
      <span>You are visitor number</span>
      <span className="lsOdometer" data-count={count ?? ""} aria-label={count > 0 ? `${count} visitors` : "visitor count"}>
        {[...digits].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </span>
    </div>
  )
}

export const UnderConstruction = ({ text = "UNDER CONSTRUCTION" }) => (
  <div className="lsConstruction" role="img" aria-label="Under construction">
    <span className="lsBeacon" />
    <div className="lsSign">
      <span className="lsDigger" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22">
          <circle cx="9" cy="5" r="3" fill="#000" />
          <path d="M9 8v8l-4 6M9 16l4 6M9 11l6-3" stroke="#000" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path className="lsShovel" d="M15 8l5 9" stroke="#6b3a1e" strokeWidth="2" />
          <path className="lsShovel" d="M18 16l4 3-3 3-3-4z" fill="#808080" />
        </svg>
      </span>
      {text}
    </div>
    <span className="lsBeacon" />
  </div>
)

export const Marquee = ({ children }) => (
  <div className="lsMarquee">
    <div className="lsMarqueeTrack">{children}</div>
  </div>
)

// The ring: the built-in pages, then every published member homepage (fetched now and
// then; the built-in pages work without the server)
let ringCache = { at: 0, members: [] }
export const useRing = () => {
  const [members, setMembers] = useState(ringCache.members)
  useEffect(() => {
    if (Date.now() - ringCache.at < 30_000) return
    let live = true
    fetch(`${SERVER_URL}/api/ring`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) return
        ringCache = { at: Date.now(), members: data.members }
        if (live) setMembers(data.members)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return [...RING, ...members.filter((m) => m && typeof m.path === "string" && memberKey(m.path))]
}

const WebRing = ({ path, onOpen }) => {
  const ring = useRing()
  const prev = ringNeighbor(path, -1, ring)
  const next = ringNeighbor(path, 1, ring)
  return (
    <div className="lsRing">
      <div className="lsRingTitle">~ The 98ish Web Ring ~</div>
      <div className="lsRingLinks">
        <a href={localUrl(prev.path)} onClick={(e) => (e.preventDefault(), onOpen(localUrl(prev.path)))}>
          &lt;&lt; Prev
        </a>
        <a href="#random" onClick={(e) => (e.preventDefault(), onOpen(localUrl(ringRandom(path, ring).path)))}>
          Random
        </a>
        <a href={localUrl(next.path)} onClick={(e) => (e.preventDefault(), onOpen(localUrl(next.path)))}>
          Next &gt;&gt;
        </a>
      </div>
      <div className="lsRingSites">
        {RING.map((p) => (
          <a key={p.path} href={localUrl(p.path)} className={p.path === path ? "is-here" : undefined} onClick={(e) => (e.preventDefault(), onOpen(localUrl(p.path)))}>
            {p.title}
          </a>
        ))}
      </div>
    </div>
  )
}

const Link = ({ url, onOpen, children }) => (
  <a href={url} onClick={(e) => (e.preventDefault(), onOpen(url))}>
    {children}
  </a>
)

// ---------- the guestbook ----------

const when = (time) =>
  new Date(time).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })

const EMPTY_FORM = { name: "", homepage: "", message: "", mood: "smile", website: "" }

const Guestbook = ({ onOpen }) => {
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null) // { entries, pages, total }
  const [error, setError] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState(null) // { ok, text }
  const token = useAim()?.token

  const load = (n = page) => {
    setError(null)
    fetch(`${SERVER_URL}/api/guestbook?page=${n}`)
      .then((r) => r.json())
      .then((d) => (d.ok ? setData(d) : setError(d.error)))
      .catch(() => setError("The guestbook server isn't answering. It may be waking up; try again in a minute."))
  }
  useEffect(() => load(page), [page])

  const sign = async (e) => {
    e.preventDefault()
    setSending(true)
    setNotice(null)
    try {
      // signed on: the entry is tied to the account (never shown), so Delete My Account removes it
      const r = await fetch(`${SERVER_URL}/api/guestbook`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(form) })
      const d = await r.json()
      if (!d.ok) setNotice({ ok: false, text: d.error })
      else {
        setNotice({ ok: true, text: "Thanks for signing my guestbook!! Come back soon!" })
        unlock("guestbook")
        setForm(EMPTY_FORM)
        if (page === 1) load(1)
        else setPage(1)
      }
    } catch {
      setNotice({ ok: false, text: "Couldn't reach the guestbook server. Try again in a minute." })
    }
    setSending(false)
  }

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })

  return (
    <div className="lsPage lsPage--guestbook">
      <Marquee>
        *~*~* WELCOME to the 98ish GUESTBOOK!! *~*~* Sign it before you leave!! *~*~* Best viewed in Internet Explorer at 800x600 *~*~*
      </Marquee>
      <h1 className="lsRainbow">My Guestbook</h1>
      <p className="lsCenter">
        Thanks for stopping by my corner of the Web! Please sign my guestbook and tell me what you think. <span className="lsBlink">NEW!</span>
      </p>
      <UnderConstruction />
      <HitCounter page="guestbook" />

      <form className="lsForm" onSubmit={sign}>
        <h2>Sign My Guestbook!</h2>
        <label>
          <span>Your Name:</span>
          <input value={form.name} onChange={set("name")} maxLength={32} required />
        </label>
        <label>
          <span>Your Homepage:</span>
          <input value={form.homepage} onChange={set("homepage")} maxLength={100} placeholder="http://www.geocities.com/..." inputMode="url" autoCapitalize="off" spellCheck="false" />
        </label>
        {/* A trap for robots: people never see or fill this in */}
        <label className="lsTrap" aria-hidden="true">
          Website
          <input value={form.website} onChange={set("website")} tabIndex={-1} autoComplete="off" />
        </label>
        <fieldset className="lsMoods">
          <legend>How are you feeling?</legend>
          {MOODS.map(([id, label]) => (
            <label key={id} title={label} className={form.mood === id ? "is-picked" : undefined}>
              <input type="radio" name="mood" value={id} checked={form.mood === id} onChange={set("mood")} aria-label={label} />
              <Smiley mood={id} size={24} />
            </label>
          ))}
        </fieldset>
        <label>
          <span>Your Message:</span>
          <textarea value={form.message} onChange={set("message")} maxLength={500} rows={4} required />
        </label>
        <div className="lsFormFoot">
          <small>{500 - form.message.length} characters left. Be nice! No links in messages.</small>
          <button type="submit" disabled={sending || !form.name.trim() || !form.message.trim()}>
            {sending ? "Signing..." : "Sign My Guestbook!"}
          </button>
        </div>
        {notice && (
          <p className={notice.ok ? "lsNotice is-ok" : "lsNotice"} role="status">
            {notice.text}
          </p>
        )}
      </form>

      <h2 className="lsCenter">~ What People Are Saying ~ {data ? `(${data.total})` : ""}</h2>
      {error && (
        <p className="lsNotice">
          {error}{" "}
          <button type="button" onClick={() => load(page)}>
            Retry
          </button>
        </p>
      )}
      {!data && !error && <p className="lsCenter">Loading entries...</p>}
      {data && data.entries.length === 0 && <p className="lsCenter">Nobody has signed yet. Be the first!!</p>}
      <div className="lsEntries">
        {data?.entries.map((entry) => (
          <div className="lsEntry" key={entry.id}>
            <div className="lsEntryHead">
              <Smiley mood={entry.mood} />
              <div>
                <b className="lsEntryName">{entry.name}</b>
                {entry.homepage && (
                  <>
                    {" "}
                    - <Link url={entry.homepage} onOpen={onOpen}>{entry.homepage.replace(/^https?:\/\//, "").replace(/\/$/, "")}</Link>
                  </>
                )}
                <div className="lsWhen">{when(entry.time)}</div>
              </div>
            </div>
            <p className="lsEntryText">{entry.message}</p>
          </div>
        ))}
      </div>
      {data && data.pages > 1 && (
        <div className="lsPager">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            &lt;&lt; Newer
          </button>
          <span>
            Page {page} of {data.pages}
          </span>
          <button type="button" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>
            Older &gt;&gt;
          </button>
        </div>
      )}
    </div>
  )
}

// ---------- the other ring sites ----------

// the Hall of Fame on the Shrine: your own Minesweeper best times (Minesweeper.jsx saves them)
const SHRINE_LEVELS = [
  ["beginner", "Beginner"],
  ["intermediate", "Intermediate"],
  ["expert", "Expert"],
]
const ShrineBest = () => {
  let best = {}
  try {
    best = JSON.parse(localStorage.getItem("98ish.minesweeper.best")) || {}
  } catch {
    best = {}
  }
  const real = (b) => b && Number.isFinite(b.seconds) && !(b.seconds >= 999 && b.name === "Anonymous")
  const rows = SHRINE_LEVELS.filter(([k]) => real(best[k]))
  if (!rows.length) return <p>No records yet. Win a game of Minesweeper and your time is enshrined here forever (or until you reset it).</p>
  return (
    <table className="lsTable">
      <tbody>
        {rows.map(([k, label]) => (
          <tr key={k}>
            <th>{label}</th>
            <td>{best[k].seconds} sec</td>
            <td>{best[k].name}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const Shrine = () => (
  <div className="lsPage lsPage--shrine">
    <Marquee>!!! WARNING: this page contains EXTREME minesweeping knowledge !!!</Marquee>
    <h1>The Minesweeper Strategy Shrine</h1>
    <p className="lsCenter">
      <i>"I have cleared Expert in 112 seconds and I am here to share my wisdom."</i>
    </p>
    <HitCounter page="shrine" />
    <div className="lsColumns">
      <div>
        <h2>Ten Commandments of the Sweeper</h2>
        <ol>
          <li>Thou shalt start in a corner. Or the middle. Opinions vary.</li>
          <li>A 1 touching only one hidden square: that square is a mine. Flag it!</li>
          <li>1-2-1 along a wall: the mines are under the 1s.</li>
          <li>1-2-2-1 along a wall: the mines are under the 2s.</li>
          <li>Click a number when all its flags are placed to open the rest (chording!).</li>
          <li>Never guess when you can count. Count the mines left on the red display.</li>
          <li>When you must guess, guess early, before you've invested 5 minutes.</li>
          <li>Right-click twice for a "?" when you're not sure.</li>
          <li>Wear sunglasses when you win. The smiley does.</li>
          <li>Challenge a friend to a Minesweeper Race from Network Neighborhood.</li>
        </ol>
      </div>
      <div>
        <h2>Your Hall of Fame</h2>
        <ShrineBest />
        <h2>Awards This Site Has Won</h2>
        <div className="lsAwards">
          <span>Top 5% of Minesweeper Sites</span>
          <span>Cool Site of the Day*</span>
        </div>
        <small>*the day was a Tuesday</small>
      </div>
    </div>
    <h2>Advanced Techniques (for the truly devoted)</h2>
    <div className="lsColumns">
      <div>
        <h3>Patterns to know by heart</h3>
        <ul>
          <li><b>1-1 from a wall:</b> on a straight edge, a 1 next to the wall followed by another 1 means the square third along from the wall is safe.</li>
          <li><b>1-2 from a wall:</b> the hidden square beyond the 2 (on the far side from the 1) is always a mine.</li>
          <li><b>1-2-1:</b> mines under both 1s, the square under the 2 is safe.</li>
          <li><b>1-2-2-1:</b> mines under the two 2s, the squares under the 1s are safe.</li>
          <li><b>Reduce the numbers:</b> subtract the flags already touching a number. A 3 with two flags next to it is really a 1. Then the patterns above work again.</li>
          <li><b>Shared squares:</b> if every hidden neighbor of one number is also a neighbor of a second number with the same count, the second number's other hidden neighbors are safe.</li>
        </ul>
      </div>
      <div>
        <h3>Speed</h3>
        <ul>
          <li><b>Chord, don't click:</b> once a number has all its flags, click it (or both buttons) to open every other neighbor at once. Experts chord far more than they click.</li>
          <li><b>Flag only what you need:</b> a flag you never chord around is wasted time. Many fast players flag almost nothing on Beginner.</li>
          <li><b>Work in one area:</b> finish the region you're in before jumping across the board; your eyes stay on the pattern.</li>
          <li><b>The first click is never a mine</b> in 98ish, just as in Windows. It won't always open a patch, so keep clicking fresh squares in open areas until you get one to work from.</li>
        </ul>
        <h3>When you have to guess</h3>
        <ul>
          <li>Count first: the red counter minus your flags is the mines left. Near the end that number often settles a 50/50.</li>
          <li>Guess where the most new information would come from: a square that would open a fresh area beats one that only reveals a single number.</li>
          <li>A random untouched square far from the numbers has roughly (mines left ÷ hidden squares) chance of a mine. On Expert that's about 1 in 5 at the start, often better than a bad 50/50.</li>
          <li>Guess early. A forced guess with 10 seconds on the clock costs less than the same guess at 200.</li>
        </ul>
      </div>
    </div>
    <p className="lsCenter">
      <small>Webmaster's note: I finally finished this page. The under-construction sign has been retired with full honors.</small>
    </p>
  </div>
)

const COOL_LINKS = [
  ["http://www.spacejam.com/", "Space Jam", "The movie website that never changed. A true wonder of the Web."],
  ["http://www.zombo.com/", "Zombo.com", "Anything is possible. The only limit is yourself."],
  ["http://www.hampsterdance.com/", "Hampster Dance", "Dancing hamsters. Need we say more?"],
  ["http://www.yahoo.com/", "Yahoo!", "Where everybody starts surfing."],
  ["http://www.geocities.com/", "GeoCities", "Get your own free home page, just like this one!"],
  ["http://www.newgrounds.com/", "Newgrounds", "Flash games and cartoons. Everything, by everyone."],
  ["http://www.homestarrunner.com/", "Homestar Runner", "It's dot com!"],
  ["http://www.neopets.com/", "Neopets", "Adopt a virtual pet (it's a lot of work)."],
]

const Links = ({ onOpen }) => (
  <div className="lsPage lsPage--links">
    <h1>Cool Links of the Web</h1>
    <Marquee>Surf the Information Superhighway! These links open in the time machine, just as they were.</Marquee>
    <HitCounter page="links" />
    <ul className="lsLinkList">
      {COOL_LINKS.map(([url, name, about]) => (
        <li key={url}>
          <span className="lsBullet" aria-hidden="true" />
          <Link url={url} onOpen={onOpen}>
            {name}
          </Link>{" "}
          - {about}
        </li>
      ))}
    </ul>
    <div className="lsLinkUs">
      <b>Link to us!</b> Copy this onto your homepage:
      <code>&lt;a href="http://www.98ish.com/"&gt;98ish&lt;/a&gt;</code>
    </div>
  </div>
)

const Rock = () => (
  <div className="lsPage lsPage--rock">
    <h1>Rocky's Home Page</h1>
    <p className="lsCenter">Hi! I'm Rocky. I'm a rock. Welcome to my home page!!!</p>
    <div className="lsRock" role="img" aria-label="Rocky the pet rock">
      <span className="lsRockEye" />
      <span className="lsRockEye" />
    </div>
    <HitCounter page="rock" />
    <div className="lsColumns">
      <div>
        <h2>About Me</h2>
        <table className="lsTable">
          <tbody>
            <tr>
              <th>Age</th>
              <td>About 400 million years</td>
            </tr>
            <tr>
              <th>Hobbies</th>
              <td>Sitting, staying put, being a paperweight</td>
            </tr>
            <tr>
              <th>Favorite band</th>
              <td>The Rolling Stones (obviously)</td>
            </tr>
            <tr>
              <th>Favorite music</th>
              <td>Rock</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div>
        <h2>My Favorite Things</h2>
        <ul>
          <li>Gravel (my cousins)</li>
          <li>Not moving</li>
          <li>The Flintstones</li>
          <li>Being skipped across a lake (once, in 1987)</li>
        </ul>
      </div>
    </div>
    <UnderConstruction text="ROCKY IS STILL BUILDING THIS PAGE" />
  </div>
)

const NotFound = ({ url, onOpen }) => (
  <div className="lsPage lsPage--404">
    <h1>404 Not Found</h1>
    <p className="lsCenter">
      The page <b>{url}</b> doesn't exist on 98ish (yet).
    </p>
    <UnderConstruction />
    <p className="lsCenter">
      <Link url={localUrl("/guestbook")} onOpen={onOpen}>
        Go to the guestbook
      </Link>
    </p>
  </div>
)

// ---------- member homepages ----------

const visitorId = () => {
  try {
    let id = localStorage.getItem("98ish.visitor")
    if (!/^[a-z0-9]{8,32}$/.test(id || "")) {
      id = Math.random().toString(36).slice(2, 12) + Date.now().toString(36)
      localStorage.setItem("98ish.visitor", id)
    }
    return id
  } catch {
    return ""
  }
}

// http://www.98ish.com/~name: a member's homepage, drawn from its structured document
const MemberView = ({ memberKey: key, path, onOpen, onTitle }) => {
  const token = useAim()?.token
  const ring = useRing()
  const [data, setData] = useState(null) // { screenName, page } | { error }
  const [hits, setHits] = useState(null)

  useEffect(() => {
    let live = true
    onTitle?.(localUrl(path))
    fetch(`${SERVER_URL}/api/homepages/${key}`)
      .then(async (r) => ({ status: r.status, ...(await r.json()) }))
      .then((d) => {
        if (!live) return
        if (!d.ok) {
          onTitle?.(d.status === 404 ? "404 Not Found" : "98ish")
          return setData({ error: d.status === 404 ? "missing" : d.error })
        }
        setData({ ...d, page: { ...d.page, blocks: withIds(d.page.blocks) } })
        setHits(d.hits)
        onTitle?.(d.page.title)
        // count this visit (the owner's own visits don't count)
        fetch(`${SERVER_URL}/api/homepages/${key}/hit`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ visitor: visitorId() }),
        })
          .then((r) => r.json())
          .then((h) => live && h.ok && setHits(h.count))
          .catch(() => {})
      })
      .catch(() => live && setData({ error: "The 98ish web server isn't answering. It may be waking up; try again in a minute." }))
    return () => {
      live = false
    }
  }, [key])

  if (!data) {
    return (
      <div className="lsRoot">
        <p className="lsCenter lsMemberLoading">Opening {localUrl(path)}...</p>
      </div>
    )
  }
  if (data.error) {
    return (
      <div className="lsRoot">
        <div className="lsPage lsPage--404">
          <h1>{data.error === "missing" ? "404 Not Found" : "Server Busy"}</h1>
          <p className="lsCenter">
            {data.error === "missing" ? (
              <>
                Nobody has published a homepage at <b>{localUrl(path)}</b> yet.
              </>
            ) : (
              data.error
            )}
          </p>
          <UnderConstruction text="BUILD YOURS WITH HOMEPAGE STUDIO" />
          <p className="lsCenter">
            <Link url={localUrl("/members")} onOpen={onOpen}>
              See all the members' homepages
            </Link>
          </p>
        </div>
      </div>
    )
  }
  const links = {
    prev: localUrl(ringNeighbor(path, -1, ring).path),
    next: localUrl(ringNeighbor(path, 1, ring).path),
    random: localUrl(ringRandom(path, ring).path),
  }
  // Every homepage is in the ring: a page without the Web Ring block gets one at the bottom
  const page = data.page.blocks.some((b) => b.type === "webring") ? data.page : { ...data.page, blocks: [...data.page.blocks, { id: "ring", type: "webring" }] }
  return (
    <div className="lsMember">
      <MemberPage doc={page} owner={{ screenName: data.screenName }} hits={hits} ring={links} onOpen={onOpen} />
    </div>
  )
}

// http://www.98ish.com/members: every published homepage, newest or most visited first
const Members = ({ onOpen }) => {
  const [sort, setSort] = useState("newest")
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    setError(null)
    fetch(`${SERVER_URL}/api/homepages?sort=${sort}&page=${page}`)
      .then((r) => r.json())
      .then((d) => live && (d.ok ? setData(d) : setError(d.error)))
      .catch(() => live && setError("The 98ish web server isn't answering. It may be waking up; try again in a minute."))
    return () => {
      live = false
    }
  }, [sort, page])

  return (
    <div className="lsPage lsPage--members">
      <Marquee>*~*~* Welcome to 98ish Members! Free homepages for everyone with a 98 Messenger screen name! *~*~*</Marquee>
      <h1 className="lsRainbow">98ish Members</h1>
      <p className="lsCenter">
        Every page here was made with <b>HomePage Studio 98ish</b>. Build yours: Start, Programs, Internet, HomePage Studio. <span className="lsBlink">FREE!</span>
      </p>
      <div className="mbSort">
        {[
          ["newest", "Newest"],
          ["popular", "Most Visited"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={sort === id ? "is-active" : undefined}
            onClick={() => {
              setSort(id)
              setPage(1)
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="lsNotice">{error}</p>}
      {!data && !error && <p className="lsCenter">Loading the directory...</p>}
      {data && data.members.length === 0 && <p className="lsCenter">No homepages yet. Be the first!!</p>}
      <ul className="mbList">
        {data?.members.map((m) => (
          <li key={m.key} className="mbItem">
            <div className="mbItemText">
              <Link url={localUrl(`/~${m.key}`)} onOpen={onOpen}>
                <span className="mbItemTitle">{m.title}</span>
              </Link>
              <div className="mbItemBy">
                by {m.screenName} - updated {new Date(m.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </div>
            </div>
            <div className="mbHits">
              <Odometer count={m.hits} />
              <div>visitors</div>
            </div>
          </li>
        ))}
      </ul>
      {data && data.pages > 1 && (
        <div className="lsPager">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            &lt;&lt; Prev
          </button>
          <span>
            Page {page} of {data.pages}
          </span>
          <button type="button" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>
            Next &gt;&gt;
          </button>
        </div>
      )}
    </div>
  )
}

const PAGES = { "/guestbook": Guestbook, "/shrine": Shrine, "/links": Links, "/rock": Rock, "/members": Members }

const LocalSite = ({ url, onOpen, onTitle }) => {
  const path = localPath(url)
  const member = memberKey(path)
  const Page = PAGES[path]
  useEffect(() => {
    if (!member) onTitle?.(pageFor(url)?.title || "98ish")
  }, [url])
  if (member) return <MemberView key={member} memberKey={member} path={path} onOpen={onOpen} onTitle={onTitle} />
  return (
    <div className={`lsRoot lsRoot--${path?.slice(1) || "home"}`}>
      {Page ? <Page onOpen={onOpen} /> : <NotFound url={url} onOpen={onOpen} />}
      {Page && <WebRing path={path} onOpen={onOpen} />}
      <p className="lsFooter">Made with Notepad. This page is part of 98ish. Last updated {new Date().getFullYear()}.</p>
    </div>
  )
}

export default LocalSite
