import React from "react"

// Glyphs for the transport buttons, on a 16x16 grid in the button's text color

const Svg = ({ children }) => (
  <svg className="mpGlyph" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">
    {children}
  </svg>
)

const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.5 }

export const PlayGlyph = () => (
  <Svg>
    <path d="M5 3v10l7-5z" />
  </Svg>
)

export const PauseGlyph = () => (
  <Svg>
    <path d="M4 3h3v10h-3zM9 3h3v10h-3z" />
  </Svg>
)

export const StopGlyph = () => (
  <Svg>
    <path d="M4 4h8v8h-8z" />
  </Svg>
)

export const PrevGlyph = () => (
  <Svg>
    <path d="M2 4h2v8h-2zM9 4v8l-4-4zM14 4v8l-4-4z" />
  </Svg>
)

export const NextGlyph = () => (
  <Svg>
    <path d="M12 4h2v8h-2zM2 4v8l4-4zM7 4v8l4-4z" />
  </Svg>
)

export const ShuffleGlyph = () => (
  <Svg>
    <path d="M1 4.5h3.5l5 7h2.5M1 11.5h3.5l5-7h2.5" {...line} strokeWidth="1.4" />
    <path d="M12 2l3.5 2.5-3.5 2.5zM12 9l3.5 2.5-3.5 2.5z" />
  </Svg>
)

export const RepeatGlyph = () => (
  <Svg>
    <path d="M2.5 10V5.5h9M13.5 6v4.5h-9" {...line} strokeWidth="1.4" />
    <path d="M11 3l3.5 2.5-3.5 2.5zM5 8l-3.5 2.5 3.5 2.5z" />
  </Svg>
)

export const SpeakerGlyph = ({ muted }) => (
  <Svg>
    <path d="M1.5 6h3l4-3.5v11l-4-3.5h-3z" />
    {muted ? <path d="M10.5 5.5l4.5 5M15 5.5l-4.5 5" {...line} /> : <path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6.5 6.5 0 0 1 0 9" {...line} />}
  </Svg>
)
