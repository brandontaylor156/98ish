import { useEffect, useRef, useState } from "react"
import { unlockAudio } from "../../../mediaPlayer/audio"
import { masterGain, subscribeSettings } from "../../../../../utils/settings"

// A homepage's background music: one of the Media Player's songs, looping, played by the
// Media Player's own synth. Browsers only allow sound after the visitor clicks, so it
// starts on the first click in the page (or the Play button). The synth loads on demand.
export const usePageMusic = (songId) => {
  const [state, setState] = useState("idle") // idle | loading | playing | stopped
  const engineRef = useRef(null)
  const wanted = useRef(false)

  const destroy = () => {
    wanted.current = false
    engineRef.current?.destroy()
    engineRef.current = null
  }

  useEffect(() => {
    setState("idle")
    return destroy
  }, [songId])

  // the taskbar volume and mute, as they change
  useEffect(() => subscribeSettings((s) => engineRef.current?.setVolume(0.7 * masterGain(s))), [])

  // Call inside a click/tap
  const play = () => {
    if (!songId) return
    unlockAudio()
    wanted.current = true
    if (engineRef.current) {
      engineRef.current.play()
      setState("playing")
      return
    }
    setState("loading")
    const id = songId
    Promise.all([import("../../../mediaPlayer/engine"), import("../../../mediaPlayer/songs")])
      .then(([{ createEngine }, { songById }]) => {
        const song = songById(id)
        if (!wanted.current || id !== songId || !song) return
        const engine = createEngine({
          // loop forever, as background MIDIs did
          onEnd: () => engineRef.current === engine && wanted.current && engine.play(),
        })
        if (!engine) return setState("stopped")
        engine.load(song)
        engine.setVolume(0.7 * masterGain())
        engineRef.current = engine
        engine.play()
        setState("playing")
      })
      .catch(() => setState("stopped"))
  }

  const stop = () => {
    wanted.current = false
    engineRef.current?.pause()
    setState("stopped")
  }

  return { state, play, stop }
}
