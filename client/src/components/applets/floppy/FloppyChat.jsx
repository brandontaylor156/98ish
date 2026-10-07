import React, { useEffect, useRef, useState } from "react"
import Dialog from "../../shared/Dialog"
import MoreOptions from "../../shared/MoreOptions"
import { openResult } from "../../../utils/search"
import { openHelp } from "../../../utils/help"
import { describeCall } from "./floppyCore"
import { ask, runTool } from "./floppyTools"
import { brainBytes, brainChosen, deleteBrain, generate, getBrain, loadBrain, pickleballOpen, unloadBrain, useBrain } from "./brain"
import { runAgent, runPlan } from "./hands"
import { makeProgram } from "./vbgen"
import { launch } from "../../../utils/programs"
import "./Floppy.css"

// Ask Floppy: a little chat in Floppy's bubble. Plain commands work at once (the rule-based
// fallback); with a brain (an opt-in on-device model) he understands much more. Anything that
// sends or changes something shows a confirm box first.

const mb = (bytes) => `${Math.round(bytes / 1e6)} MB`

// "Show me each step": each control is outlined and named before Floppy presses it
const SHOW_KEY = "98ish.floppy.showMe"
const showMeOn = () => {
  try {
    return localStorage.getItem(SHOW_KEY) !== "off"
  } catch {
    return true
  }
}

const FloppyChat = ({ windows, dispatch, first, onClose, mobile }) => {
  const brain = useBrain()
  const [log, setLog] = useState([]) // { from: "you" | "floppy", text, results?, help? }
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [streaming, setStreaming] = useState("")
  const [confirm, setConfirm] = useState(null)
  const [offer, setOffer] = useState(false)
  const [cached, setCached] = useState(0)
  const [working, setWorking] = useState(null) // { stop: AbortController } while Floppy works a window
  const [question, setQuestion] = useState(null) // { text, resolve }: a yes/no before a risky step
  const [showMe, setShowMe] = useState(showMeOn)
  const history = useRef([])
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const asked = useRef(false)

  const say = (entry) => setLog((l) => [...l, entry].slice(-30))

  // the memory goes when Floppy closes, or when Pickleball 98 opens
  useEffect(() => () => unloadBrain(), [])
  const pbOpen = pickleballOpen(windows)
  useEffect(() => {
    if (pbOpen && brain.status === "ready") unloadBrain()
  }, [pbOpen])

  useEffect(() => {
    listRef.current?.scrollTo?.({ top: 1e6 })
  }, [log.length, streaming])

  useEffect(() => {
    brainBytes().then(setCached)
  }, [brain.status])

  const wake = async () => {
    if (!brainChosen() || brain.status === "ready" || pbOpen) return
    try {
      await loadBrain(windows)
    } catch (e) {
      if (e.message !== "pickleball") say({ from: "floppy", text: "My brain wouldn't wake up. I can still do the simple things!" })
    }
  }

  const send = async (q) => {
    const question = String(q ?? text).trim()
    if (!question || busy) return
    setText("")
    say({ from: "you", text: question })
    setBusy(true)
    try {
      await wake()
      let tokens = ""
      const out = await ask(question, {
        history: history.current,
        dispatch,
        onToken: (t) => {
          tokens += t
          // only show replies, not the JSON of a tool call
          if (!tokens.trimStart().startsWith('{"tool"')) setStreaming(tokens.replace(/^\s*\{\s*"reply"\s*:\s*"?/, "").replace(/"\s*\}?\s*$/, ""))
        },
      })
      setStreaming("")
      history.current = [...history.current, { role: "user", content: question }, ...(out.raw ? [{ role: "assistant", content: out.raw }] : [])].slice(-8)
      if (out.operate) await operate(out.operate)
      else if (out.agent) await operateWithBrain(out.agent)
      else if (out.program) await writeProgram(out.program)
      else if (out.confirm) setConfirm(out.confirm)
      else if (out.call) say({ from: "floppy", text: out.result.text, results: out.result.results })
      else say({ from: "floppy", text: out.reply, help: out.help })
    } catch (e) {
      setStreaming("")
      say({ from: "floppy", text: `Oops, something went wrong: ${e.message}` })
    } finally {
      setBusy(false)
      inputRef.current?.focus({ preventScroll: true })
    }
  }

  // a yes/no in the bubble (a risky step, a private window)
  const yesNo = (text) => new Promise((resolve) => setQuestion({ text, resolve }))
  const answer = (yes) => {
    question?.resolve(yes)
    setQuestion(null)
  }

  // Floppy works 98ish's windows: a recipe's steps, shown one by one (Stop any time)
  const io = (stop) => ({
    dispatch,
    windows,
    signal: stop.signal,
    showMs: showMe ? 900 : 150,
    confirm: yesNo,
    narrate: (t) => say({ from: "floppy", text: t, step: true }),
    runTool: (call) => runTool(call, { dispatch }),
  })
  const operate = async (plan) => {
    const stop = new AbortController()
    setWorking({ stop })
    say({ from: "floppy", text: `On it: ${plan.title}.` })
    try {
      const r = await runPlan(plan, io(stop))
      say({ from: "floppy", text: r.ok ? "All done!" : r.stopped ? "Okay, I stopped." : `I got stuck: ${r.error}` })
    } finally {
      setWorking(null)
    }
  }
  const operateWithBrain = async (goal) => {
    const stop = new AbortController()
    setWorking({ stop })
    say({ from: "floppy", text: "Let me look at this window..." })
    try {
      const r = await runAgent(goal, { ...io(stop), generate: (m) => generate(m, { max: 60 }) })
      say({ from: "floppy", text: r.ok ? r.say || "Done!" : r.stopped ? "Okay, I stopped." : `I got stuck: ${r.error}` })
    } finally {
      setWorking(null)
    }
  }

  // "make me a program that...": built, checked, and opened in Visual Basic 98 ready to Run or Send
  const writeProgram = async (request) => {
    say({ from: "floppy", text: "Writing your program..." })
    const r = await makeProgram(request, { generate: getBrain().status === "ready" ? (m) => generate(m, { max: 400 }) : null, today: new Date().toDateString() })
    if (!r.ok) return say({ from: "floppy", text: r.error })
    dispatch({ type: "open_window", payload: launch("Visual Basic 98", { handoff: { id: Date.now(), edit: r.project } }) })
    say({ from: "floppy", text: `Here's "${r.project.name}" in Visual Basic 98. Press Run (F5) to try it${r.kind === "poll" || r.kind === "countdown" ? ", or Send it in Messenger so friends can join in" : ""}.`, program: true })
  }

  useEffect(() => {
    if (first && !asked.current) {
      asked.current = true
      send(first)
    }
  }, [])

  const doIt = async () => {
    const call = confirm
    setConfirm(null)
    setBusy(true)
    try {
      const r = await runTool(call, { dispatch })
      say({ from: "floppy", text: r.text, results: r.results })
    } finally {
      setBusy(false)
    }
  }

  const getBrain = async () => {
    setOffer(false)
    say({ from: "floppy", text: "Downloading my brain... it only happens once." })
    try {
      await loadBrain(windows)
      say({ from: "floppy", text: "Ding! I'm smarter now. Ask me anything about 98ish." })
    } catch (e) {
      say({ from: "floppy", text: e.message === "pickleball" ? "Close Pickleball 98 first: it needs the memory." : `The download didn't finish: ${e.message}` })
    }
  }

  const status =
    brain.status === "downloading" || brain.status === "loading"
      ? `Getting my brain: ${brain.total ? `${mb(brain.loaded)} of ${mb(brain.total)}` : "starting..."}`
      : brain.status === "ready"
        ? `Brain on (${brain.model?.name}, ${brain.device === "webgpu" ? "graphics chip" : "processor"})${brain.stats?.tps ? ` · ${brain.stats.tps} words/s` : ""}`
        : brainChosen()
          ? pbOpen
            ? "Brain napping while Pickleball 98 plays"
            : "Brain asleep: it wakes when you ask something new"
          : "Simple commands only"

  return (
    <div className={`flChat${mobile ? " is-mobile" : ""}`} data-floppy-chat>
      <div className="flTop">
        <b>Ask Floppy</b>
        <button type="button" className="flClose" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="flLog" ref={listRef} data-selectable>
        {log.length === 0 && <p className="flHint">Try: "open Paint", "remind me to stretch at 7", "start pickleball practice", "how do I lock my computer?"</p>}
        {log.map((m, i) => (
          <div key={i} className={`flMsg flMsg--${m.from}`} data-from={m.from} data-step={m.step ? "" : undefined}>
            <p>{m.text}</p>
            {m.results?.length > 0 && (
              <ul className="flResults">
                {m.results.map((r, j) => (
                  <li key={j}>
                    <button type="button" onClick={() => openResult(r, dispatch)}>
                      {r.title || r.item?.name} <small>{r.group}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {m.help?.length > 0 && (
              <ul className="flResults">
                {m.help.map((h) => (
                  <li key={h.id}>
                    <button type="button" onClick={() => openHelp(h.id)} data-help-link={h.id}>
                      Open "{h.title}"
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {streaming && (
          <div className="flMsg flMsg--floppy">
            <p>{streaming}</p>
          </div>
        )}
        {busy && !streaming && !working && <p className="flThinking">Floppy is thinking...</p>}
        {question && (
          <div className="flQuestion" data-floppy-question>
            <p>{question.text}</p>
            <button type="button" onClick={() => answer(true)} data-answer="yes">
              Yes
            </button>
            <button type="button" onClick={() => answer(false)} data-answer="no">
              No
            </button>
          </div>
        )}
        {working && !question && (
          <button type="button" className="flStop" onClick={() => working.stop.abort()} data-action="stop">
            Stop
          </button>
        )}
      </div>
      <form
        className="flAsk"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <input ref={inputRef} type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask Floppy..." aria-label="Ask Floppy" maxLength={300} autoFocus={!mobile} data-floppy-input />
        <button type="submit" disabled={busy || !text.trim()}>
          Ask
        </button>
      </form>
      <MoreOptions id="floppy.brain" className="flMore" summary={status}>
        <div className="field-row">
          <input
            id="fl-showme"
            type="checkbox"
            checked={showMe}
            onChange={(e) => {
              setShowMe(e.target.checked)
              try {
                localStorage.setItem(SHOW_KEY, e.target.checked ? "on" : "off")
              } catch {
                // this visit only
              }
            }}
          />
          <label htmlFor="fl-showme">Show me each step when I work a window</label>
        </div>
        <p className="flStatus" data-brain-status={brain.status}>
          {status}
        </p>
        {(brain.status === "downloading" || brain.status === "loading") && <progress max="1" value={brain.progress || 0} />}
        {!brainChosen() && brain.status !== "downloading" && brain.status !== "loading" && (
          <button type="button" onClick={() => setOffer(true)} data-action="get-brain">
            Give Floppy a brain...
          </button>
        )}
        {brainChosen() && (
          <button
            type="button"
            onClick={async () => {
              await deleteBrain()
              say({ from: "floppy", text: "Brain deleted. Back to simple commands!" })
            }}
            data-action="delete-brain"
          >
            Delete Floppy's brain{cached ? ` (${mb(cached)})` : ""}
          </button>
        )}
      </MoreOptions>
      {offer && (
        <Dialog title="Give Floppy a brain?" okLabel="Download" onOk={getBrain} onCancel={() => setOffer(false)}>
          <div className="flOffer">
            <p>Floppy can understand plain English with a small AI model that runs only on this device. Nothing you type is sent anywhere.</p>
            <p>It's a one-time download of about 500 MB from Hugging Face, so Wi-Fi is best. You can delete it any time.</p>
          </div>
        </Dialog>
      )}
      {confirm && (
        <Dialog title="Floppy wants to..." okLabel="Do it" onOk={doIt} onCancel={() => (setConfirm(null), say({ from: "floppy", text: "Okay, I won't." }))}>
          <p className="flConfirm" data-confirm={confirm.tool}>
            {describeCall(confirm)}
          </p>
        </Dialog>
      )}
    </div>
  )
}

export default FloppyChat
