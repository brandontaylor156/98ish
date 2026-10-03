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
  {
    id: "pastel",
    label: "Pastel Dream",
    blurb: "Smiling clouds, a soft rainbow and a heart balloon, with music-box chimes and a sparkly wand for a pointer.",
    wallpaper: "pastel",
    scheme: "cotton",
    soundScheme: "dream",
    iconStyle: "pastel",
    cursor: "heartwand",
    cursorTrail: "sparkle",
    screensaver: "lovenotes",
    screensaverOptions: { palette: "pink", background: "#3a2350" },
  },
  {
    id: "kittycafe",
    label: "Kitty Café",
    blurb: "Lattes, macarons and a few very good cats. Sounds meow and purr; the pointer has little paws.",
    wallpaper: "kittycafe",
    scheme: "latte",
    soundScheme: "cafe",
    iconStyle: "cafe",
    cursor: "paw",
    cursorTrail: "hearts",
    screensaver: "aquarium",
  },
  {
    id: "garden",
    label: "Flower Garden",
    blurb: "Tulips, daisies and butterflies by a picket fence. Birds sing for every sound.",
    wallpaper: "garden",
    scheme: "bloom",
    soundScheme: "garden",
    iconStyle: "bloom",
    cursor: "flower",
    cursorTrail: "none",
    screensaver: "garden",
  },
  {
    id: "y2k",
    label: "Y2K Sparkle",
    blurb: "Chrome hearts, butterflies and glitter everywhere, with sparkly sounds and a sparkle trail.",
    wallpaper: "y2k",
    scheme: "glitter",
    soundScheme: "sparkle",
    iconStyle: "y2k",
    cursor: "butterfly",
    cursorTrail: "sparkle",
    screensaver: "lovenotes",
    screensaverOptions: { palette: "rainbow", background: "#2b1d5c" },
  },
  {
    id: "starrynight",
    label: "Starry Night",
    blurb: "A sleepy moon over a cozy little town, fireflies and a soft lullaby. Good night!",
    wallpaper: "starrynight",
    scheme: "moonlit",
    soundScheme: "lullaby",
    iconStyle: "moonlit",
    cursor: "moon",
    cursorTrail: "sparkle",
    screensaver: "garden",
    screensaverOptions: { cycle: "night" },
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
  if (parts.pointers) Object.assign(patch, { cursor: theme.cursor, cursorTrail: theme.cursorTrail || "none" })
  if (parts.screensaver) {
    patch.screensaver = theme.screensaver
    if (theme.screensaverOptions)
      patch.screensaverOptions = { ...(current.screensaverOptions || {}), [theme.screensaver]: { ...(current.screensaverOptions?.[theme.screensaver] || {}), ...theme.screensaverOptions } }
  }
  return patch
}

// Is this theme what's on the desktop right now? (for "Current Windows settings")
export const matchesTheme = (theme, s) =>
  s.wallpaper === theme.wallpaper && s.scheme === theme.scheme && s.soundScheme === theme.soundScheme && s.iconStyle === theme.iconStyle && s.cursor === theme.cursor &&
  (s.cursorTrail || "none") === (theme.cursorTrail || "none")
