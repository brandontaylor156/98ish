// The Desktop Themes: each sets the wallpaper, color scheme, sounds, desktop icon effect,
// screen saver and mouse pointers together. All the art is original (see
// public/assets/themes/); the sounds are synthesized (utils/systemSounds.js).

export const THEMES = [
  {
    id: "standard",
    label: "Windows 98ish Standard",
    blurb: "The classic: teal desktop, navy title bars and the everyday dings.",
    wallpaper: "default",
    scheme: "standard",
    soundScheme: "classic",
    iconStyle: "none",
    cursor: "default",
    screensaver: "flying",
  },
  {
    id: "space",
    label: "Space",
    blurb: "A ringed planet, a little rocket and sci-fi bleeps. Pointers with rocket fuel.",
    wallpaper: "space",
    scheme: "nebula",
    soundScheme: "space",
    iconStyle: "glow",
    cursor: "rocket",
    screensaver: "starfield",
  },
  {
    id: "underwater",
    label: "Underwater",
    blurb: "Fish, bubbles and seaweed. Every sound gurgles a little.",
    wallpaper: "underwater",
    scheme: "lagoon",
    soundScheme: "ocean",
    iconStyle: "sea",
    cursor: "fish",
    screensaver: "mystify",
  },
  {
    id: "vaporwave",
    label: "Vaporwave",
    blurb: "A striped sun over a neon grid, with detuned synth chords.",
    wallpaper: "sunset",
    scheme: "synth",
    soundScheme: "synth",
    iconStyle: "neon",
    cursor: "neon",
    screensaver: "beziers",
  },
  {
    id: "dinosaurs",
    label: "Dinosaurs",
    blurb: "A volcano, two very large friends and sounds that stomp.",
    wallpaper: "dinosaurs",
    scheme: "jurassic",
    soundScheme: "dino",
    iconStyle: "fossil",
    cursor: "bone",
    screensaver: "marquee",
    screensaverOptions: { text: "RAWR! The dinosaurs have taken over 98ish!", color: "#ffcc33", background: "#2a1a08", font: "sans" },
  },
]

export const themeById = (id) => THEMES.find((t) => t.id === id) || null

// The parts a theme can change, as in the Windows 98 dialog's check boxes
export const PARTS = [
  { id: "screensaver", label: "Screen saver" },
  { id: "sounds", label: "Sound events" },
  { id: "pointers", label: "Mouse pointers" },
  { id: "wallpaper", label: "Desktop wallpaper" },
  { id: "icons", label: "Icons" },
  { id: "colors", label: "Colors" },
]

// the settings a theme changes, for the parts that are checked
export const themePatch = (theme, parts, current = {}) => {
  const patch = { theme: theme.id }
  if (parts.wallpaper) Object.assign(patch, { wallpaper: theme.wallpaper, display: "stretch" })
  if (parts.colors) patch.scheme = theme.scheme
  if (parts.sounds) patch.soundScheme = theme.soundScheme
  if (parts.icons) patch.iconStyle = theme.iconStyle
  if (parts.pointers) patch.cursor = theme.cursor
  if (parts.screensaver) {
    patch.screensaver = theme.screensaver
    if (theme.screensaverOptions)
      patch.screensaverOptions = { ...(current.screensaverOptions || {}), [theme.screensaver]: { ...(current.screensaverOptions?.[theme.screensaver] || {}), ...theme.screensaverOptions } }
  }
  return patch
}

// Is this theme what's on the desktop right now? (for "Current Windows settings")
export const matchesTheme = (theme, s) =>
  s.wallpaper === theme.wallpaper && s.scheme === theme.scheme && s.soundScheme === theme.soundScheme && s.iconStyle === theme.iconStyle && s.cursor === theme.cursor
