// Visual Basic 98's blocks: Blockly (Apache-2.0) blocks that turn into the same VB code as
// typing (vblang.js runs it). generateVB(state) reads Blockly's saved JSON
// (Blockly.serialization.workspaces.save), so it's pure and the unit tests run it without
// Blockly. defineBlocks(Blockly, getControls) registers the blocks in the editor.

import { CONTROL_TYPES, EVENT_PARAMS, FORM_EVENTS } from "./controls.js"
import { SOUNDS } from "./vbruntime.js"

export const PROPS = ["Caption", "Text", "Visible", "Enabled", "Left", "Top", "Width", "Height", "BackColor", "ForeColor", "FillColor", "Value", "Costume", "Picture", "FontSize", "Interval", "ListIndex"]

const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`
const ident = (name) => {
  let s = String(name || "v").replace(/[^A-Za-z0-9_]/g, "_")
  if (!/^[A-Za-z]/.test(s)) s = `v_${s}`
  return s.slice(0, 40)
}

// one block -> VB (statements: an array of lines; values: an expression string)
export const generateVB = (state) => {
  const blocks = state?.blocks?.blocks || []
  const vars = new Map((state?.variables || []).map((v) => [v.id, ident(v.name)]))
  const varName = (field) => vars.get(field?.id) || ident(field?.name || field)
  const handlers = new Map() // "Obj_Event" -> { params, lines }
  let repeats = 0 // each "repeat" block gets its own counter variable

  const value = (input) => (input?.block ? expr(input.block) : input?.shadow ? expr(input.shadow) : '""')
  const expr = (b) => {
    const f = b.fields || {}
    const i = b.inputs || {}
    switch (b.type) {
      case "math_number":
        return String(Number(f.NUM) || 0)
      case "text":
        return q(f.TEXT)
      case "logic_boolean":
        return f.BOOL === "FALSE" ? "False" : "True"
      case "variables_get":
        return varName(f.VAR)
      case "logic_negate":
        return `Not (${value(i.BOOL)})`
      case "logic_compare": {
        const op = { EQ: "=", NEQ: "<>", LT: "<", LTE: "<=", GT: ">", GTE: ">=" }[f.OP] || "="
        return `(${value(i.A)} ${op} ${value(i.B)})`
      }
      case "logic_operation":
        return `(${value(i.A)} ${f.OP === "OR" ? "Or" : "And"} ${value(i.B)})`
      case "math_arithmetic": {
        const op = { ADD: "+", MINUS: "-", MULTIPLY: "*", DIVIDE: "/", POWER: "^" }[f.OP] || "+"
        return `(${value(i.A)} ${op} ${value(i.B)})`
      }
      case "math_random_int":
      case "vb_random":
        return `Random(${value(i.FROM)}, ${value(i.TO)})`
      case "text_join": {
        const n = Number(b.extraState?.itemCount ?? 2)
        const parts = []
        for (let k = 0; k < n; k++) parts.push(value(i[`ADD${k}`]))
        return parts.length ? `(${parts.join(" & ")})` : '""'
      }
      case "text_length":
        return `Len(${value(i.VALUE)})`
      case "vb_get_prop":
        return `${ident(f.CONTROL)}.${f.PROP || "Caption"}`
      case "vb_inputbox":
        return `InputBox(${value(i.TEXT)})`
      case "vb_shared_get":
        return `Shared(${value(i.KEY)})`
      case "vb_me_name":
        return "Me.Name"
      case "vb_touching":
        return `${ident(f.A)}.Touching(${ident(f.B)})`
      case "vb_key":
        return "Key"
      case "vb_color":
        return q(f.COLOR || "#ff0000")
    }
    return '""'
  }

  const statements = (input, depth) => {
    const out = []
    let b = input?.block
    while (b) {
      out.push(...statement(b, depth))
      b = b.next?.block
    }
    return out
  }
  const pad = (d) => "  ".repeat(d)
  const statement = (b, d) => {
    const f = b.fields || {}
    const i = b.inputs || {}
    const P = pad(d)
    switch (b.type) {
      case "controls_if": {
        const n = Number(b.extraState?.elseIfCount || 0)
        const lines = [`${P}If ${value(i.IF0)} Then`, ...statements(i.DO0, d + 1)]
        for (let k = 1; k <= n; k++) lines.push(`${P}ElseIf ${value(i[`IF${k}`])} Then`, ...statements(i[`DO${k}`], d + 1))
        if (b.extraState?.hasElse || i.ELSE) lines.push(`${P}Else`, ...statements(i.ELSE, d + 1))
        lines.push(`${P}End If`)
        return lines
      }
      case "controls_repeat_ext": {
        const v = `rep${++repeats}`
        return [`${P}Dim ${v}`, `${P}For ${v} = 1 To ${value(i.TIMES)}`, ...statements(i.DO, d + 1), `${P}Next`]
      }
      case "controls_whileUntil":
        return [`${P}Do ${f.MODE === "UNTIL" ? "Until" : "While"} ${value(i.BOOL)}`, ...statements(i.DO, d + 1), `${P}Loop`]
      case "controls_for":
        return [`${P}For ${varName(f.VAR)} = ${value(i.FROM)} To ${value(i.TO)} Step ${value(i.BY)}`, ...statements(i.DO, d + 1), `${P}Next`]
      case "variables_set":
        return [`${P}${varName(f.VAR)} = ${value(i.VALUE)}`]
      case "math_change":
        return [`${P}${varName(f.VAR)} = ${varName(f.VAR)} + ${value(i.DELTA)}`]
      case "vb_set_prop":
        return [`${P}${ident(f.CONTROL)}.${f.PROP || "Caption"} = ${value(i.VALUE)}`]
      case "vb_msgbox":
        return [`${P}MsgBox ${value(i.TEXT)}`]
      case "vb_sound":
        return [`${P}Sound.Play ${q(f.SOUND || "ding")}`]
      case "vb_shared_set":
        return [`${P}Shared(${value(i.KEY)}) = ${value(i.VALUE)}`]
      case "vb_wait":
        return [`${P}Wait ${value(i.MS)}`]
      case "vb_move":
        return [`${P}${ident(f.SPRITE)}.Move ${value(i.DX)}, ${value(i.DY)}`]
      case "vb_list_add":
        return [`${P}${ident(f.LIST)}.AddItem ${value(i.ITEM)}`]
      case "vb_list_clear":
        return [`${P}${ident(f.LIST)}.Clear`]
      case "vb_end":
        return [`${P}End`]
    }
    return [`${P}' (a block Visual Basic 98 doesn't know: ${String(b.type).slice(0, 30)})`]
  }

  for (const b of blocks) {
    if (b.type !== "vb_event") continue // loose blocks outside an event don't run
    const f = b.fields || {}
    const obj = ident(f.OBJECT || "Form")
    const event = ident(f.EVENT || "Click")
    const key = `${obj}_${event}`
    const h = handlers.get(key) || { params: EVENT_PARAMS[event] ? `${EVENT_PARAMS[event]} As String` : "", lines: [] }
    h.lines.push(...statements(b.inputs?.DO, 1))
    handlers.set(key, h)
  }
  const out = []
  if (vars.size) out.push(`Dim ${[...new Set(vars.values())].join(", ")}`, "")
  for (const [key, h] of handlers) out.push(`Sub ${key}(${h.params})`, ...h.lines, "End Sub", "")
  return out.join("\n")
}

// the events a dropdown offers for an object
export const eventsFor = (object, controls) => {
  if (object === "Form") return FORM_EVENTS
  if (object === "Shared") return ["Changed"]
  const c = controls.find((x) => x.name === object)
  return CONTROL_TYPES[c?.type]?.events || []
}

// the toolbox (categories in Blockly's JSON format)
export const TOOLBOX = {
  kind: "categoryToolbox",
  contents: [
    {
      kind: "category",
      name: "Events",
      colour: "#c08000",
      contents: [{ kind: "block", type: "vb_event" }],
    },
    {
      kind: "category",
      name: "Controls",
      colour: "#4060c0",
      contents: [
        { kind: "block", type: "vb_set_prop", inputs: { VALUE: { shadow: { type: "text", fields: { TEXT: "Hi!" } } } } },
        { kind: "block", type: "vb_get_prop" },
        { kind: "block", type: "vb_list_add", inputs: { ITEM: { shadow: { type: "text", fields: { TEXT: "item" } } } } },
        { kind: "block", type: "vb_list_clear" },
        { kind: "block", type: "vb_color" },
      ],
    },
    {
      kind: "category",
      name: "Talk",
      colour: "#8040a0",
      contents: [
        { kind: "block", type: "vb_msgbox", inputs: { TEXT: { shadow: { type: "text", fields: { TEXT: "Hello!" } } } } },
        { kind: "block", type: "vb_inputbox", inputs: { TEXT: { shadow: { type: "text", fields: { TEXT: "What's your name?" } } } } },
        { kind: "block", type: "vb_sound" },
        { kind: "block", type: "vb_wait", inputs: { MS: { shadow: { type: "math_number", fields: { NUM: 500 } } } } },
        { kind: "block", type: "vb_me_name" },
        { kind: "block", type: "vb_key" },
        { kind: "block", type: "vb_end" },
      ],
    },
    {
      kind: "category",
      name: "Shared",
      colour: "#008080",
      contents: [
        { kind: "block", type: "vb_shared_set", inputs: { KEY: { shadow: { type: "text", fields: { TEXT: "score" } } }, VALUE: { shadow: { type: "math_number", fields: { NUM: 0 } } } } },
        { kind: "block", type: "vb_shared_get", inputs: { KEY: { shadow: { type: "text", fields: { TEXT: "score" } } } } },
      ],
    },
    {
      kind: "category",
      name: "Games",
      colour: "#20a040",
      contents: [
        { kind: "block", type: "vb_move", inputs: { DX: { shadow: { type: "math_number", fields: { NUM: 10 } } }, DY: { shadow: { type: "math_number", fields: { NUM: 0 } } } } },
        { kind: "block", type: "vb_touching" },
        { kind: "block", type: "vb_random", inputs: { FROM: { shadow: { type: "math_number", fields: { NUM: 1 } } }, TO: { shadow: { type: "math_number", fields: { NUM: 6 } } } } },
      ],
    },
    {
      kind: "category",
      name: "Logic",
      colour: "#5b80a5",
      contents: [{ kind: "block", type: "controls_if" }, { kind: "block", type: "logic_compare" }, { kind: "block", type: "logic_operation" }, { kind: "block", type: "logic_negate" }, { kind: "block", type: "logic_boolean" }],
    },
    {
      kind: "category",
      name: "Loops",
      colour: "#5ba55b",
      contents: [
        { kind: "block", type: "controls_repeat_ext", inputs: { TIMES: { shadow: { type: "math_number", fields: { NUM: 3 } } } } },
        { kind: "block", type: "controls_whileUntil" },
        { kind: "block", type: "controls_for", inputs: { FROM: { shadow: { type: "math_number", fields: { NUM: 1 } } }, TO: { shadow: { type: "math_number", fields: { NUM: 10 } } }, BY: { shadow: { type: "math_number", fields: { NUM: 1 } } } } },
      ],
    },
    {
      kind: "category",
      name: "Math & Text",
      colour: "#5b67a5",
      contents: [{ kind: "block", type: "math_number" }, { kind: "block", type: "math_arithmetic" }, { kind: "block", type: "text" }, { kind: "block", type: "text_join" }, { kind: "block", type: "text_length" }],
    },
    { kind: "category", name: "Variables", colour: "#a55b80", custom: "VARIABLE" },
  ],
}

// register the VB blocks (getControls() gives the form's current controls)
export const defineBlocks = (Blockly, getControls) => {
  if (Blockly.Blocks.vb_event) return
  const controlOptions = (types) => () => {
    const list = getControls().filter((c) => !types || types.includes(c.type))
    return list.length ? list.map((c) => [c.name, c.name]) : [["(none)", "None"]]
  }
  const all = controlOptions(null)
  const define = (type, init) => {
    Blockly.Blocks[type] = { init }
  }
  define("vb_event", function () {
    const objects = () => [["Form", "Form"], ...getControls().filter((c) => CONTROL_TYPES[c.type]?.events.length).map((c) => [c.name, c.name]), ["Shared", "Shared"]]
    const events = () => eventsFor(this.getFieldValue?.("OBJECT") || "Form", getControls()).map((e) => [e, e])
    this.appendDummyInput().appendField("When").appendField(new Blockly.FieldDropdown(objects, (v) => {
      // a new object: pick its first event
      setTimeout(() => {
        const first = eventsFor(v, getControls())[0]
        if (first) this.setFieldValue(first, "EVENT")
      })
      return v
    }), "OBJECT").appendField(new Blockly.FieldDropdown(() => (events().length ? events() : [["Click", "Click"]])), "EVENT")
    this.appendStatementInput("DO").appendField("do")
    this.setColour("#c08000")
    this.setTooltip("Runs when this happens: a click, a timer tick, a friend changing a Shared value...")
  })
  define("vb_set_prop", function () {
    this.appendValueInput("VALUE").appendField("set").appendField(new Blockly.FieldDropdown(all), "CONTROL").appendField(".").appendField(new Blockly.FieldDropdown(PROPS.map((p) => [p, p])), "PROP").appendField("to")
    this.setPreviousStatement(true)
    this.setNextStatement(true)
    this.setColour("#4060c0")
  })
  define("vb_get_prop", function () {
    this.appendDummyInput().appendField(new Blockly.FieldDropdown(all), "CONTROL").appendField(".").appendField(new Blockly.FieldDropdown(PROPS.map((p) => [p, p])), "PROP")
    this.setOutput(true)
    this.setColour("#4060c0")
  })
  define("vb_list_add", function () {
    this.appendValueInput("ITEM").appendField("add")
    this.appendDummyInput().appendField("to").appendField(new Blockly.FieldDropdown(controlOptions(["ListBox", "ComboBox"])), "LIST")
    this.setInputsInline(true)
    this.setPreviousStatement(true)
    this.setNextStatement(true)
    this.setColour("#4060c0")
  })
  define("vb_list_clear", function () {
    this.appendDummyInput().appendField("clear").appendField(new Blockly.FieldDropdown(controlOptions(["ListBox", "ComboBox", "TextBox"])), "LIST")
    this.setPreviousStatement(true)
    this.setNextStatement(true)
    this.setColour("#4060c0")
  })
  define("vb_color", function () {
    const colors = [["red", "#ff0000"], ["green", "#008000"], ["blue", "#0000ff"], ["yellow", "#ffff00"], ["orange", "#ff8000"], ["pink", "#ff80c0"], ["black", "#000000"], ["white", "#ffffff"], ["gray", "#c0c0c0"], ["navy", "#000080"], ["teal", "#008080"]]
    this.appendDummyInput().appendField("color").appendField(new Blockly.FieldDropdown(colors), "COLOR")
    this.setOutput(true)
    this.setColour("#4060c0")
  })
  define("vb_msgbox", function () {
    this.appendValueInput("TEXT").appendField("show message")
    this.setPreviousStatement(true)
    this.setNextStatement(true)
    this.setColour("#8040a0")
  })
  define("vb_inputbox", function () {
    this.appendValueInput("TEXT").appendField("ask")
    this.setOutput(true)
    this.setColour("#8040a0")
  })
  define("vb_sound", function () {
    this.appendDummyInput().appendField("play sound").appendField(new Blockly.FieldDropdown(SOUNDS.map((s) => [s, s])), "SOUND")
    this.setPreviousStatement(true)
    this.setNextStatement(true)
    this.setColour("#8040a0")
  })
  define("vb_wait", function () {
    this.appendValueInput("MS").appendField("wait")
    this.appendDummyInput().appendField("ms")
    this.setInputsInline(true)
    this.setPreviousStatement(true)
    this.setNextStatement(true)
    this.setColour("#8040a0")
  })
  define("vb_me_name", function () {
    this.appendDummyInput().appendField("my name")
    this.setOutput(true)
    this.setColour("#8040a0")
  })
  define("vb_key", function () {
    this.appendDummyInput().appendField("the key / Shared name")
    this.setOutput(true)
    this.setColour("#8040a0")
    this.setTooltip("Inside 'When Form KeyDown': the key pressed. Inside 'When Shared Changed': which Shared value changed.")
  })
  define("vb_end", function () {
    this.appendDummyInput().appendField("end the program")
    this.setPreviousStatement(true)
    this.setColour("#8040a0")
  })
  define("vb_shared_set", function () {
    this.appendValueInput("KEY").appendField("set shared")
    this.appendValueInput("VALUE").appendField("to")
    this.setInputsInline(true)
    this.setPreviousStatement(true)
    this.setNextStatement(true)
    this.setColour("#008080")
    this.setTooltip("Everyone you sent the program to sees this value change")
  })
  define("vb_shared_get", function () {
    this.appendValueInput("KEY").appendField("shared")
    this.setOutput(true)
    this.setColour("#008080")
  })
  define("vb_move", function () {
    this.appendDummyInput().appendField("move").appendField(new Blockly.FieldDropdown(controlOptions(["Sprite", "PictureBox", "Shape", "Label", "CommandButton"])), "SPRITE")
    this.appendValueInput("DX").appendField("by x")
    this.appendValueInput("DY").appendField("y")
    this.setInputsInline(true)
    this.setPreviousStatement(true)
    this.setNextStatement(true)
    this.setColour("#20a040")
  })
  define("vb_touching", function () {
    this.appendDummyInput().appendField(new Blockly.FieldDropdown(all), "A").appendField("touching").appendField(new Blockly.FieldDropdown(all), "B")
    this.setOutput(true, "Boolean")
    this.setColour("#20a040")
  })
  define("vb_random", function () {
    this.appendValueInput("FROM").appendField("random from")
    this.appendValueInput("TO").appendField("to")
    this.setInputsInline(true)
    this.setOutput(true, "Number")
    this.setColour("#20a040")
  })
}
