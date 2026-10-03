import { HOST_NAME } from "./shared/show.js"

// Lulu, the Quiz Show's host: a peach-faced lovebird in a bow tie with a microphone (drawn
// here), and her speech bubble. mood: "happy" | "wow" | "sad" | "wink"

export const Lulu = ({ size = 64, mood = "happy" }) => (
  <svg className={`qzLulu is-${mood}`} viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
    {/* tail and body */}
    <path d="M14 50l-9 9 13-4z" fill="#2f9e6e" stroke="#1d5f45" strokeWidth="1.2" strokeLinejoin="round" />
    <ellipse cx="30" cy="40" rx="18" ry="17" fill="#5cc98d" stroke="#1d5f45" strokeWidth="1.5" />
    <ellipse cx="31" cy="46" rx="11" ry="9" fill="#a6ecc4" />
    {/* wing holding the microphone */}
    <path d="M17 38c-4 6-2 13 5 15 3-5 3-11-5-15z" fill="#3fb07a" stroke="#1d5f45" strokeWidth="1.2" />
    <rect x="44" y="34" width="4" height="13" rx="1.5" fill="#444" transform="rotate(20 46 40)" />
    <circle cx="49" cy="32" r="5" fill="#9aa3ad" stroke="#333" strokeWidth="1.2" />
    <path d="M46 30.5h6M45.5 33h7" stroke="#6b7480" strokeWidth="0.9" />
    <path d="M40 44c3 1 6 0 7-3" stroke="#3fb07a" strokeWidth="4" fill="none" strokeLinecap="round" />
    {/* head: a peach face */}
    <circle cx="31" cy="20" r="14" fill="#5cc98d" stroke="#1d5f45" strokeWidth="1.5" />
    <path d="M22 22c0-9 6-13 13-12 6 1 9 6 8 12-1 6-6 9-11 9-6 0-10-3-10-9z" fill="#ff9a76" />
    <path d="M27 9c2-5 6-6 9-4-3 0-5 2-6 5z" fill="#2f9e6e" />
    {/* eyes and cheeks */}
    {mood === "wink" ? (
      <path d="M29 18q2.5-2 5 0" stroke="#241433" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    ) : (
      <>
        <circle cx="31.5" cy="18" r={mood === "wow" ? 3.4 : 2.8} fill="#fff" stroke="#241433" strokeWidth="0.8" />
        <circle cx={mood === "sad" ? 31.5 : 32.3} cy={mood === "sad" ? 19 : 17.6} r="1.7" fill="#241433" />
        <circle cx="32.8" cy="17" r="0.6" fill="#fff" />
      </>
    )}
    {mood === "sad" && <path d="M28 14.5l5 1.2" stroke="#241433" strokeWidth="1.2" strokeLinecap="round" />}
    <ellipse cx="26" cy="24" rx="2.6" ry="1.6" fill="#ff5f8f" opacity="0.55" />
    {/* beak */}
    <path d="M38 19c5 0 7 3 6 6-2 1-5 1-7-1z" fill="#ffcf4a" stroke="#a36a00" strokeWidth="1" strokeLinejoin="round" />
    {mood === "wow" ? <ellipse cx="40.5" cy="25" rx="1.6" ry="1.9" fill="#7a1240" /> : <path d="M37.5 23.5c2 1.3 4.5 1.4 6.3 0.6" stroke="#a36a00" strokeWidth="0.9" fill="none" />}
    {/* bow tie */}
    <path d="M24 33l7 3-7 3zM38 33l-7 3 7 3z" fill="#ff4f8b" stroke="#a3123f" strokeWidth="1" strokeLinejoin="round" />
    <circle cx="31" cy="36" r="2" fill="#ffd23f" stroke="#a3123f" strokeWidth="0.8" />
    {/* feet */}
    <path d="M25 56v4M23 60h4M35 56v4M33 60h4" stroke="#e08a3c" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

// Lulu says something. size "big" on title screens and round cards, "small" in a corner.
export const Host = ({ line, mood = "happy", size = "small", name = true, className = "" }) => (
  <div className={`qzHost is-${size} ${className}`} role="status" aria-live="polite">
    <Lulu size={size === "big" ? 84 : 52} mood={mood} />
    <div className="qzSpeech">
      {name && <b className="qzHostName">{HOST_NAME}</b>}
      <span key={line}>{line}</span>
    </div>
  </div>
)
