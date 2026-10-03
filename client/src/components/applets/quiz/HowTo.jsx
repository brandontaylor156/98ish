import { useState } from "react"
import { Big, useQuiz } from "./parts"
import { setQuizData } from "./storage"

// "How to play": three short illustrated steps for a game, shown the first time you pick it
// (and again from its "How to play" button). Skippable.

const Svg = ({ children }) => (
  <svg className="qzHowArt" viewBox="0 0 96 72" width="96" height="72" aria-hidden="true">
    {children}
  </svg>
)
const heart = (x, y, s = 1, fill = "#ff4f8b") => (
  <path transform={`translate(${x} ${y}) scale(${s})`} d="M0 8C-6 4-8 1-8-2a4 4 0 0 1 8-1.5A4 4 0 0 1 8-2c0 3-2 6-8 10z" fill={fill} stroke="#a3123f" strokeWidth={1 / s} />
)
const phone = (x, y, screen) => (
  <g transform={`translate(${x} ${y})`}>
    <rect width="30" height="52" rx="5" fill="#2a1840" />
    <rect x="3" y="6" width="24" height="38" rx="2" fill="#fff6fa" />
    <circle cx="15" cy="48" r="2" fill="#6b4f8a" />
    {screen}
  </g>
)

const ART = {
  secret: (
    <Svg>
      {phone(33, 10, (
        <>
          <rect x="8" y="22" width="14" height="11" rx="2" fill="#ffd23f" stroke="#8a6d1a" />
          <path d="M10 22v-4a5 5 0 0 1 10 0v4" fill="none" stroke="#8a6d1a" strokeWidth="2" />
          {heart(15, 13, 0.7)}
        </>
      ))}
      <path d="M14 30h10M72 30h10M16 40h8M72 40h8" stroke="#c9a7ff" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  ),
  guess: (
    <Svg>
      <ellipse cx="54" cy="28" rx="26" ry="19" fill="#fff" stroke="#4a1f6e" strokeWidth="2" />
      <circle cx="30" cy="52" r="4" fill="#fff" stroke="#4a1f6e" strokeWidth="2" />
      <circle cx="22" cy="62" r="2.5" fill="#fff" stroke="#4a1f6e" strokeWidth="2" />
      <text x="54" y="37" textAnchor="middle" fontSize="26" fontWeight="bold" fontFamily="Arial Black, Arial" fill="#ff4f8b">?</text>
      {heart(76, 14, 0.6, "#ffb3cf")}
    </Svg>
  ),
  reveal: (
    <Svg>
      <rect x="10" y="12" width="34" height="46" rx="4" fill="#ffe3ef" stroke="#a3123f" strokeWidth="2" transform="rotate(-6 27 35)" />
      <rect x="52" y="12" width="34" height="46" rx="4" fill="#ffe3ef" stroke="#a3123f" strokeWidth="2" transform="rotate(6 69 35)" />
      {heart(27, 30, 1.1)}
      {heart(69, 30, 1.1)}
      <path d="M48 6l2 5 5 1-5 2-2 5-2-5-5-2 5-1z" fill="#ffd23f" />
      <path d="M8 6l1 3 3 1-3 1-1 3-1-3-3-1 3-1zM88 60l1 3 3 1-3 1-1 3-1-3-3-1 3-1z" fill="#ffd23f" />
    </Svg>
  ),
  pair: (
    <Svg>
      <rect x="8" y="14" width="36" height="44" rx="4" fill="#7ec8ff" stroke="#1d5f99" strokeWidth="2" />
      <rect x="52" y="14" width="36" height="44" rx="4" fill="#ffb86b" stroke="#a35a12" strokeWidth="2" />
      <text x="26" y="42" textAnchor="middle" fontSize="20" fontWeight="bold" fontFamily="Arial Black, Arial" fill="#fff">A</text>
      <text x="70" y="42" textAnchor="middle" fontSize="20" fontWeight="bold" fontFamily="Arial Black, Arial" fill="#fff">B</text>
      <text x="48" y="10" textAnchor="middle" fontSize="9" fontWeight="bold" fontFamily="Arial" fill="#4a1f6e">or</text>
    </Svg>
  ),
  pick: (
    <Svg>
      {phone(10, 10, <rect x="6" y="16" width="18" height="10" rx="2" fill="#7ec8ff" />)}
      {phone(56, 10, <rect x="6" y="16" width="18" height="10" rx="2" fill="#7ec8ff" />)}
      <path d="M44 34h8" stroke="#ff4f8b" strokeWidth="3" strokeLinecap="round" />
      {heart(48, 24, 0.7)}
    </Svg>
  ),
  score: (
    <Svg>
      <path d="M48 8l7 15 16 2-12 11 3 16-14-8-14 8 3-16-12-11 16-2z" fill="#ffd23f" stroke="#8a6d1a" strokeWidth="2" strokeLinejoin="round" />
      <text x="48" y="68" textAnchor="middle" fontSize="13" fontWeight="bold" fontFamily="Arial Black, Arial" fill="#ff4f8b">+100</text>
      <path d="M14 20l3 6M82 20l-3 6M10 40h6M80 40h6" stroke="#ff9ec4" strokeWidth="2.5" strokeLinecap="round" />
    </Svg>
  ),
  card: (
    <Svg>
      <rect x="30" y="6" width="40" height="56" rx="4" fill="#b49cff" stroke="#3d2a80" strokeWidth="2" transform="rotate(10 50 34)" />
      <rect x="24" y="8" width="40" height="56" rx="4" fill="#fff" stroke="#3d2a80" strokeWidth="2" />
      <path d="M31 22h26M31 30h26M31 38h18" stroke="#9a8ac9" strokeWidth="3" strokeLinecap="round" />
      {heart(44, 50, 0.8)}
    </Svg>
  ),
  talk: (
    <Svg>
      <rect x="6" y="8" width="46" height="28" rx="12" fill="#ffe3ef" stroke="#a3123f" strokeWidth="2" />
      <path d="M16 36l-4 10 12-10z" fill="#ffe3ef" stroke="#a3123f" strokeWidth="2" strokeLinejoin="round" />
      <rect x="44" y="30" width="46" height="28" rx="12" fill="#d8d0ff" stroke="#3d2a80" strokeWidth="2" />
      <path d="M80 58l4 10-12-10z" fill="#d8d0ff" stroke="#3d2a80" strokeWidth="2" strokeLinejoin="round" />
      <path d="M16 20h26M16 26h16M54 42h26M54 48h14" stroke="#9a6ab5" strokeWidth="2.5" strokeLinecap="round" />
    </Svg>
  ),
  fav: (
    <Svg>
      {heart(48, 34, 3)}
      <path d="M38 22a8 8 0 0 1 6-5" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
    </Svg>
  ),
  speed: (
    <Svg>
      <circle cx="48" cy="40" r="24" fill="#fff" stroke="#4a1f6e" strokeWidth="3" />
      <rect x="43" y="8" width="10" height="6" rx="2" fill="#4a1f6e" />
      <path d="M48 40V24M48 40l10 6" stroke="#ff4f8b" strokeWidth="3" strokeLinecap="round" />
      <path d="M8 30h14M4 40h16M8 50h14" stroke="#c9a7ff" strokeWidth="3" strokeLinecap="round" />
    </Svg>
  ),
  trophy: (
    <Svg>
      <path d="M32 8h32v18a16 16 0 0 1-32 0z" fill="#ffd23f" stroke="#8a6d1a" strokeWidth="2" />
      <path d="M32 14h-9a9 9 0 0 0 11 14M64 14h9a9 9 0 0 1-11 14" fill="none" stroke="#8a6d1a" strokeWidth="2.5" />
      <path d="M43 42h10v10H43z" fill="#ffd23f" stroke="#8a6d1a" strokeWidth="2" />
      <rect x="34" y="52" width="28" height="10" fill="#8a6d1a" />
      {heart(48, 20, 0.9)}
    </Svg>
  ),
}

export const HOW_TO = {
  knowme: {
    title: "How Well Do You Know Me?",
    steps: [
      { art: "secret", title: "Answer about yourself", text: "One of you answers a question about yourself. Secretly!" },
      { art: "guess", title: "They guess", text: "The other one guesses what you said." },
      { art: "reveal", title: "The big reveal", text: "Both answers flip over. A match scores points! Then you swap seats." },
    ],
  },
  tot: {
    title: "This or That",
    steps: [
      { art: "pair", title: "Two choices pop up", text: "Coffee or tea? Beach or mountains? You get two options." },
      { art: "pick", title: "Both of you pick", text: "Each of you picks a side, without peeking." },
      { art: "score", title: "Match to score", text: "Same pick? You both score! Streaks and double rounds add up." },
    ],
  },
  deep: {
    title: "Deep Talk Cards",
    steps: [
      { art: "card", title: "Draw a card", text: "Start light, or go deeper whenever you're ready." },
      { art: "talk", title: "Talk it through", text: "Take turns answering out loud. No points, no rush." },
      { art: "fav", title: "Keep the good ones", text: "Tap the heart to save a card you loved." },
    ],
  },
  trivia: {
    title: "Party Trivia",
    steps: [
      { art: "pair", title: "Same question for everyone", text: "Four answers, one is right." },
      { art: "speed", title: "Be quick", text: "Right answers score 100, plus up to 50 for speed." },
      { art: "trophy", title: "Top score wins", text: "Play live with friends, or practice on your own." },
    ],
  },
}

// The steps as an overlay. onDone: closed (skipped or finished); it's remembered as seen.
export const HowTo = ({ mode, onDone }) => {
  const { sounds } = useQuiz()
  const [i, setI] = useState(0)
  const how = HOW_TO[mode]
  const close = () => {
    setQuizData((d) => ({ howto: { ...d.howto, [mode]: true } }))
    onDone()
  }
  const step = how.steps[i]
  const last = i === how.steps.length - 1
  return (
    <div className="qzHowDim">
      <div className="qzHow" role="dialog" aria-label={`How to play ${how.title}`}>
        <div className="qzHowHead">
          <span>How to play</span>
          <button type="button" className="qzLink" onClick={close} data-action="skip">
            Skip
          </button>
        </div>
        <h3 className="qzHowTitle">{how.title}</h3>
        <ol className="qzHowSteps">
          {how.steps.map((s, k) => (
            <li key={k} className={k === i ? "is-on" : k < i ? "is-done" : ""}>
              {k + 1}
            </li>
          ))}
        </ol>
        <div className="qzHowCard" key={i}>
          {ART[step.art]}
          <b>
            {i + 1}. {step.title}
          </b>
          <p>{step.text}</p>
        </div>
        <div className="qzActions">
          {i > 0 && (
            <Big kind="is-alt" onClick={() => setI(i - 1)}>
              Back
            </Big>
          )}
          <Big onClick={() => (sounds.tap(), last ? close() : setI(i + 1))} data-action="how-next">
            {last ? "Got it, let's play!" : "Next"}
          </Big>
        </div>
      </div>
    </div>
  )
}
