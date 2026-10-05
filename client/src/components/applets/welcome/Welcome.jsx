import React, { useState } from "react"
import { launch, programByName, ieWindow } from "../../../utils/programs"
import { TOUR_STEPS, setWelcome, startTour, useWelcome } from "../../../utils/welcome"
import { shellAction } from "../../../utils/shell"
import { openHelp } from "../../../utils/help"
import { BannerComputer, OPTION_ICONS } from "./art"
import { GlobeIcon } from "../../shared/online/PlayOnlineButton"
import "./Welcome.css"

// Welcome to 98ish: the screen that greets you when 98ish starts (like Windows 98's own),
// with a big option column on the left and what each one says on the right. Take the Tour
// starts the guided tour (Tour.jsx). Start > Help or Programs > System Tools brings it back.
// Each page links to its 98ish Help topic (HELP_FOR), and each program to its own.

const REPO = "https://github.com/brandontaylor156/98ish"

// each page's topic in 98ish Help
const HELP_FOR = {
  home: ["help-home", "Browse all the help topics"],
  tour: ["welcome-tour", "More about the Welcome screen and Floppy"],
  computer: ["what-is-98ish", "More about what's here"],
  friends: ["online-play", "How playing online works"],
  couples: ["us-pairing", "Step by step: pairing up"],
  yours: ["display", "More ways to change the look"],
  involved: ["community-pages", "More about 98ish.com"],
}

const OPTIONS = [
  { id: "tour", label: "Take the Tour" },
  { id: "computer", label: "What's on this computer" },
  { id: "friends", label: "Play with friends" },
  { id: "couples", label: "For couples" },
  { id: "yours", label: "Make it yours" },
  { id: "involved", label: "Get involved" },
]

// What's on this computer, by kind. online: has a Play Online button
const SHELVES = [
  {
    id: "games",
    label: "Games",
    intro: "Over twenty games, old favorites and brand-new ones. A globe means you can play it online with other people.",
    items: [
      ["Tetris", "Classic blocks, plus online battles for 2 to 6", true],
      ["Pickleball 98", "3D pickleball with a World Tour", true],
      ["Shred 98", "Rock out to six original songs", false],
      ["Word Duel", "Guess the word, alone or in a race", true],
      ["Last Card", "The card game where you yell LAST CARD!", true],
      ["Monster Duel", "Build a deck of monsters and battle", true],
      ["Hexlands", "Settle, trade and build on an island", true],
      ["Sunny Acres", "Farm a little town, even together", true],
      ["Block Ten", "Fit the blocks, clear the lines", false],
      ["Solitaire", "The one everyone's boss caught them playing", false],
      ["Minesweeper", "Don't click the mines. Race someone online", true],
      ["Pinball", "Blue Screen: a 90s PC pinball table", false],
    ],
    more: "There's more in Start > Programs > Games: Chess, Checkers, Hearts, Battleship, Downhill, FreeCell...",
  },
  {
    id: "us",
    label: "Us",
    intro: "Little things for two people to share. Pair up first (see For couples), then these are just for the two of you.",
    items: [
      ["Us", "Pair up, send flowers, see your days together", false],
      ["Love Letters", "Letters that open on a day you choose", false],
      ["Calendar", "Your Us calendar: date nights, trips, reminders", false],
      ["Our Story", "Your photos on one shared timeline", false],
      ["Our Pet", "A pet you raise together", false],
      ["Lovebirds Quiz Show", "How well do you know each other?", true],
      ["Photo Puzzle", "Turn a photo into a puzzle with a secret message", false],
      ["Doodle Together", "Draw on the same page at the same time", true],
      ["Dream House", "Decorate a dollhouse together", false],
    ],
  },
  {
    id: "accessories",
    label: "Accessories",
    intro: "The handy little programs every computer came with. Your files are saved right here in this browser.",
    items: [
      ["Calendar", "Plan together: shared calendars and reminders", false],
      ["Clock", "World clocks, alarms, a timer, a stopwatch", false],
      ["Weather", "Today, the next 24 hours and 7 days, for your places", false],
      ["Address Book", "Everyone you know: screen names, phones, birthdays", false],
      ["Notepad", "Jot something down", false],
      ["WordPad", "Letters with fonts, colors and pictures", false],
      ["Camera", "Snap photos with retro effects, or a photo strip", false],
      ["Photos", "Your pictures: slideshows, crops, wallpaper", false],
      ["Paint", "Draw, then make it your wallpaper", false],
      ["Sound Recorder", "Record your voice, play it backwards", false],
      ["Calculator", "Sums, and a scientific mode", false],
      ["My Computer", "All your files and folders", false],
      ["MS-DOS Prompt", "Type commands like it's 1985", false],
    ],
  },
  {
    id: "internet",
    label: "Internet & Community",
    intro: "Talk to people, write to people, browse the real Web, and visit the old one.",
    items: [
      ["98 Messenger", "Chat with friends, set an away message", false],
      ["98ish Mail", "Send mail (and attachments) to any screen name", false],
      ["Network Neighborhood", "See who's on right now and play them", true],
      ["Compass", "The real, modern Web: tabs, bookmarks, search", false],
      ["Internet Explorer", "Visit websites the way they looked back then", false],
      ["HomePage Studio", "Build your own 1990s homepage", false],
      ["Media Player", "Eight songs made right here", false],
      ["YouTube '98", "Videos, in a tiny window", false],
    ],
  },
  {
    id: "appward",
    label: "Appward 98",
    intro: "An unofficial, just-for-fun tribute to Appward, a business suite, imagined as if it shipped in 1998.",
    items: [["Appward 98", "Conversations, boards, calendars, work orders and an App Creator, with made-up sample data", false]],
  },
]

const Globe = () => (
  <span className="welGlobe" title="Can be played online" aria-label="(can be played online)">
    <GlobeIcon size={14} />
  </span>
)

const Program = ({ name, blurb, online, onOpen }) => {
  const program = programByName(name)
  if (!program) return null
  return (
    <li className="welProgram">
      <img src={program.icon} alt="" width="32" height="32" draggable="false" />
      <span className="welProgramText">
        <b>
          {name}
          {online && <Globe />}
        </b>
        <span>{blurb}</span>
      </span>
      <button type="button" className="welHelpBtn" onClick={() => openHelp({ program: name })} aria-label={`Help for ${name}`} title={`Help for ${name}`}>
        ?
      </button>
      <button type="button" onClick={() => onOpen(name)} aria-label={`Open ${name}`}>
        Open
      </button>
    </li>
  )
}

// A short block of text with a heading and buttons
const Topic = ({ title, children, actions }) => (
  <section className="welTopic">
    <h3>{title}</h3>
    {children}
    {actions && <div className="welActions">{actions}</div>}
  </section>
)

const Welcome = ({ dispatch, mobile, onClose }) => {
  const prefs = useWelcome()
  const [page, setPage] = useState(mobile ? null : "home")
  const [shelf, setShelf] = useState("games")

  const open = (name, extra) => dispatch({ type: "open_window", payload: launch(name, extra) })
  const openPage = (url) => dispatch({ type: "open_window", payload: ieWindow(url) })
  const openReal = (url) => window.open(url, "_blank", "noopener")
  // (a function, not a component: a component made during render would be a new type each
  // time, and a re-render between press and release would swallow the click)
  const openButton = (name) => (
    <button key={name} type="button" onClick={() => open(name)}>
      Open {name}
    </button>
  )

  const resumeAt = !prefs.tourDone && prefs.tourStep > 0 && prefs.tourStep < TOUR_STEPS.length - 1 ? prefs.tourStep : 0
  const tour = (step) => {
    onClose()
    startTour(step, true)
  }

  const pick = (id) => {
    if (id === "close") return onClose()
    setPage(id)
  }

  const content = {
    home: (
      <>
        <h2>Hi there, and welcome!</h2>
        <p className="welLead">
          98ish is a whole make-believe computer from 1998 that lives in your web browser. It's full of games, little programs, and ways to hang
          out with your friends, and everything you make is saved right here.
        </p>
        <p>New here? The tour takes about a minute and shows you around. Or pick anything on the {mobile ? "list" : "left"} to read about it.</p>
        <div className="welActions">
          <button type="button" className="welBig" onClick={() => tour(resumeAt)}>
            {resumeAt ? "Continue the tour" : "Take the tour"}
          </button>
        </div>
      </>
    ),
    tour: (
      <>
        <h2>Take the Tour</h2>
        <p className="welLead">A quick walk around 98ish: the Start button, the taskbar, your desktop, windows, games you can play online, 98 Messenger and how to change the look.</p>
        <p>
          A yellow balloon points at each thing and explains it. {mobile ? "Tap Next" : "Click Next (or press Enter)"} to keep going. You can leave at any
          step{mobile ? "" : " with Esc"}, and come back to pick up where you left off.
        </p>
        <div className="welActions">
          {resumeAt ? (
            <>
              <button type="button" className="welBig" onClick={() => tour(resumeAt)}>
                Continue (step {resumeAt + 1} of {TOUR_STEPS.length})
              </button>
              <button type="button" onClick={() => tour(0)}>
                Start over
              </button>
            </>
          ) : (
            <button type="button" className="welBig" onClick={() => tour(0)}>
              {prefs.tourDone ? "Take the tour again" : "Start the tour"}
            </button>
          )}
        </div>
      </>
    ),
    computer: (
      <>
        <h2>What's on this computer</h2>
        <div className="welShelves" role="tablist" aria-label="Kinds of programs">
          {SHELVES.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={shelf === s.id} className={shelf === s.id ? "is-on" : ""} onClick={() => setShelf(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        {SHELVES.filter((s) => s.id === shelf).map((s) => (
          <div key={s.id} className="welShelf">
            <p>{s.intro}</p>
            <ul className="welPrograms">
              {s.items.map(([name, blurb, online]) => (
                <Program key={name} name={name} blurb={blurb} online={online} onOpen={open} />
              ))}
            </ul>
            {s.more && <p className="welSmall">{s.more}</p>}
          </div>
        ))}
      </>
    ),
    friends: (
      <>
        <h2>Play with friends</h2>
        <p className="welLead">98ish is more fun with other people, and they can be anywhere: on a phone, a laptop, across the world.</p>
        <Topic title="Play Online" actions={<>{openButton("Word Duel")}{openButton("Tetris")}</>}>
          <p>
            Every game for two or more has a <b>Play Online</b> button with a little globe. <b>Quick Match</b> finds someone to play right now.{" "}
            <b>Create Room</b> gives you a short code like K7QF (or a link) to send a friend; they choose Join with Code, and you're in the same game.
            Empty seats can be filled by the computer, and every game has its own chat.
          </p>
        </Topic>
        <Topic title="98 Messenger" actions={openButton("98 Messenger")}>
          <p>
            Make up a screen name and password, then add your friends as buddies to see when they're on, chat, and invite them straight into a game.
            Tick <b>Sign me on automatically</b> and this {mobile ? "phone" : "computer"} remembers you.
          </p>
          <p>
            An account is optional. Without one, everything stays on this {mobile ? "phone" : "computer"}. Signed on, your photos and files also sync to your account, so they're safe and on all your devices.{" "}
            <button type="button" className="welLinkBtn" onClick={() => openHelp("privacy-overview")}>
              What 98ish keeps
            </button>
          </p>
        </Topic>
        <Topic title="Network Neighborhood" actions={openButton("Network Neighborhood")}>
          <p>Shows every computer on 98ish right now. {mobile ? "Tap" : "Double-click"} one to send a file or a WinPopup note, or to challenge them to Checkers, Chess, Reversi, Battleship or Hearts.</p>
        </Topic>
        <p className="welSmall">The game server naps when nobody's around. If a game says it's waking up, give it up to a minute.</p>
      </>
    ),
    couples: (
      <>
        <h2>For couples</h2>
        <p className="welLead">Us turns 98ish into a little place just for the two of you.</p>
        <Topic title="Pair up (once)" actions={openButton("Us")}>
          <ol className="welSteps">
            <li>You both sign on to 98 Messenger, each with your own screen name.</li>
            <li>One of you opens Us and types the other's screen name.</li>
            <li>The other says yes. That's it: Us moves onto both your desktops.</li>
          </ol>
        </Topic>
        <Topic title="Then you can...">
          <ul className="welList">
            <li><b>Send flowers</b> that bloom on their desktop (they have to water them!)</li>
            <li><b>Write Love Letters</b> that stay sealed until the day you pick</li>
            <li><b>Keep Our Story</b>, a timeline of your photos, and show them as your wallpaper</li>
            <li><b>Plan dates</b> on your shared Us calendar in Calendar, with reminders for both of you</li>
            <li><b>Raise Our Pet</b> together, and decorate a <b>Dream House</b></li>
            <li><b>Play</b> the Lovebirds Quiz Show, Photo Puzzle and Doodle Together</li>
          </ul>
        </Topic>
        <p className="welSmall">What you share is private to the two of you. Nobody else can see it.</p>
      </>
    ),
    yours: (
      <>
        <h2>Make it yours</h2>
        <p className="welLead">Change how 98ish looks and sounds. It remembers your choices on this {mobile ? "phone" : "computer"}.</p>
        <Topic title="Wallpaper and colors" actions={openButton("Display Properties")}>
          <p>Pick a wallpaper (or one of your own photos), a color scheme for the title bars, and a screen saver.</p>
        </Topic>
        <Topic title="Desktop Themes" actions={openButton("Desktop Themes")}>
          <p>Change everything at once: Space, Underwater, Vaporwave, Dinosaurs, Kitty Café and more, with matching sounds and mouse pointers.</p>
        </Topic>
        <Topic title="Sounds and the taskbar" actions={<button type="button" onClick={() => shellAction("taskbar-properties")}>Taskbar settings</button>}>
          <p>The speaker by the clock sets the volume for every sound (or mutes it). Taskbar settings can hide the taskbar or the clock.</p>
        </Topic>
        <Topic title="Your desktop icons">
          <p>
            {mobile
              ? "Press and hold an icon, then drag it somewhere new. Press and hold an empty spot for a menu to make folders and notes."
              : "Drag icons wherever you like. Right-click the desktop: View changes the icon spacing, and Arrange Icons tidies them up."}
          </p>
        </Topic>
      </>
    ),
    involved: (
      <>
        <h2>Get involved</h2>
        <p className="welLead">98ish is made by real people, for fun. Here's how to say hi and leave your mark.</p>
        <Topic title="Sign the Guestbook" actions={<button type="button" onClick={() => openPage("http://www.98ish.com/guestbook")}>Open the Guestbook</button>}>
          <p>Leave a note for everyone who visits. It's the 1998 way of saying "I was here."</p>
        </Topic>
        <Topic
          title="Build a homepage"
          actions={
            <>
              {openButton("HomePage Studio")}
              <button type="button" onClick={() => openPage("http://www.98ish.com/members")}>See the Members</button>
            </>
          }
        >
          <p>Make your own page with marquees, clip art and a hit counter. Publish it and it joins the Members directory and the 98ish web ring.</p>
        </Topic>
        <Topic
          title="Ideas, bugs and code"
          actions={
            <>
              <button type="button" onClick={() => openReal(`${REPO}/issues`)}>Send feedback</button>
              <button type="button" onClick={() => openReal(REPO)}>98ish on GitHub</button>
            </>
          }
        >
          <p>
            Found something broken, or have an idea? Tell us on GitHub (opens in a new tab). 98ish is open source, so if you write code you can
            look inside and send improvements.
          </p>
        </Topic>
        <p className="welSmall">Made by Brandon Taylor and Cameron De Robertis. P.S. There are secrets hidden all over. My Computer &gt; Properties keeps score.</p>
      </>
    ),
  }

  const nav = (
    <nav className="welNav" aria-label="Welcome options">
      {[...OPTIONS, { id: "close", label: "Close" }].map((o) => {
        const Icon = OPTION_ICONS[o.id]
        return (
          <button key={o.id} type="button" className={"welOption" + (page === o.id ? " is-on" : "") + (o.id === "close" ? " welClose" : "")} data-option={o.id} onClick={() => pick(o.id)} aria-current={page === o.id ? "true" : undefined}>
            <Icon />
            <span>{o.label}</span>
          </button>
        )
      })}
    </nav>
  )

  const showNav = !mobile || page === null
  return (
    <div className={mobile ? "welRoot welMobile" : "welRoot"}>
      <header className="welBanner">
        <span className="welStars" aria-hidden="true" />
        <BannerComputer />
        <h1>
          <span>Welcome to</span> 98ish
        </h1>
      </header>
      <div className="welBody">
        {mobile && page === null && <p className="welPhoneIntro">Hi! 98ish is a make-believe computer from 1998, right in your browser. Tap anything below to read about it, or take the tour to look around.</p>}
        {showNav && nav}
        {page !== null && (
          <div className="welPanel" key={page} data-page={page}>
            {mobile && (
              <button type="button" className="welBack" onClick={() => setPage(null)}>
                {"◂"} Back
              </button>
            )}
            {content[page]}
            {HELP_FOR[page] && (
              <p className="welHelpLink">
                <a
                  href="#help"
                  onClick={(e) => {
                    e.preventDefault()
                    openHelp(HELP_FOR[page][0])
                  }}
                >
                  {HELP_FOR[page][1]}
                </a>{" "}
                in 98ish Help
              </p>
            )}
          </div>
        )}
      </div>
      <footer className="welFooter">
        <input id="wel-show" type="checkbox" checked={prefs.show !== false} onChange={(e) => setWelcome({ show: e.target.checked })} />
        <label htmlFor="wel-show">Show this screen each time 98ish starts</label>
      </footer>
    </div>
  )
}

export default Welcome
