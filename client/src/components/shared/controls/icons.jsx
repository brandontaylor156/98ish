// Pixel-style glyphs for on-screen buttons. SVG rather than arrow characters, which iOS
// draws as color emoji. Use as a control's `icon`: icon: GLYPHS.left
const Glyph = ({ children, size = 20 }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" shapeRendering="crispEdges" fill="currentColor">
    {children}
  </svg>
)

export const GLYPHS = {
  left: <Glyph><path d="M10 3v10L4 8z" /></Glyph>,
  right: <Glyph><path d="M6 3v10l6-5z" /></Glyph>,
  up: <Glyph><path d="M3 11h10L8 5z" /></Glyph>,
  down: <Glyph><path d="M3 5h10l-5 6z" /></Glyph>,
  hardDrop: <Glyph size={36}><path d="M3 2h10l-5 5zM3 8h10l-5 5zM3 14h10v1H3z" /></Glyph>,
  rotateRight: <Glyph><path d="M8 2a6 6 0 1 0 6 6h-2a4 4 0 1 1-4-4v2l4-3-4-3z" /></Glyph>,
  rotateLeft: <Glyph><path d="M8 2a6 6 0 1 1-6 6h2a4 4 0 1 0 4-4v2L4 3l4-3z" /></Glyph>,
  pause: <Glyph><path d="M4 3h3v10H4zM9 3h3v10H9z" /></Glyph>,
}

// Small cog for the "customize controls" button
export const GearIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <circle cx="8" cy="8" r="4.3" fill="none" stroke="currentColor" strokeWidth="2.6" />
    {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
      <rect key={angle} x="6.6" y="0.6" width="2.8" height="3.4" fill="currentColor" transform={`rotate(${angle} 8 8)`} />
    ))}
  </svg>
)
