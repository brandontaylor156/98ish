// Visual Basic 98's controls: what the Toolbox offers, their properties (and how the
// Properties window edits them), their events (the Code window's Procedure list) and
// defaults. Shared by the designer, the blocks editor and the sandbox. Pure data + helpers.

// prop kinds: text | longtext | number | bool | color | choice (+ choices) | list (lines) | picture
const COMMON = [
  ["name", "text"],
  ["left", "number"],
  ["top", "number"],
  ["width", "number"],
  ["height", "number"],
  ["visible", "bool"],
  ["enabled", "bool"],
]
const FONT = [
  ["fontSize", "number"],
  ["fontBold", "bool"],
  ["foreColor", "color"],
]

export const CONTROL_TYPES = {
  Label: {
    prefix: "Label",
    icon: "A",
    title: "Label",
    size: [96, 20],
    defaults: { caption: "Label", alignment: "left", backColor: "transparent", fontSize: 11, fontBold: false, foreColor: "#000000" },
    props: [["caption", "text"], ["alignment", "choice", ["left", "center", "right"]], ["backColor", "color"], ...FONT],
    events: ["Click"],
  },
  TextBox: {
    prefix: "Text",
    icon: "ab|",
    title: "TextBox",
    size: [120, 22],
    defaults: { text: "", multiLine: false, backColor: "#ffffff", fontSize: 11, fontBold: false, foreColor: "#000000" },
    props: [["text", "longtext"], ["multiLine", "bool"], ["backColor", "color"], ...FONT],
    events: ["Change"],
  },
  CommandButton: {
    prefix: "Command",
    icon: "▭",
    title: "CommandButton",
    size: [96, 28],
    defaults: { caption: "Command", fontSize: 11, fontBold: false, foreColor: "#000000", backColor: "#c0c0c0" },
    props: [["caption", "text"], ["backColor", "color"], ...FONT],
    events: ["Click"],
  },
  CheckBox: {
    prefix: "Check",
    icon: "☑",
    title: "CheckBox",
    size: [110, 20],
    defaults: { caption: "Check", value: false, fontSize: 11, fontBold: false, foreColor: "#000000" },
    props: [["caption", "text"], ["value", "bool"], ...FONT],
    events: ["Click"],
  },
  OptionButton: {
    prefix: "Option",
    icon: "◉",
    title: "OptionButton",
    size: [110, 20],
    defaults: { caption: "Option", value: false, group: "1", fontSize: 11, fontBold: false, foreColor: "#000000" },
    props: [["caption", "text"], ["value", "bool"], ["group", "text"], ...FONT],
    events: ["Click"],
  },
  ListBox: {
    prefix: "List",
    icon: "☰",
    title: "ListBox",
    size: [120, 90],
    defaults: { list: [], listIndex: -1, fontSize: 11, fontBold: false, foreColor: "#000000" },
    props: [["list", "list"], ...FONT],
    events: ["Click"],
  },
  ComboBox: {
    prefix: "Combo",
    icon: "▾",
    title: "ComboBox",
    size: [120, 22],
    defaults: { list: [], text: "", listIndex: -1, fontSize: 11, fontBold: false, foreColor: "#000000" },
    props: [["list", "list"], ["text", "text"], ...FONT],
    events: ["Click"],
  },
  PictureBox: {
    prefix: "Picture",
    icon: "🖼",
    title: "PictureBox",
    size: [64, 64],
    defaults: { picture: "⭐", backColor: "transparent" },
    props: [["picture", "picture"], ["backColor", "color"]],
    events: ["Click"],
  },
  Shape: {
    prefix: "Shape",
    icon: "◯",
    title: "Shape",
    size: [64, 48],
    defaults: { shape: "rectangle", fillColor: "#ffff00", borderColor: "#000000" },
    props: [["shape", "choice", ["rectangle", "oval", "rounded"]], ["fillColor", "color"], ["borderColor", "color"]],
    events: ["Click"],
  },
  Sprite: {
    prefix: "Sprite",
    icon: "👾",
    title: "Sprite (for games)",
    size: [40, 40],
    defaults: { costume: "🙂" },
    props: [["costume", "picture"]],
    events: ["Click"],
  },
  Timer: {
    prefix: "Timer",
    icon: "⏱",
    title: "Timer",
    size: [32, 32],
    hidden: true, // not seen while the program runs
    defaults: { interval: 1000, enabled: true },
    props: [["interval", "number"]],
    events: ["Timer"],
  },
  Sound: {
    prefix: "Sound",
    icon: "🔊",
    title: "Sound",
    size: [32, 32],
    hidden: true,
    defaults: { sound: "ding" },
    props: [["sound", "choice", ["ding", "chord", "tada", "click", "pop", "boing", "win", "lose", "chimes", "notify"]]],
    events: [],
  },
}

export const TOOLBOX = Object.keys(CONTROL_TYPES)

export const FORM_PROPS = [
  ["caption", "text"],
  ["width", "number"],
  ["height", "number"],
  ["backColor", "color"],
]
export const FORM_EVENTS = ["Load", "Click", "KeyDown"]
// the special objects' events (Shared_Changed runs when anyone changes a Shared value)
export const OBJECT_EVENTS = { Shared: ["Changed"] }
export const EVENT_PARAMS = { KeyDown: "Key", Changed: "Key" }

// the Properties window's rows for a control type (Timer and Sound are invisible at run time:
// no size, colors or Visible)
export const propsFor = (type) => {
  const def = CONTROL_TYPES[type]
  if (!def) return COMMON
  if (def.hidden) return [["name", "text"], ["left", "number"], ["top", "number"], ...(type === "Timer" ? [["enabled", "bool"]] : []), ...def.props]
  return [...COMMON, ...def.props]
}

// the next free name: Command1, Command2...
export const nextName = (type, controls) => {
  const prefix = CONTROL_TYPES[type]?.prefix || type
  const used = new Set(controls.map((c) => c.name.toLowerCase()))
  for (let n = 1; ; n++) if (!used.has(`${prefix}${n}`.toLowerCase())) return `${prefix}${n}`
}

export const newControl = (type, controls, at = {}) => {
  const def = CONTROL_TYPES[type]
  const [w, h] = def.size
  const n = controls.length
  return {
    type,
    name: nextName(type, controls),
    left: at.left ?? 16 + ((n * 12) % 120),
    top: at.top ?? 16 + ((n * 12) % 120),
    width: w,
    height: h,
    visible: true,
    enabled: true,
    ...JSON.parse(JSON.stringify(def.defaults)),
    ...(def.defaults.caption !== undefined ? { caption: nextName(type, controls) } : {}),
  }
}

// a VB-legal control name
export const validName = (name) => /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(String(name || ""))

// the Code window's Object and Procedure lists: [{ object, events }]
export const codeObjects = (controls) => [
  { object: "Form", events: FORM_EVENTS },
  ...controls.filter((c) => CONTROL_TYPES[c.type]?.events.length).map((c) => ({ object: c.name, events: CONTROL_TYPES[c.type].events })),
  { object: "Shared", events: OBJECT_EVENTS.Shared },
]

// the text a new event procedure starts as
export const procStub = (object, event) => {
  const param = EVENT_PARAMS[event]
  return `Sub ${object}_${event}(${param ? `${param} As String` : ""})\n  \nEnd Sub`
}
