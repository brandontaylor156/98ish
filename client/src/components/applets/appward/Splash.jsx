import React, { useEffect, useState } from "react"
import { flashOnBackdrop, useFloating } from "../../../hooks/useFloating"

// The way in: splash screen, sign-in, the first-time setup wizard, plus Help's About box
// and the Tip of the Day. Appward 98 is a fan-made tribute, and says so wherever its name
// is shown big.

// a dialog box without Dialog's OK/Cancel row, for ones with their own buttons; it floats
// and drags like Dialog (hooks/useFloating.js)
export const Win = ({ title, onClose, children, className = "" }) => {
  const floating = useFloating({ center: true })
  return (
    <div className="dialogBackdrop" onMouseDown={(e) => e.stopPropagation()} onPointerDown={flashOnBackdrop} onKeyDown={(e) => e.key === "Escape" && onClose?.()}>
      <div ref={floating} className={`window dialog ${className}`} role="dialog" aria-label={title}>
        <div className="title-bar">
          <div className="title-bar-text">{title}</div>
          <div className="title-bar-controls">
            <button type="button" aria-label="Close" onClick={onClose}></button>
          </div>
        </div>
        <div className="window-body dialogBody">{children}</div>
      </div>
    </div>
  )
}

export const TRIBUTE = "Appward 98 — an unofficial retro tribute. Visit appward.com for the real thing."

export const TributeNote = ({ className = "" }) => (
  <p className={`awTribute ${className}`}>
    Appward 98 — an unofficial retro tribute. Visit{" "}
    <a href="https://www.appward.com/" target="_blank" rel="noopener noreferrer">
      appward.com
    </a>{" "}
    for the real thing.
  </p>
)

// the "A" mark: a beveled tile, a big A and a forward swoosh (drawn for this tribute)
export const Logo = ({ size = 48 }) => (
  <svg className="awLogo" viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" shapeRendering="geometricPrecision">
    <defs>
      <linearGradient id="awLogoFill" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#00a0a0" />
        <stop offset="1" stopColor="#000080" />
      </linearGradient>
    </defs>
    <rect x="2.5" y="2.5" width="43" height="43" fill="#00305a" stroke="#000" />
    <rect x="4" y="4" width="40" height="40" fill="url(#awLogoFill)" />
    <path d="M4 4h40v2H6v38H4z" fill="#7fe0e0" />
    <path d="M14 38L22 10h6l8 28h-6.5l-1.8-6.5h-7.4L18.5 38zM21.6 26.5h4.8L24 17.5z" fill="#fff" stroke="#000" strokeWidth="1" strokeLinejoin="round" />
    <path d="M5 33c11-5 24-5 34-2l-2-4 8 5.5-9 4.5 2-3.5c-10-2.5-22-2.5-33 1.5z" fill="#ffd800" stroke="#000" strokeWidth="1" strokeLinejoin="round" />
  </svg>
)

export const Wordmark = () => (
  <span className="awWordmark">
    Appward<sup>98</sup>
  </span>
)

const STEPS = ["Loading your workspace...", "Starting the App Launcher...", "Indexing records for Search...", "Checking notifications...", "Ready."]

export const Splash = ({ onDone }) => {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (n >= 20) {
      const t = setTimeout(onDone, 250)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setN((x) => x + 1), 60 + (n % 7 === 3 ? 160 : 0))
    return () => clearTimeout(t)
  }, [n])
  return (
    <div className="awSplash" onDoubleClick={onDone}>
      <div className="awSplashCard">
        <div className="awSplashTop">
          <Logo size={72} />
          <div>
            <Wordmark />
            <div className="awSplashTag">Your business is special.</div>
          </div>
        </div>
        <div className="awSplashBottom">
          <div className="awSplashStatus" role="status">{STEPS[Math.min(STEPS.length - 1, Math.floor(n / 5))]}</div>
          <div className="awBlocks" role="progressbar" aria-valuemin={0} aria-valuemax={20} aria-valuenow={n} aria-label="Loading">
            {Array.from({ length: 20 }, (_, i) => (
              <span key={i} className={i < n ? "is-on" : ""} />
            ))}
          </div>
          <div className="awSplashFine">Release 1.0 · Build 1998</div>
          <TributeNote />
        </div>
      </div>
    </div>
  )
}

export const SignIn = ({ defaultName, messengerName, onSignIn, onCancel }) => {
  const [name, setName] = useState(defaultName || "")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const submit = (e) => {
    e.preventDefault()
    const clean = name.trim().replace(/\s+/g, " ")
    if (!/[a-z0-9]/i.test(clean)) return setError("Type your name to sign in.")
    if (clean.length > 40) return setError("That name is too long.")
    onSignIn(clean)
  }
  return (
    <div className="awSignWrap">
      <form className="window awSignIn" onSubmit={submit}>
        <div className="title-bar">
          <div className="title-bar-text">Sign In to Appward 98</div>
        </div>
        <div className="awSignBanner">
          <Logo size={40} />
          <div>
            <Wordmark />
            <div className="awSplashTag">Workspace Sign-In</div>
          </div>
        </div>
        <div className="window-body awSignBody">
          <div className="awSignKey" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="32" height="32" shapeRendering="crispEdges">
              <circle cx="10" cy="16" r="7" fill="#ffd800" stroke="#000" />
              <circle cx="8" cy="16" r="2" fill="#000" />
              <path d="M16 14h14v4h-3v4h-3v-4h-2v3h-3v-3h-3z" fill="#ffd800" stroke="#000" />
            </svg>
          </div>
          <div className="awSignFields">
            <p>Type your user name and password to sign in to your workspace.</p>
            <label className="awPickRow">
              <span><u>U</u>ser name:</span>
              <input type="text" value={name} onChange={(e) => { setName(e.target.value); setError("") }} autoFocus maxLength={40} aria-label="User name" />
            </label>
            <label className="awPickRow">
              <span><u>P</u>assword:</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password" />
            </label>
            <label className="awPickRow">
              <span>Workspace:</span>
              <select disabled aria-label="Workspace">
                <option>This computer</option>
              </select>
            </label>
            {error && <p className="awError" role="alert">{error}</p>}
            <p className="awMuted awSignHint">
              {messengerName ? `Signed on to 98 Messenger as ${messengerName}. ` : ""}Any name and password works here: your workspace is kept on this computer.
            </p>
          </div>
          <div className="awSignBtns">
            <button type="submit">OK</button>
            <button type="button" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </form>
    </div>
  )
}

// the first-time setup wizard
const WizardArt = () => (
  <svg className="awWizArt" viewBox="0 0 120 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="awWizSky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#000080" />
        <stop offset="1" stopColor="#008080" />
      </linearGradient>
    </defs>
    <rect width="120" height="260" fill="url(#awWizSky)" />
    {[[18, 40], [62, 64], [26, 108], [70, 132], [22, 176]].map(([x, y], i) => (
      <g key={i} transform={`translate(${x} ${y})`}>
        <rect width="34" height="26" fill="#c0c0c0" stroke="#000" />
        <rect x="1" y="1" width="32" height="5" fill={["#000080", "#800000", "#008000", "#808000", "#800080"][i]} />
        <rect x="4" y="10" width="20" height="2" fill="#808080" />
        <rect x="4" y="15" width="24" height="2" fill="#808080" />
        <rect x="4" y="20" width="14" height="2" fill="#808080" />
      </g>
    ))}
    <path d="M52 66 L60 74 M56 120 L68 132 M50 160 L62 176" stroke="#ffd800" strokeWidth="2" strokeDasharray="3 2" />
    <g transform="translate(36 214)">
      <Logo size={48} />
    </g>
  </svg>
)

export const Wizard = ({ name, onFinish, onCancel }) => {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({ company: "Acme Widgets Co.", me: name, title: "Team Member", sample: true })
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const canNext = step !== 1 || (form.company.trim() && form.me.trim())
  return (
    <div className="awSignWrap">
      <div className="window awWizard" role="dialog" aria-label="Appward 98 Setup Wizard">
        <div className="title-bar">
          <div className="title-bar-text">Appward 98 Setup Wizard</div>
        </div>
        <div className="window-body awWizardBody">
          <WizardArt />
          <div className="awWizardText">
            {step === 0 && (
              <>
                <h3>Welcome to Appward 98!</h3>
                <p>Let's set up your workspace.</p>
                <p>Appward 98 puts all of your business apps in one place: conversations, actions, projects, customers, tickets, parts, work orders, time off and more than seventy others, all linked together.</p>
                <p>This wizard takes about a minute. Click Next to continue.</p>
              </>
            )}
            {step === 1 && (
              <>
                <h3>About You</h3>
                <p>What's your company called, and who are you?</p>
                <label className="awPickRow">
                  <span>Company:</span>
                  <input type="text" value={form.company} onChange={(e) => set({ company: e.target.value })} maxLength={60} aria-label="Company" />
                </label>
                <label className="awPickRow">
                  <span>Your name:</span>
                  <input type="text" value={form.me} onChange={(e) => set({ me: e.target.value })} maxLength={40} aria-label="Your name" />
                </label>
                <label className="awPickRow">
                  <span>Job title:</span>
                  <input type="text" value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={40} aria-label="Job title" />
                </label>
              </>
            )}
            {step === 2 && (
              <>
                <h3>Sample Data</h3>
                <p>Would you like to start with a workspace full of made-up sample records? It's the quickest way to see what Appward 98 can do.</p>
                <div className="field-row">
                  <input type="radio" id="awSampleYes" name="awSample" checked={form.sample} onChange={() => set({ sample: true })} />
                  <label htmlFor="awSampleYes">Yes, fill my workspace with sample data (recommended)</label>
                </div>
                <div className="field-row">
                  <input type="radio" id="awSampleNo" name="awSample" checked={!form.sample} onChange={() => set({ sample: false })} />
                  <label htmlFor="awSampleNo">No, start with an empty workspace</label>
                </div>
                <p className="awMuted">The sample company, people and records are all fictional.</p>
              </>
            )}
            {step === 3 && (
              <>
                <h3>Ready to Go</h3>
                <p>Appward 98 has everything it needs to set up your workspace:</p>
                <ul>
                  <li>Company: <b>{form.company}</b></li>
                  <li>You: <b>{form.me}</b>, {form.title}</li>
                  <li>{form.sample ? "Sample data included" : "Empty workspace"}</li>
                </ul>
                <p>Click Finish to start using Appward 98.</p>
              </>
            )}
          </div>
        </div>
        <div className="awWizardBtns awWizardBtns--main">
          <button type="button" disabled={!step} onClick={() => setStep(step - 1)}>&lt; Back</button>
          {step < 3 ? (
            <button type="button" disabled={!canNext} onClick={() => setStep(step + 1)}>Next &gt;</button>
          ) : (
            <button type="button" onClick={() => onFinish({ ...form, company: form.company.trim(), me: form.me.trim(), title: form.title.trim() || "Team Member" })}>Finish</button>
          )}
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export const TIPS = [
  "Click the bell on the toolbar to see your notifications. Clicking one takes you straight to the record.",
  "Type @ and a name in Conversations to mention a coworker. They get a notification.",
  "Every record can be linked to any other record. Open one and click Link To... to try it.",
  "App Creator (under Development) builds a brand-new app from a list of fields. No programming!",
  "Press Ctrl+S to save the record you're working on, and Ctrl+N to make a new one.",
  "Search on the toolbar looks through every record in every app at once.",
  "Drag a card on the Actions, Leads or Tickets board to change its status.",
  "Report Builder makes a printable report from any app, with filters and totals.",
  "Issue Materials on a work order takes its parts out of inventory automatically.",
  "Approve or deny Time Off and Expenses right from the list: select a request and click Approve.",
  "Press F5 to sync your workspace. It's very fast. Suspiciously fast.",
  "Insights draws charts of your data. Click a bar to open that app.",
]

export const TipDialog = ({ index, show, onShow, onNext, onClose }) => (
  <Win title="Tip of the Day" onClose={onClose}>
    <div className="awTip">
      <div className="awTipSide" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="40" height="40">
          <path d="M16 3a9 9 0 0 1 5 16.5V23H11v-3.5A9 9 0 0 1 16 3z" fill="#ffff00" stroke="#000" />
          <rect x="11.5" y="23.5" width="9" height="5" fill="#c0c0c0" stroke="#000" />
          <path d="M14 13l2 4 2-4" fill="none" stroke="#a08000" />
        </svg>
      </div>
      <div className="awTipMain">
        <h4>Did you know...</h4>
        <p className="awTipText">{TIPS[index % TIPS.length]}</p>
      </div>
    </div>
    <div className="awTipFoot">
      <span className="awCheck">
        <input type="checkbox" id="awTipShow" checked={show} onChange={(e) => onShow(e.target.checked)} />
        <label htmlFor="awTipShow">Show tips at startup</label>
      </span>
      <span className="awGrow" />
      <button type="button" onClick={onNext}>Next Tip</button>
      <button type="button" onClick={onClose} autoFocus>Close</button>
    </div>
  </Win>
)

export const AboutDialog = ({ onClose }) => (
  <Win title="About Appward 98" onClose={onClose}>
    <div className="awAbout">
      <Logo size={56} />
      <div>
        <Wordmark />
        <p>Release 1.0 (Build 1998)</p>
        <p className="awAboutTag">"Don't settle for ordinary software."</p>
        <TributeNote />
        <p className="awMuted">A fan-made homage for 98ish. The sample company, people and records are fictional. Your workspace is stored only in this browser.</p>
      </div>
    </div>
    <div className="dialogButtons">
      <button type="button" onClick={onClose} autoFocus>OK</button>
    </div>
  </Win>
)
