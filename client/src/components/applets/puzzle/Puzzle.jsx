import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import FileDialog from "../notepad/FileDialog"
import { useAim } from "../aim/AimContext"
import { useNet } from "../network/NetContext"
import { fs, uniqueName, writeAndSave } from "../../../utils/fs"
import { launch } from "../../../utils/programs"
import { unlock } from "../../../utils/achievements"
import Jigsaw from "./JigsawBoard"
import SlidePuzzle from "./SlidePuzzle"
import Celebrate from "./Celebrate"
import { SAMPLES, samplePicture } from "./art"
import { MAX_CHARS, formatTime, loadImage, shrinkPicture } from "./image"
import { puzzleApi } from "./api"
import { useRecipients } from "./partner"
import { createSounds } from "./sounds"
import { bestFor, clearProgress, listProgress, loadPrefs, loadProgress, puzzleKey, recordBest, savePrefs, saveProgress } from "./store"
import { PIECE_COUNTS } from "./jigsaw.js"
import { SLIDE_SIZES } from "./slide.js"
import "./Puzzle.css"

// Photo Puzzle: turn a picture (a built-in one, one from the 98ish drive, or a photo from
// this device) into a jigsaw or a slide puzzle. Puzzles can be sent to someone (your
// partner, or any 98 Messenger buddy) with a hidden message that shows up when they solve
// it; the sender sees how long it took. Puzzles in progress are kept on this device.

const PHOTO_FOLDER = ["C:", "Documents", "Puzzle Photos"]
const MAX_MESSAGE = 500

const modeLabel = (setup) => (setup.mode === "slide" ? `Slide ${setup.size}x${setup.size}` : `Jigsaw, ${setup.pieces} pieces${setup.rotate ? ", rotating" : ""}`)

// C:\Documents\Puzzle Photos (made if needed)
const photoFolder = () => {
  let dir = fs.root
  for (const part of PHOTO_FOLDER) {
    let next = dir.getItem(part)
    if (!next || !next.isDirectory) next = fs.createDirectoryIn(dir, part)
    dir = next
  }
  return dir
}

const LoveLetterIcon = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect x="3" y="8" width="26" height="18" rx="1.5" fill="#fff4f7" stroke="#8a2f55" strokeWidth="1.5" />
    <path d="M3.8 9l12.2 9 12.2-9" fill="none" stroke="#8a2f55" strokeWidth="1.5" />
    <path d="M16 15.5c-1-1.9-4-1.2-4 1 0 2 2.5 3.2 4 4.6 1.5-1.4 4-2.6 4-4.6 0-2.2-3-2.9-4-1z" fill="#e0457b" />
  </svg>
)

const SentIcon = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <path d="M3 15L29 4l-6 24-7-8-4 6v-8z" fill="#cfe6ff" stroke="#24508a" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M12 18L29 4" stroke="#24508a" strokeWidth="1.5" />
  </svg>
)

const HeartIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <path d="M16 28C7 21 3 16 3 11a6.5 6.5 0 0 1 13-2 6.5 6.5 0 0 1 13 2c0 5-4 10-13 17z" fill="#ff5e8a" stroke="#8a2f55" strokeWidth="1.5" />
    <ellipse cx="10" cy="10" rx="2.5" ry="1.5" fill="#fff" opacity="0.7" transform="rotate(-35 10 10)" />
  </svg>
)

const PuzzleIcon = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <path d="M4 6h8a3 3 0 1 1 6 0h8v8a3 3 0 1 0 0 6v8h-8a3 3 0 1 0-6 0H4v-8a3 3 0 1 1 0-6z" fill="#ffb3c8" stroke="#8a2f55" strokeWidth="1.5" />
    <path d="M16 13c-1.4-2.6-5.5-1.6-5.5 1.4 0 2.7 3.4 4.4 5.5 6.3 2.1-1.9 5.5-3.6 5.5-6.3 0-3-4.1-4-5.5-1.4z" fill="#e0457b" />
  </svg>
)

const Puzzle = ({ mobile, onClose, onTitle, dispatch, handoff = null }) => {
  const aim = useAim()
  const net = useNet()
  const token = aim?.token || null
  const api = useMemo(() => puzzleApi(token), [token])
  const recipients = useRecipients()
  const soundsRef = useRef(null)
  if (!soundsRef.current) soundsRef.current = createSounds()
  const sounds = soundsRef.current

  const [view, setView] = useState("home") // home | new | play | inbox | sent
  const [prefs, setPrefsState] = useState(loadPrefs)
  const [choice, setChoice] = useState(null) // { source, picture, name } for a new puzzle
  const [setup, setSetup] = useState(() => ({ mode: "jigsaw", pieces: 24, size: 4, rotate: !!loadPrefs().rotate }))
  const [game, setGame] = useState(null)
  const [party, setParty] = useState(null)
  const [busy, setBusy] = useState(null)
  const [alert, setAlert] = useState(null)
  const [dialog, setDialog] = useState(null) // "open" | "send" | { kind: "resume", ... } | { kind: "delete", ... }
  const [boxes, setBoxes] = useState({ inbox: [], sent: [], loaded: false, error: null })
  const [toast, setToast] = useState(null)
  const [saved, setSaved] = useState(listProgress)
  const uploadRef = useRef(null)

  const setPrefs = (patch) => {
    setPrefsState((p) => ({ ...p, ...patch }))
    savePrefs(patch)
  }
  useEffect(() => {
    sounds.setOn(prefs.sound !== false)
  }, [prefs.sound])
  useEffect(() => {
    if (view === "home") setSaved(listProgress())
  }, [view])

  useEffect(() => {
    if (!onTitle) return
    onTitle(view === "play" && game ? `Photo Puzzle - ${game.title}` : "Photo Puzzle")
  }, [view, game?.title])

  // ---- the puzzle server ----

  const refresh = async () => {
    if (!token) return
    const result = await api.list()
    if (result.ok) setBoxes({ inbox: result.inbox, sent: result.sent, usage: result.usage, cap: result.cap, loaded: true, error: null })
    else setBoxes((b) => ({ ...b, loaded: true, error: result.error }))
  }
  useEffect(() => {
    refresh()
  }, [token])

  // live news: a puzzle came in, or one you sent was solved
  useEffect(() => {
    const socket = net?.socket
    if (!socket) return
    const onNew = (p) => {
      setToast({ text: `${p.from} sent you a puzzle: "${p.title}"`, view: "inbox" })
      refresh()
    }
    const onSolved = (p) => {
      setToast({ text: `${p.by} solved "${p.title}" in ${formatTime(p.ms)}!`, view: "sent" })
      refresh()
    }
    socket.on("puzzle:new", onNew)
    socket.on("puzzle:solved", onSolved)
    return () => {
      socket.off("puzzle:new", onNew)
      socket.off("puzzle:solved", onSolved)
    }
  }, [net?.socket, token])
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 7000)
    return () => clearTimeout(id)
  }, [toast])

  // ---- choosing a picture ----

  const pickSample = (sample) => setChoice({ source: { kind: "sample", id: sample.id }, name: sample.name, picture: { data: samplePicture(sample.id), width: 960, height: 720 } })

  const pickDriveFile = async (file) => {
    setDialog(null)
    setBusy("Opening the picture...")
    try {
      const picture = await shrinkPicture(file.textContent)
      setChoice({ source: { kind: "drive", id: fs.partsOf(file).join("/") }, name: file.name, picture })
    } catch (error) {
      setAlert(error.message || "That picture couldn't be opened.")
    } finally {
      setBusy(null)
    }
  }

  // a picture sent from Photos (Share > Use in Photo Puzzle): straight to a new puzzle
  useEffect(() => {
    if (!handoff?.file) return
    setGame(null)
    setView("new")
    pickDriveFile(handoff.file)
  }, [handoff?.id])

  const upload = async (file) => {
    if (!file) return
    setBusy("Getting your photo ready...")
    try {
      const picture = await shrinkPicture(file)
      const base = String(file.name || "Photo").replace(/\.[a-z0-9]+$/i, "").replace(/[\\/:"<>|]/g, "_").slice(0, 48) || "Photo"
      // kept on the drive, so the puzzle can be picked up again later
      let source = { kind: "upload", id: String(Date.now()) }
      try {
        const dir = photoFolder()
        const item = fs.createFileIn(dir, uniqueName(dir, base), "image", "")
        if (writeAndSave(item, picture.data, { created: true })) source = { kind: "drive", id: fs.partsOf(item).join("/") }
      } catch {
        // the drive is full: play it now, it just can't be resumed
      }
      setChoice({ source, name: base, picture })
    } catch (error) {
      setAlert(error.message || "That photo couldn't be opened.")
    } finally {
      setBusy(null)
    }
  }

  // ---- playing ----

  // A puzzle's picture, wherever it lives -> { picture, title } (or throws)
  const pictureFor = async (source) => {
    if (source.kind === "sample") {
      const sample = SAMPLES.find((s) => s.id === source.id) || SAMPLES[0]
      return { picture: { data: samplePicture(sample.id), width: 960, height: 720 }, name: sample.name }
    }
    if (source.kind === "drive") {
      const file = fs.resolve(source.id.split("/"))
      if (!file || !file.isImage || !file.textContent) throw new Error("That picture isn't on the drive anymore.")
      return { picture: await shrinkPicture(file.textContent), name: file.name }
    }
    if (source.kind === "inbox") {
      const result = await api.get(source.id)
      if (!result.ok) throw new Error(result.error)
      const img = await loadImage(result.puzzle.image)
      return { picture: { data: result.puzzle.image, width: img.naturalWidth, height: img.naturalHeight }, name: result.puzzle.title, puzzle: result.puzzle }
    }
    throw new Error("That picture can't be opened again.")
  }

  const start = async ({ source, picture, title, setup: how, resume = null, incoming = null }) => {
    setBusy("Cutting the pieces...")
    try {
      const img = await loadImage(picture.data)
      const key = puzzleKey(source, how)
      const seed = resume?.seed ?? Math.floor(Math.random() * 2 ** 31)
      setGame({ id: Date.now(), source, picture, img, title, setup: how, key, seed, initial: resume?.state || null, incoming, solved: false })
      setParty(null)
      setView("play")
    } catch (error) {
      setAlert(error.message || "That picture couldn't be opened.")
    } finally {
      setBusy(null)
    }
  }

  // Play (asks to continue one already in progress)
  const play = (from = choice, how = setup, extra = {}) => {
    const key = puzzleKey(from.source, how)
    const progress = from.source.kind === "upload" ? null : loadProgress(key)
    const go = (resume) => start({ source: from.source, picture: from.picture, title: extra.title || from.name, setup: how, resume, incoming: extra.incoming || null })
    if (progress) setDialog({ kind: "resume", go, progress })
    else go(null)
  }

  const resumeSaved = async (entry) => {
    setBusy("Opening the picture...")
    try {
      const { picture } = await pictureFor(entry.source)
      setBusy(null)
      start({ source: entry.source, picture, title: entry.title, setup: entry.setup, resume: entry, incoming: entry.incoming || null })
    } catch (error) {
      setBusy(null)
      setAlert(error.message)
    }
  }

  const openIncoming = async (header) => {
    setBusy("Opening the puzzle...")
    try {
      const { picture, puzzle } = await pictureFor({ kind: "inbox", id: header.id })
      setBusy(null)
      const how = puzzle.mode === "slide" ? { mode: "slide", size: puzzle.size } : { mode: "jigsaw", pieces: puzzle.pieces, rotate: puzzle.rotate }
      play({ source: { kind: "inbox", id: puzzle.id }, picture, name: puzzle.title }, how, { title: puzzle.title, incoming: { id: puzzle.id, from: puzzle.from, solved: !!puzzle.solvedAt, message: puzzle.message } })
    } catch (error) {
      setBusy(null)
      setAlert(error.message)
    }
  }

  const onProgress = (state) => {
    if (!game || game.source.kind === "upload") return
    saveProgress(game.key, { source: game.source, setup: game.setup, title: game.title, seed: game.seed, state, incoming: game.incoming ? { id: game.incoming.id, from: game.incoming.from } : null })
  }

  const onSolved = async (ms, moves) => {
    const g = game
    clearProgress(g.key)
    setSaved(listProgress())
    const before = bestFor(g.key)
    const best = recordBest(g.key, ms, moves) && !!before
    sounds.win()
    setGame((x) => x && { ...x, solved: true })
    if (g.setup.mode === "jigsaw") unlock("puzzle-solved")
    const incoming = g.incoming
    setParty({ time: ms, moves: g.setup.mode === "slide" ? moves : 0, best, from: incoming?.from || null, waiting: !!incoming, message: null })
    if (!incoming) return
    const result = await api.solved(incoming.id, ms, moves)
    setParty((p) => p && { ...p, waiting: false, message: result.ok ? result.message : incoming.message || "", error: result.ok ? null : result.error })
    refresh()
  }

  const restart = () => game && start({ source: game.source, picture: game.picture, title: game.title, setup: game.setup, incoming: game.incoming })

  // ---- sending ----

  const send = async ({ to, title, message }) => {
    let image = choice.picture.data
    if (image.length > MAX_CHARS || !/^data:image\/(png|jpeg|webp);/.test(image)) image = (await shrinkPicture(image)).data
    const result = await api.send({ to, title, message, mode: setup.mode, pieces: setup.pieces, size: setup.size, rotate: setup.rotate, image })
    if (result.ok) {
      setDialog(null)
      setToast({ text: `Your puzzle is on its way to ${result.puzzle.to}!`, view: "sent" })
      refresh()
    }
    return result
  }

  // ---- menus ----

  const unsolved = boxes.inbox.filter((p) => !p.solvedAt).length

  const menus = [
    {
      label: "Game",
      items: [
        { label: "New Puzzle...", onClick: () => setView("new") },
        { label: `Puzzles for Me${unsolved ? ` (${unsolved})` : ""}`, onClick: () => setView("inbox") },
        { label: "Puzzles I Sent", onClick: () => setView("sent") },
        "-",
        { label: "Start Over", disabled: !game || view !== "play", onClick: restart },
        { label: "Fit to Window", disabled: !game || view !== "play" || game.setup.mode !== "jigsaw", onClick: () => setGame((g) => ({ ...g, fit: Date.now() })) },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    {
      label: "Options",
      items: [
        { label: "Show Preview", checked: prefs.preview, onClick: () => setPrefs({ preview: !prefs.preview }) },
        { label: "Edge Pieces Only", checked: prefs.edges, onClick: () => setPrefs({ edges: !prefs.edges }) },
        { label: "Show Numbers (Slide)", checked: prefs.numbers, onClick: () => setPrefs({ numbers: !prefs.numbers }) },
        "-",
        { label: "Sound", checked: prefs.sound !== false, onClick: () => setPrefs({ sound: prefs.sound === false }) },
      ],
    },
  ]

  // ---- views ----

  const signedOut = !token && (
    <div className="pzSignedOut">
      <p>Sign on to 98 Messenger to send puzzles and get the ones sent to you.</p>
      <button type="button" onClick={() => dispatch?.({ type: "open_window", payload: launch("98 Messenger") })}>
        Open 98 Messenger
      </button>
    </div>
  )

  const home = (
    <div className="pzHome">
      <div className="pzHero">
        <PuzzleIcon size={48} />
        <div>
          <h2>Photo Puzzle</h2>
          <p>Turn any picture into a jigsaw or a slide puzzle, or send one to someone special with a secret message inside.</p>
        </div>
      </div>
      <div className="pzBigButtons">
        <button type="button" className="pzBig" onClick={() => setView("new")}>
          <span className="pzBigIcon"><PuzzleIcon size={36} /></span>
          <b>New Puzzle</b>
          <small>Pick a picture and cut it up</small>
        </button>
        <button type="button" className="pzBig" onClick={() => setView("inbox")}>
          <span className="pzBigIcon"><LoveLetterIcon size={36} /></span>
          <b>Puzzles for Me{unsolved ? <span className="pzBadge">{unsolved}</span> : null}</b>
          <small>Sent to you, with a hidden message</small>
        </button>
        <button type="button" className="pzBig" onClick={() => setView("sent")}>
          <span className="pzBigIcon"><SentIcon size={36} /></span>
          <b>Puzzles I Sent</b>
          <small>See how fast they solved them</small>
        </button>
      </div>
      {saved.length > 0 && (
        <div className="pzResume">
          <h3>Pick up where you left off</h3>
          <ul>
            {saved.map((entry) => {
              const placed = entry.state?.pieces ? entry.state.pieces.filter((p) => p.placed).length : null
              return (
                <li key={entry.key}>
                  <button type="button" onClick={() => resumeSaved(entry)}>
                    <b>{entry.title}</b>
                    <span>
                      {modeLabel(entry.setup)}
                      {placed !== null ? `, ${placed}/${entry.state.pieces.length} placed` : entry.state?.moves ? `, ${entry.state.moves} moves` : ""}
                      {entry.state?.elapsed ? `, ${formatTime(entry.state.elapsed)}` : ""}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )

  const best = choice ? bestFor(puzzleKey(choice.source, setup)) : null
  const newPuzzle = (
    <div className="pzNew">
      <fieldset>
        <legend>1. Choose a picture</legend>
        <div className="pzSamples">
          {SAMPLES.map((sample) => (
            <button
              type="button"
              key={sample.id}
              className={`pzSample${choice?.source.kind === "sample" && choice.source.id === sample.id ? " is-selected" : ""}`}
              onClick={() => pickSample(sample)}
              title={sample.name}
            >
              <img src={samplePicture(sample.id, 240, 180)} alt="" />
              <span>{sample.name}</span>
            </button>
          ))}
        </div>
        <div className="pzPickRow">
          <button type="button" onClick={() => setDialog("open")}>
            From My Computer...
          </button>
          <button type="button" onClick={() => uploadRef.current?.click()}>
            Upload a Photo...
          </button>
          <input ref={uploadRef} type="file" accept="image/*" hidden onChange={(e) => (upload(e.target.files?.[0]), (e.target.value = ""))} />
        </div>
        {choice && choice.source.kind !== "sample" && (
          <div className="pzChosen">
            <img src={choice.picture.data} alt="" />
            <span>{choice.name}</span>
          </div>
        )}
      </fieldset>
      <fieldset>
        <legend>2. What kind of puzzle?</legend>
        <div className="pzModeRow">
          <span className="field-row">
            <input id="pz-mode-jigsaw" type="radio" name="pz-mode" checked={setup.mode === "jigsaw"} onChange={() => setSetup({ ...setup, mode: "jigsaw" })} />
            <label htmlFor="pz-mode-jigsaw">Jigsaw</label>
          </span>
          <span className="field-row">
            <input id="pz-mode-slide" type="radio" name="pz-mode" checked={setup.mode === "slide"} onChange={() => setSetup({ ...setup, mode: "slide" })} />
            <label htmlFor="pz-mode-slide">Slide puzzle</label>
          </span>
        </div>
        {setup.mode === "jigsaw" ? (
          <>
            <div className="pzChips" role="group" aria-label="Pieces">
              {PIECE_COUNTS.map((n) => (
                <button type="button" key={n} className={setup.pieces === n ? "is-on" : ""} onClick={() => setSetup({ ...setup, pieces: n })}>
                  {n} pieces
                </button>
              ))}
            </div>
            <div className="field-row pzCheck">
              <input
                id="pz-rotate"
                type="checkbox"
                checked={setup.rotate}
                onChange={(e) => {
                  setSetup({ ...setup, rotate: e.target.checked })
                  setPrefs({ rotate: e.target.checked })
                }}
              />
              <label htmlFor="pz-rotate">Pieces can be turned (tap or right-click a piece to turn it)</label>
            </div>
          </>
        ) : (
          <div className="pzChips" role="group" aria-label="Size">
            {SLIDE_SIZES.map((n) => (
              <button type="button" key={n} className={setup.size === n ? "is-on" : ""} onClick={() => setSetup({ ...setup, size: n })}>
                {n} x {n}
              </button>
            ))}
          </div>
        )}
        {best && <p className="pzBest">Your best on this one: {formatTime(best.ms)}</p>}
      </fieldset>
      <div className="pzNewButtons">
        <button type="button" onClick={() => setView("home")}>
          Back
        </button>
        <button type="button" disabled={!choice} onClick={() => setDialog("send")}>
          Send to Someone...
        </button>
        <button type="button" className="pzPrimary" disabled={!choice} onClick={() => play()}>
          Play
        </button>
      </div>
    </div>
  )

  const listView = (which) => {
    const list = boxes[which]
    return (
      <div className="pzList">
        <div className="pzListHead">
          <button type="button" onClick={() => setView("home")}>
            Back
          </button>
          <h3>{which === "inbox" ? "Puzzles for Me" : "Puzzles I Sent"}</h3>
          <button type="button" onClick={refresh} disabled={!token}>
            Refresh
          </button>
        </div>
        {signedOut || (
          <>
            {boxes.error && <p className="pzError">{boxes.error}</p>}
            {boxes.loaded && list.length === 0 && (
              <p className="pzEmpty">{which === "inbox" ? "No puzzles yet. When someone sends you one, it shows up here." : "You haven't sent any puzzles. Make one with New Puzzle, then Send to Someone."}</p>
            )}
            <ul className="pzRows">
              {list.map((p) => (
                <li key={p.id} className={`pzRow${which === "inbox" && !p.solvedAt ? " is-new" : ""}`}>
                  <button type="button" className="pzRowMain" disabled={which === "sent"} onClick={() => openIncoming(p)}>
                    <span className="pzRowIcon">{p.solvedAt ? <HeartIcon /> : which === "inbox" ? <LoveLetterIcon size={24} /> : <SentIcon size={24} />}</span>
                    <span className="pzRowText">
                      <b>{p.title}</b>
                      <small>
                        {which === "inbox" ? `From ${p.from}` : `To ${p.to}`} · {p.mode === "slide" ? `Slide ${p.size}x${p.size}` : `${p.pieces} pieces`}
                      </small>
                      <small className="pzRowStatus">
                        {p.solvedAt ? `Solved in ${formatTime(p.solveMs)}` : which === "inbox" ? "Not solved yet" : "Waiting to be solved"}
                      </small>
                    </span>
                  </button>
                  <button type="button" className="pzRowDelete" aria-label="Delete" title="Delete" onClick={() => setDialog({ kind: "delete", puzzle: p })}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    )
  }

  const playView = game && (
    <div className="pzPlay">
      <div className="pzToolbar">
        <button type="button" onClick={() => setView("home")} title="Back">
          ◀ Back
        </button>
        <span className="pzToolTitle">{game.title}</span>
        {game.setup.mode === "jigsaw" ? (
          <>
            <button type="button" className={prefs.preview ? "is-on" : ""} onClick={() => setPrefs({ preview: !prefs.preview })} aria-pressed={prefs.preview} title="Show a faint picture on the board">
              Preview
            </button>
            <button type="button" className={prefs.edges ? "is-on" : ""} onClick={() => setPrefs({ edges: !prefs.edges })} aria-pressed={prefs.edges} title="Show only edge pieces">
              Edges
            </button>
          </>
        ) : (
          <button type="button" className={prefs.numbers ? "is-on" : ""} onClick={() => setPrefs({ numbers: !prefs.numbers })} aria-pressed={prefs.numbers}>
            123
          </button>
        )}
        {game.setup.mode === "slide" && (
          <button type="button" className="pzPeek" title="Peek at the picture" onPointerDown={() => setGame((g) => ({ ...g, peek: true }))} onPointerUp={() => setGame((g) => ({ ...g, peek: false }))} onPointerLeave={() => setGame((g) => (g.peek ? { ...g, peek: false } : g))}>
            Peek
          </button>
        )}
      </div>
      <div className="pzPlayArea">
        {game.setup.mode === "jigsaw" ? (
          <Jigsaw
            key={`${game.id}:${game.fit || 0}`}
            picture={game.picture}
            img={game.img}
            setup={game.setup}
            seed={game.seed}
            initial={game.initial}
            prefs={prefs}
            mobile={mobile}
            sounds={sounds}
            solved={game.solved}
            onChange={(state) => {
              game.initial = state
              onProgress(state)
            }}
            onSolved={onSolved}
          />
        ) : (
          <SlidePuzzle key={game.id} picture={game.picture} setup={game.setup} seed={game.seed} initial={game.initial} prefs={prefs} sounds={sounds} solved={game.solved} onChange={onProgress} onSolved={onSolved} />
        )}
        {game.peek && <img className="pzPeekImg" src={game.picture.data} alt="" />}
      </div>
    </div>
  )

  return (
    <div className={`pzApp${mobile ? " is-mobile" : ""}`}>
      <MenuBar menus={menus} />
      <div className="pzBody">
        {view === "home" && home}
        {view === "new" && newPuzzle}
        {view === "inbox" && listView("inbox")}
        {view === "sent" && listView("sent")}
        {view === "play" && (playView || home)}
      </div>

      {toast && (
        <button type="button" className="pzToast" onClick={() => (setView(toast.view), setToast(null))}>
          {toast.text}
        </button>
      )}

      {party && view === "play" && (
        <Celebrate
          {...party}
          onAgain={game?.incoming ? null : restart}
          onDone={() => {
            setParty(null)
            setSaved(listProgress())
          }}
        />
      )}

      {busy && (
        <div className="dialogBackdrop">
          <div className="window pzBusy">
            <div className="window-body">{busy}</div>
          </div>
        </div>
      )}

      {dialog === "open" && <FileDialog mode="open" accept={(item) => item.isImage} typeLabel="Pictures" fileType="image" onPick={pickDriveFile} onCancel={() => setDialog(null)} />}

      {dialog === "send" && choice && <SendDialog token={token} recipients={recipients} setup={setup} choice={choice} onSend={send} onCancel={() => setDialog(null)} onSignOn={() => dispatch?.({ type: "open_window", payload: launch("98 Messenger") })} />}

      {dialog?.kind === "resume" && (
        <Dialog
          title="Photo Puzzle"
          okLabel="Continue"
          noLabel="Start Over"
          onOk={() => {
            const d = dialog
            setDialog(null)
            d.go(d.progress)
          }}
          onNo={() => {
            const d = dialog
            setDialog(null)
            d.go(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">You have this puzzle in progress. Continue where you left off?</p>
        </Dialog>
      )}

      {dialog?.kind === "delete" && (
        <Dialog
          title="Delete Puzzle"
          okLabel="Delete"
          onOk={async () => {
            const p = dialog.puzzle
            setDialog(null)
            const result = await api.remove(p.id)
            if (!result.ok) setAlert(result.error)
            refresh()
          }}
          onCancel={() => setDialog(null)}
          sound="ding"
        >
          <p className="dialogText">Delete "{dialog.puzzle.title}"? It will be gone for both of you.</p>
        </Dialog>
      )}

      {alert && (
        <Dialog title="Photo Puzzle" onOk={() => setAlert(null)} sound="ding">
          <p className="dialogText">{alert}</p>
        </Dialog>
      )}
    </div>
  )
}

// To whom, a title, and the secret message they'll see once it's solved
const SendDialog = ({ token, recipients, setup, choice, onSend, onCancel, onSignOn }) => {
  const [to, setTo] = useState(recipients[0]?.screenName || "")
  const [title, setTitle] = useState(choice.name.slice(0, 60))
  const [message, setMessage] = useState("")
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)

  if (!token) {
    return (
      <Dialog title="Send a Puzzle" okLabel="Open 98 Messenger" onOk={() => (onSignOn(), onCancel())} onCancel={onCancel}>
        <p className="dialogText">Sign on to 98 Messenger first. Puzzles travel between 98 Messenger screen names.</p>
      </Dialog>
    )
  }

  const submit = async () => {
    if (!to.trim()) return setError("Choose who it's for.")
    setSending(true)
    setError(null)
    const result = await onSend({ to: to.trim(), title: title.trim(), message })
    setSending(false)
    if (!result.ok) setError(result.error)
  }

  return (
    <Dialog title="Send a Puzzle" okLabel={sending ? "Sending..." : "Send"} okDisabled={sending} onOk={submit} onCancel={onCancel}>
      <div className="pzSend">
        <img className="pzSendThumb" src={choice.picture.data} alt="" />
        <p className="pzSendWhat">{modeLabel(setup)}</p>
        <label htmlFor="pz-to">To:</label>
        <input id="pz-to" list="pz-to-list" value={to} maxLength={16} onChange={(e) => setTo(e.target.value)} placeholder="Screen name" autoComplete="off" />
        <datalist id="pz-to-list">
          {recipients.map((r) => (
            <option key={r.screenName} value={r.screenName}>
              {r.partner ? "♥ your partner" : r.online ? "online" : "offline"}
            </option>
          ))}
        </datalist>
        {recipients.length > 0 && (
          <div className="pzSendPeople">
            {recipients.slice(0, 6).map((r) => (
              <button type="button" key={r.screenName} className={r.screenName === to ? "is-on" : ""} onClick={() => setTo(r.screenName)}>
                {r.partner ? "♥ " : ""}
                {r.screenName}
              </button>
            ))}
          </div>
        )}
        <label htmlFor="pz-title">Title:</label>
        <input id="pz-title" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
        <label htmlFor="pz-message">Hidden message (shown when it's solved):</label>
        <textarea id="pz-message" rows={4} maxLength={MAX_MESSAGE} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write something sweet..." />
        <small className="pzCount">
          {message.length}/{MAX_MESSAGE}
        </small>
        {error && <p className="pzError">{error}</p>}
      </div>
    </Dialog>
  )
}

export default Puzzle
