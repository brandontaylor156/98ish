import React, { useState } from "react"
import { coupleApi } from "../../../utils/couple"
import { COLORS, DEFAULT_LOOK, NAME_IDEAS, PALETTE, SPECIES } from "./catalog"
import { Creature, Dice, Heart } from "./PetArt"
import { playPetSound } from "./sounds"

// Adopting: pick a kind of creature, its colors and a name. Your partner can suggest a
// different name afterwards (and you say yes or no).

const Swatches = ({ label, value, onPick, name }) => (
  <div className="petSwatches" role="radiogroup" aria-label={label}>
    <span className="petSwatchLabel">{label}</span>
    {COLORS.map((id) => (
      <button
        key={id}
        type="button"
        role="radio"
        aria-checked={value === id}
        aria-label={`${PALETTE[id].label} ${name}`}
        className={value === id ? "petSwatch is-on" : "petSwatch"}
        style={{ background: PALETTE[id].fill, borderColor: PALETTE[id].line }}
        onClick={() => onPick(id)}
      />
    ))}
  </div>
)

const Adopt = ({ couple, onAdopted }) => {
  const [species, setSpecies] = useState("bunnycat")
  const [look, setLook] = useState(DEFAULT_LOOK)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const colors = look[species]
  const setColor = (key, id) => setLook({ ...look, [species]: { ...colors, [key]: id } })
  const idea = () => {
    const pool = NAME_IDEAS.filter((n) => n !== name)
    setName(pool[Math.floor(Math.random() * pool.length)])
  }

  const adopt = async (e) => {
    e.preventDefault()
    if (!name.trim()) return setError("Every little one needs a name!")
    setBusy(true)
    setError(null)
    const r = await coupleApi("POST", "/pet/adopt", { species, name: name.trim(), body: colors.body, accent: colors.accent, tz: new Date().getTimezoneOffset() })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    playPetSound("family")
    onAdopted(r)
  }

  return (
    <form className="petAdopt" onSubmit={adopt}>
      <div className="petAdoptHead">
        <Heart size={18} />
        <h2>Adopt a little one</h2>
        <Heart size={18} />
      </div>
      <p className="petAdoptIntro">You and {couple.partner} will raise it together: feed it, play, cuddle and tuck it in. It grows up as you look after it.</p>
      <div className="petSpeciesGrid" role="radiogroup" aria-label="Kind of pet">
        {SPECIES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={species === s.id}
            className={species === s.id ? "petSpecies is-on" : "petSpecies"}
            onClick={() => {
              setSpecies(s.id)
              playPetSound("chirp")
            }}
          >
            <Creature species={s.id} body={look[s.id].body} accent={look[s.id].accent} stage="baby" expression={species === s.id ? "happy" : "okay"} size={74} />
            <b>{s.label}</b>
            <span>{s.blurb}</span>
          </button>
        ))}
      </div>
      <div className="petAdoptLook">
        <div className="petAdoptPreview">
          <Creature species={species} body={colors.body} accent={colors.accent} stage="baby" expression="happy" size={120} className="is-bounce" />
        </div>
        <div className="petAdoptFields">
          <Swatches label="Color" name="body" value={colors.body} onPick={(id) => setColor("body", id)} />
          <Swatches label={species === "mochi" ? "Leaf" : species === "dragon" ? "Wings" : "Ears"} name="accent" value={colors.accent} onPick={(id) => setColor("accent", id)} />
          <label className="petNameLabel" htmlFor="pet-name">
            Name
          </label>
          <div className="petNameRow">
            <input id="pet-name" value={name} maxLength={16} autoComplete="off" placeholder="Mochi" onChange={(e) => setName(e.target.value)} />
            <button type="button" className="petDice" onClick={idea} title="Suggest a name" aria-label="Suggest a name">
              <Dice />
            </button>
          </div>
        </div>
      </div>
      {error && <p className="petError">{error}</p>}
      <button type="submit" className="petBig petAdoptGo" disabled={busy}>
        {busy ? "Bringing them home..." : `Adopt ${name.trim() || "them"} ♥`}
      </button>
    </form>
  )
}

export default Adopt
