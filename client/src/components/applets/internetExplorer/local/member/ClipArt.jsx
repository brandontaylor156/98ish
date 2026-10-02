import React from "react"

// Animated clip art for member homepages, in the spirit of the GIFs every 1998 homepage
// had. All original drawings: SVG shapes moved by CSS animations (see member.css).

const Construction = () => (
  <svg className="caConstruction" viewBox="0 0 180 64" width="180" height="64">
    <circle className="caBeacon" cx="12" cy="12" r="7" fill="#ff8a00" />
    <circle className="caBeacon caBeacon--b" cx="168" cy="12" r="7" fill="#ff8a00" />
    <rect x="22" y="8" width="136" height="48" rx="3" fill="#ffd800" stroke="#000" strokeWidth="3" />
    <rect className="caStripes" x="22" y="48" width="136" height="8" fill="url(#caStripe)" />
    <defs>
      <pattern id="caStripe" width="12" height="8" patternUnits="userSpaceOnUse" patternTransform="skewX(-40)">
        <rect width="6" height="8" fill="#000" />
      </pattern>
    </defs>
    <g className="caWorker">
      <circle cx="38" cy="20" r="4" fill="#000" />
      <path d="M38 24v10l-5 8M38 34l5 8M38 27l8-4" stroke="#000" strokeWidth="3" fill="none" strokeLinecap="round" />
      <g className="caShovel">
        <path d="M46 23l8 14" stroke="#7a4a20" strokeWidth="2.5" />
        <path d="M51 35l7 4-3 5-6-5z" fill="#777" />
      </g>
    </g>
    <text x="104" y="27" textAnchor="middle" fontFamily="Arial Black, Arial, sans-serif" fontWeight="900" fontSize="12" fill="#000">
      UNDER
    </text>
    <text x="104" y="42" textAnchor="middle" fontFamily="Arial Black, Arial, sans-serif" fontWeight="900" fontSize="12" fill="#000">
      CONSTRUCTION
    </text>
  </svg>
)

const Globe = () => (
  <svg className="caGlobe" viewBox="0 0 80 80" width="80" height="80">
    <defs>
      <clipPath id="caGlobeClip">
        <circle cx="40" cy="40" r="30" />
      </clipPath>
      <radialGradient id="caGlobeShine" cx="35%" cy="30%" r="70%">
        <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
        <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity="0.35" />
      </radialGradient>
    </defs>
    <circle cx="40" cy="40" r="30" fill="#1f5fd1" />
    <g clipPath="url(#caGlobeClip)">
      <g className="caLand">
        {[0, 80].map((x) => (
          <g key={x} transform={`translate(${x} 0)`} fill="#3fb83f">
            <path d="M6 22c6-6 14-4 16 2s-2 10 2 14-2 12-8 10-6-8-10-10-6-10 0-16z" />
            <path d="M32 14c6-2 12 0 14 4s-4 6-2 10 8 4 8 10-6 6-10 4-4-8-8-10-8-14-2-18z" />
            <path d="M58 40c4-4 12-2 14 4s-2 14-8 16-8-4-8-8 0-8 2-12z" />
            <path d="M28 52c4-2 8 2 8 6s-4 8-8 6-4-10 0-12z" />
          </g>
        ))}
      </g>
      <g stroke="#fff" strokeOpacity="0.35" fill="none" strokeWidth="1">
        <ellipse cx="40" cy="40" rx="30" ry="10" />
        <ellipse cx="40" cy="40" rx="12" ry="30" />
        <path d="M10 40h60M40 10v60" />
      </g>
    </g>
    <circle cx="40" cy="40" r="30" fill="url(#caGlobeShine)" stroke="#0a2a6a" strokeWidth="2" />
  </svg>
)

const FLAME = "M10 40C2 32 4 22 9 16c0 6 3 8 5 8-2-8 2-16 8-22 0 8 6 12 8 20 2-3 2-6 1-9 6 6 8 16 2 27-4 6-17 6-23 0z"

const Flames = () => (
  <svg className="caFlames" viewBox="0 0 200 44" width="200" height="44" preserveAspectRatio="none">
    {Array.from({ length: 6 }, (_, i) => (
      <g key={i} transform={`translate(${i * 33} 0)`}>
        <path className={`caFlame caFlame--${i % 3}`} d={FLAME} fill="#ff3b00" />
        <path className={`caFlame caFlame--${(i + 1) % 3}`} d={FLAME} fill="#ffb000" transform="translate(6 12) scale(0.7)" />
        <path className={`caFlame caFlame--${(i + 2) % 3}`} d={FLAME} fill="#fff27a" transform="translate(11 24) scale(0.42)" />
      </g>
    ))}
  </svg>
)

const Mailbox = () => (
  <svg className="caMailbox" viewBox="0 0 90 80" width="90" height="80">
    <rect x="38" y="44" width="8" height="34" fill="#7a4a20" />
    <path d="M14 26a14 14 0 0 1 28 0v22H14z" fill="#2050c0" stroke="#0a1f5a" strokeWidth="2" />
    <path d="M28 12h34a14 14 0 0 1 14 14v22H42V26a14 14 0 0 0-14-14z" fill="#3a70e0" stroke="#0a1f5a" strokeWidth="2" />
    <g className="caLetter">
      <rect x="18" y="20" width="22" height="14" fill="#fff" stroke="#555" />
      <path d="M18 20l11 8 11-8" fill="none" stroke="#555" />
    </g>
    <g className="caFlag">
      <rect x="74" y="20" width="3" height="22" fill="#555" />
      <rect x="77" y="20" width="10" height="7" fill="#e00020" />
    </g>
    <text x="45" y="64" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="bold" fontSize="9" fill="#fff" stroke="#000" strokeWidth="2" paintOrder="stroke">
      MAIL ME!
    </text>
  </svg>
)

const BURST = Array.from({ length: 24 }, (_, i) => {
  const r = i % 2 ? 24 : 38
  const a = (i / 24) * Math.PI * 2
  return `${(40 + Math.cos(a) * r).toFixed(1)},${(40 + Math.sin(a) * r).toFixed(1)}`
}).join(" ")

const NewBurst = () => (
  <svg className="caNew" viewBox="0 0 80 80" width="72" height="72">
    <polygon className="caBurst" points={BURST} fill="#ff2040" stroke="#ffe100" strokeWidth="3" />
    <text x="40" y="47" textAnchor="middle" fontFamily="Arial Black, Arial, sans-serif" fontWeight="900" fontSize="18" fill="#ffe100" stroke="#800" strokeWidth="1">
      NEW!
    </text>
  </svg>
)

// Dumpling: a round, fuzzy little creature (98ish's own) who dances on every homepage
const Dancer = () => (
  <svg className="caDancer" viewBox="0 0 80 84" width="80" height="84">
    <ellipse cx="40" cy="80" rx="20" ry="3" fill="#000" opacity="0.25" />
    <g className="caDancerBody">
      <path className="caFootL" d="M28 66c-6 2-8 8-2 8h8z" fill="#c9773c" />
      <path className="caFootR" d="M52 66c6 2 8 8 2 8h-8z" fill="#c9773c" />
      <circle cx="22" cy="20" r="8" fill="#e8a25e" stroke="#7a4a20" strokeWidth="2" />
      <circle cx="58" cy="20" r="8" fill="#e8a25e" stroke="#7a4a20" strokeWidth="2" />
      <circle cx="22" cy="20" r="4" fill="#ffb3c0" />
      <circle cx="58" cy="20" r="4" fill="#ffb3c0" />
      <ellipse cx="40" cy="46" rx="26" ry="27" fill="#f2b56b" stroke="#7a4a20" strokeWidth="2" />
      <ellipse cx="40" cy="54" rx="15" ry="14" fill="#fff1d6" />
      <circle cx="31" cy="38" r="4" fill="#000" />
      <circle cx="49" cy="38" r="4" fill="#000" />
      <circle cx="32.5" cy="36.5" r="1.3" fill="#fff" />
      <circle cx="50.5" cy="36.5" r="1.3" fill="#fff" />
      <ellipse cx="40" cy="45" rx="3" ry="2" fill="#7a3a20" />
      <path d="M35 49q5 5 10 0" fill="none" stroke="#7a3a20" strokeWidth="2" strokeLinecap="round" />
      <circle cx="25" cy="47" r="3.5" fill="#ff8aa0" opacity="0.7" />
      <circle cx="55" cy="47" r="3.5" fill="#ff8aa0" opacity="0.7" />
      <path className="caArmL" d="M16 46q-10-6-8-16" fill="none" stroke="#c9773c" strokeWidth="5" strokeLinecap="round" />
      <path className="caArmR" d="M64 46q10-6 8-16" fill="none" stroke="#c9773c" strokeWidth="5" strokeLinecap="round" />
    </g>
  </svg>
)

const Rainbow = () => (
  <div className="caRainbow" role="presentation">
    <span />
  </div>
)

const ART = { construction: Construction, globe: Globe, flames: Flames, mailbox: Mailbox, new: NewBurst, dancer: Dancer, rainbow: Rainbow }

const ClipArt = ({ id, label }) => {
  const Art = ART[id]
  if (!Art) return null
  return (
    <span className={`clipArt clipArt--${id}`} role="img" aria-label={label || id}>
      <Art />
    </span>
  )
}

export default ClipArt
