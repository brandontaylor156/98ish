// Twin Clones UI (inside Twin Replay, inside Pickleball 98): make a clone from a player in a
// game, and the clones list (play one, share your own, open a friend's, delete).

import React, { useRef, useState, useSyncExternalStore } from "react"
import Dialog from "../../../../shared/Dialog"
import Combo from "../../../../shared/select/Combo"
import { filePayload, shareOut } from "../../../../../utils/share"
import { CHARACTERS } from "../../looks.js"
import { LEVELS } from "../../ai.js"
import { describe, fitProfile, fromCloneFile, knowOf, MAX_CLONE_BYTES, toCloneFile } from "./profile.js"
import { deleteClone, listClones, saveClone, subscribeClones } from "./store.js"

let cache = null
const snapshot = () => (cache ??= listClones())
subscribeClones(() => (cache = null))
export const useClones = () => useSyncExternalStore(subscribeClones, snapshot, snapshot)

const LEVEL_OPTIONS = Object.entries(LEVELS).map(([k, v]) => [k, v.label])
const LOOK_OPTIONS = [["", "Pick for me"], ...CHARACTERS.filter((c) => !c.boss).map((c) => [c.id, c.nick])]

// the "how much we know" meter
export const KnowMeter = ({ profile }) => {
  const k = knowOf(profile)
  const words = k < 0.25 ? "A first guess" : k < 0.6 ? "Getting to know them" : k < 0.9 ? "Knows their game" : "Plays just like them"
  return (
    <span className="pkCloneMeter" title={`${profile.evidence?.shots || 0} of their shots seen`}>
      <span className="pkCloneMeterBar">
        <span style={{ width: `${Math.round(k * 100)}%` }} />
      </span>
      <small>{words}</small>
    </span>
  )
}

// Make (or add to) a clone of one player in a game
export const CloneDialog = ({ game, playerId, onClose, onSaved }) => {
  const clones = useClones()
  const player = game.analysis.players.find((p) => p.id === playerId)
  const [name, setName] = useState(player?.name || "Clone")
  const [me, setMe] = useState(false)
  const [base, setBase] = useState("intermediate")
  const [look, setLook] = useState("")
  const [into, setInto] = useState(() => clones.find((c) => c.name === player?.name && c.origin !== "shared")?.id || "")
  const [error, setError] = useState(null)
  const mine = clones.filter((c) => c.origin !== "shared")
  const save = () => {
    const prev = into ? mine.find((c) => c.id === into) : null
    const gameId = game.demo ? `demo:${game.id || "rally"}` : game.id
    const profile = fitProfile([{ analysis: game.analysis, playerId, gameId }], {
      name: prev ? prev.name : name.trim() || "Clone",
      base: prev ? prev.base : base,
      hand: player?.hand ?? null,
      origin: prev ? (me || prev.origin === "self" ? "self" : "video") : me ? "self" : "video",
      character: prev ? prev.character : look || null,
      prev,
    })
    // which player this clone was in which game (Rematch finds them)
    profile.sources = [...(prev?.sources || []).filter((s) => s.game !== gameId), { game: gameId, player: playerId }].slice(-50)
    if (!saveClone(profile)) return setError("There's no room on this device for another clone.")
    onSaved?.(profile)
    onClose()
  }
  return (
    <Dialog title={`Make a Clone of ${player?.name || "this player"}`} okLabel="Save Clone" onOk={save} onCancel={onClose}>
      <div className="pkCloneForm">
        <p className="pkMuted">The clone learns how they play from this game: where they stand, their shot choices and where they hit it. More games make it more like them.</p>
        {mine.length > 0 && (
          <label className="pkField">
            <span>Clone</span>
            <Combo value={into} name="cloneInto" ariaLabel="Make a new clone or add to one" options={[["", "A new clone"], ...mine.map((c) => [c.id, `Add to ${c.name}`])]} onChange={setInto} />
          </label>
        )}
        {!into && (
          <>
            <label className="pkField">
              <span>Name</span>
              <input data-selectable value={name} maxLength={24} onChange={(e) => setName(e.target.value)} data-field="cloneName" />
            </label>
            <label className="pkField">
              <span>Starts from</span>
              <Combo value={base} name="cloneBase" ariaLabel="Level it starts from" options={LEVEL_OPTIONS} onChange={setBase} />
            </label>
            <label className="pkField">
              <span>Looks like</span>
              <Combo value={look} name="cloneLook" ariaLabel="Which player they look like" options={LOOK_OPTIONS} onChange={setLook} />
            </label>
          </>
        )}
        <label className="pkCloneCheck">
          <input type="checkbox" checked={me} onChange={(e) => setMe(e.target.checked)} data-field="cloneMe" /> This is me (I can share my clone with friends)
        </label>
        {!me && <p className="pkMuted">A clone of someone else stays on this device, labeled "Built from your video". To play their clone together, they make and share their own.</p>}
        {error && <p className="pkTwinError">{error}</p>}
      </div>
    </Dialog>
  )
}

// read a .clone file a friend sent
const readCloneFile = async (file) => {
  if (file.size > MAX_CLONE_BYTES) throw new Error("That clone file is too big.")
  return fromCloneFile(JSON.parse(await file.text()))
}

// The clones list
export const ClonesPanel = ({ onPlay, onBack }) => {
  const clones = useClones()
  const fileRef = useRef(null)
  const [error, setError] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const share = (c) => {
    const data = new Blob([JSON.stringify(toCloneFile(c))], { type: "application/json" })
    const name = `${c.name.replace(/[^\w -]+/g, "").slice(0, 24) || "Clone"}.clone98.json`
    shareOut(filePayload(`${c.name}'s Pickleball 98 clone`, { name, data, mime: "application/json" }, { text: "My Pickleball 98 clone: open it in Pickleball 98 > Twin Replay > Your clones > Open a friend's clone." }), "apps", { title: "Twin Clone" })
  }
  const open = async (file) => {
    setError(null)
    try {
      const c = await readCloneFile(file)
      saveClone(c)
    } catch (e) {
      setError(e.message || "That isn't a Pickleball 98 clone.")
    }
  }
  return (
    <div className="pkTwinScroll">
      <div className="pkPanel window pkClones">
        <b className="pkTwinBig">Your clones</b>
        <p className="pkMuted">Computer players that play like real people, learned from Twin Replay games. Pick one under Play &gt; Against (or as your partner).</p>
        {clones.length === 0 && <p>No clones yet. Open a game, go to Stats and press Make a Clone under a player.</p>}
        <ul className="pkTwinList">
          {clones.map((c) => (
            <li key={c.id} className="pkClone" data-clone={c.id}>
              <div>
                <b>{c.name}</b>{" "}
                <small className="pkMuted">
                  {c.origin === "self" ? "you" : c.origin === "shared" ? `from ${c.from || "a friend"}` : "Built from your video"} · {LEVELS[c.base]?.label}
                </small>
              </div>
              <KnowMeter profile={c} />
              <small className="pkMuted">{describe(c).join(" · ")}</small>
              <div className="pkTwinButtons">
                <button type="button" className="pkPrimary" onClick={() => onPlay(c.id)} data-action="clone-play">
                  Play {c.name}
                </button>
                {c.origin === "self" && (
                  <button type="button" onClick={() => share(c)} data-action="clone-share">
                    Share...
                  </button>
                )}
                <button type="button" onClick={() => setConfirm(c)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && open(e.target.files[0])} />
        <div className="pkTwinButtons">
          <button type="button" onClick={() => fileRef.current?.click()}>
            Open a friend's clone...
          </button>
          <button type="button" onClick={onBack}>
            Back
          </button>
        </div>
        {error && <p className="pkTwinError">{error}</p>}
      </div>
      {confirm && (
        <Dialog title="Delete Clone" okLabel="Delete" onOk={() => (deleteClone(confirm.id), setConfirm(null))} onCancel={() => setConfirm(null)}>
          <p>Delete the clone of {confirm.name}? Your games stay.</p>
        </Dialog>
      )}
    </div>
  )
}
