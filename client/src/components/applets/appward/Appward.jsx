import React, { useEffect, useState } from "react"
import { useCouple } from "../../../utils/couple"
import { playSystemSound } from "../../../utils/systemSounds"
import { closeWorkspace, lastUser, openWorkspace, readWorkspace, useWorkspace } from "./store.js"
import { newWorkspace } from "./seed.js"
import { Splash, SignIn, Wizard } from "./Splash.jsx"
import Shell from "./Shell.jsx"
import "./Appward.css"

// Appward 98: an unofficial, fan-made retro tribute to Appward (appward.com), imagined as
// the Windows 98 client it never shipped. Splash, sign-in, a setup wizard the first time,
// then the workspace (Shell.jsx). Data stays in this browser (store.js).

export default function Appward({ mobile, onTitle, onClose }) {
  const [phase, setPhase] = useState("splash")
  const [user, setUser] = useState("")
  const [firstRun, setFirstRun] = useState(false)
  const couple = useCouple()
  const messengerName = couple?.me || ""
  const { ws, rev } = useWorkspace()

  useEffect(() => {
    if (phase === "splash") onTitle?.("Appward 98")
    if (phase === "signin") onTitle?.("Appward 98 - Sign In")
    if (phase === "wizard") onTitle?.("Appward 98 - Setup")
  }, [phase])

  // the workspace closes with the window
  useEffect(() => () => closeWorkspace(), [])

  const signIn = (name) => {
    setUser(name)
    const saved = readWorkspace(name)
    if (saved) {
      openWorkspace(name, saved)
      setFirstRun(false)
      setPhase("shell")
      playSystemSound("ding")
    } else setPhase("wizard")
  }

  const finishWizard = ({ company, me, title, sample }) => {
    openWorkspace(user, newWorkspace({ company, me, title, sample }))
    setFirstRun(true)
    setPhase("shell")
    playSystemSound("tada")
  }

  return (
    <div className={`awRoot ${mobile ? "is-mobile" : ""}`}>
      {phase === "splash" && <Splash onDone={() => setPhase("signin")} />}
      {phase === "signin" && <SignIn defaultName={lastUser() || messengerName} messengerName={messengerName} onSignIn={signIn} onCancel={onClose} />}
      {phase === "wizard" && <Wizard name={user} onFinish={finishWizard} onCancel={() => setPhase("signin")} />}
      {phase === "shell" && ws && (
        <Shell
          ws={ws}
          rev={rev}
          mobile={mobile}
          user={user}
          firstRun={firstRun}
          onTitle={onTitle}
          onExit={onClose}
          onSignOut={() => {
            closeWorkspace()
            setPhase("signin")
          }}
        />
      )}
    </div>
  )
}
