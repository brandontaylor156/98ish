// node --test client/src/components/applets/vb98/vb98.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { compile, tokenize } from "./vblang.js"
import { makeRuntime, SLICE_MS } from "./vbruntime.js"
import { TEMPLATES, templateById } from "./templates.js"
import { validateProject, blankProject, MAX_BYTES } from "./vbfile.js"
import { newControl, nextName, codeObjects, procStub } from "./controls.js"

// a pretend form: controls are { __control, type, name, props }
const fakeHost = (controls = {}, extra = {}) => {
  const ctls = {}
  for (const [name, props] of Object.entries(controls)) ctls[name.toLowerCase()] = { __control: true, name, type: props.type || "Label", props: { ...props } }
  const shared = new Map()
  const log = { msgs: [], sounds: [], errors: [], sharedSets: [] }
  const host = {
    control: (n) => ctls[n] || null,
    get: (c, prop) => (prop === null ? c.props.caption ?? c.props.text ?? "" : c.props[prop] ?? ""),
    set: (c, prop, v) => {
      c.props[prop === null ? (c.props.text !== undefined ? "text" : "caption") : prop] = v
    },
    setAt: (c, prop, args, v) => {
      c.props[prop][args[0]] = v
    },
    call: (c, method, args) => {
      if (method === "additem") return (c.props.list = [...(c.props.list || []), args[0]]), ""
      if (method === "clear") return (c.props.list = []), ""
      if (method === "list") return c.props.list[args[0]]
      throw new Error(`no method ${method}`)
    },
    msgbox: async (text) => (log.msgs.push(text), 1),
    inputbox: async () => extra.answer ?? "Sam",
    sound: (n) => log.sounds.push(n),
    shared: {
      get: (k) => shared.get(k) ?? "",
      set: (k, v) => (shared.set(k, v), log.sharedSets.push([k, v])),
      keys: () => [...shared.keys()],
    },
    me: { name: "Brandon", host: true },
    friends: ["Brandon", "Alice"],
    form: { get: (p) => (p === "caption" ? "Form1" : 0), set: () => {} },
    error: (message, line, fatal) => log.errors.push({ message, line, fatal }),
    ...extra.host,
  }
  return { host, ctls, log, shared }
}

const load = (src, controls = {}, extra = {}) => {
  const c = compile(src, { controls: Object.keys(controls) })
  if (!c.ok) throw new Error(`compile failed: line ${c.error.line}: ${c.error.message}`)
  const f = fakeHost(controls, extra)
  const R = makeRuntime(f.host)
  const procs = new Function("R", c.js)(R)
  return { ...f, R, procs, run: (name, ...args) => R.run(procs[name], args) }
}

test("tokens: strings with doubled quotes, comments, line continuation, numbers", () => {
  const t = tokenize('x = "say ""hi""" \' comment\ny = 1.5 + _\n  2')
  assert.deepEqual(
    t.filter((k) => k.t !== "nl").map((k) => k.v),
    ["x", "=", 'say "hi"', "y", "=", 1.5, "+", 2]
  )
})

test("events, properties, variables and string building", async () => {
  const p = load(
    `Dim count As Integer

Sub Form_Load()
  count = 0
  Label1.Caption = "Ready"
End Sub

Sub Command1_Click()
  count = count + 1
  Label1.Caption = "Clicked " & count & " time" & IIf2(count)
End Sub

Function IIf2(n)
  If n = 1 Then IIf2 = "" Else IIf2 = "s"
End Function`,
    { Label1: { caption: "" }, Command1: { type: "CommandButton", caption: "Go" } }
  )
  await p.run("form_load")
  assert.equal(p.ctls.label1.props.caption, "Ready")
  await p.run("command1_click")
  assert.equal(p.ctls.label1.props.caption, "Clicked 1 time")
  await p.run("command1_click")
  assert.equal(p.ctls.label1.props.caption, "Clicked 2 times")
  assert.deepEqual(p.log.errors, [])
})

test("If/ElseIf/Else, For/Next with Step, Do loops, Select Case, Exit For", async () => {
  const p = load(
    `Sub Go()
  Dim s, i
  For i = 10 To 1 Step -3
    s = s & i & ","
  Next i
  Label1.Caption = s
  Dim n
  n = 0
  Do While n < 5
    n = n + 1
  Loop
  Do
    n = n + 10
  Loop Until n > 40
  Label2.Caption = n
  Dim grade
  Select Case 85
    Case Is >= 90: grade = "A"
    Case 80 To 89: grade = "B"
    Case Else: grade = "C"
  End Select
  Label3.Caption = grade
  For i = 1 To 100
    If i = 7 Then Exit For
  Next
  If i > 10 Then
    Label4.Caption = "big"
  ElseIf i = 7 Then
    Label4.Caption = "seven"
  Else
    Label4.Caption = "small"
  End If
End Sub`,
    { Label1: {}, Label2: {}, Label3: {}, Label4: {} }
  )
  await p.run("go")
  assert.deepEqual(p.log.errors, [])
  assert.equal(p.ctls.label1.props.caption, "10,7,4,1,")
  assert.equal(p.ctls.label2.props.caption, 45)
  assert.equal(p.ctls.label3.props.caption, "B")
  assert.equal(p.ctls.label4.props.caption, "seven")
})

test("arrays, For Each, Split/Join, built-ins, lists and MsgBox/InputBox", async () => {
  const p = load(
    `Sub Go()
  Dim a(2)
  a(0) = "x": a(1) = "y": a(2) = "z"
  Dim parts, w, out
  parts = Split("one two three")
  For Each w In parts
    out = out & UCase(Left(w, 1))
  Next
  List1.AddItem out
  List1.AddItem Join(a, "-")
  Dim name
  name = InputBox("Your name?")
  MsgBox "Hi " & name & "! " & Len(name) & " letters, " & Mid("abcdef", 2, 3) & ", " & (7 \\ 2) & " r " & (7 Mod 2)
  Sound.Play "tada"
End Sub`,
    { List1: { type: "ListBox", list: [] } }
  )
  await p.run("go")
  assert.deepEqual(p.log.errors, [])
  assert.deepEqual(p.ctls.list1.props.list, ["OTT", "x-y-z"])
  assert.deepEqual(p.log.msgs, ["Hi Sam! 3 letters, bcd, 3 r 1"])
  assert.deepEqual(p.log.sounds, ["tada"])
})

test("Shared state, Me.Name and Friends", async () => {
  const p = load(
    `Sub Command1_Click()
  Shared("votes_" & Me.Name) = "Pizza"
  Shared("count") = Val(Shared("count")) + 1
  Label1.Caption = Friends.Count & " friends; " & Shared("count")
End Sub`,
    { Label1: {}, Command1: { type: "CommandButton" } }
  )
  await p.run("command1_click")
  await p.run("command1_click")
  assert.deepEqual(p.log.errors, [])
  assert.equal(p.shared.get("votes_Brandon"), "Pizza")
  assert.equal(p.shared.get("count"), 2)
  assert.equal(p.ctls.label1.props.caption, "2 friends; 2")
})

test("compile errors name the line and the problem", () => {
  const cases = [
    ["Sub A()\n  If x Then\n    y = 1\nEnd Sub", /missing its "End If"/],
    ["Sub A()\n  Label9.Caption = 1\nEnd Sub", /no control or object called "Label9"/],
    ["Sub A()\n  x = undefinedThing + 1\nEnd Sub", /Variable not defined: "undefinedThing"/],
    ["Sub A()\n  Foo 3\nEnd Sub", /Sub not defined: "Foo"/],
    ['Sub A()\n  x = "unclosed\nEnd Sub', /closing quote/],
    ["x = 1", /Outside a Sub/],
    ["Sub A()\nEnd Sub\nSub A()\nEnd Sub", /defined twice/],
  ]
  for (const [src, re] of cases) {
    const r = compile(src, { controls: ["Label1"] })
    assert.equal(r.ok, false, src)
    assert.match(r.error.message, re, src)
    assert.ok(r.error.line >= 1)
  }
})

test("the watchdog stops an endless loop and endless recursion", async () => {
  let t = 0
  const p = load(
    `Sub Spin()
  Do
    x = x + 1
  Loop
End Sub
Sub Deep(n)
  Deep n + 1
End Sub`,
    {},
    { host: { now: () => (t += 50) } }
  )
  const started = Date.now()
  await p.run("spin")
  assert.ok(Date.now() - started < SLICE_MS * 5, "stopped quickly")
  assert.equal(p.log.errors.length, 1)
  assert.match(p.log.errors[0].message, /stopped responding/)
  assert.equal(p.log.errors[0].fatal, true)
  // a stopped program runs nothing more
  await p.run("deep", 1)
  assert.equal(p.log.errors.length, 1)
  const q = load("Sub Deep(n)\n  Deep n + 1\nEnd Sub")
  await q.run("deep", 1)
  assert.match(q.log.errors[0].message, /Out of stack space/)
})

test("runtime errors report the line and the program keeps going", async () => {
  const p = load(
    `Sub Bad()
  Dim a(1)
  x = 1
  a(5) = 2
End Sub
Sub Good()
  Label1.Caption = 10 / 4
End Sub`,
    { Label1: {} }
  )
  await p.run("bad")
  assert.equal(p.log.errors[0].line, 4)
  assert.match(p.log.errors[0].message, /Subscript out of range/)
  await p.run("good")
  assert.equal(p.ctls.label1.props.caption, 2.5)
})

test("every template validates and its code compiles", () => {
  for (const t of TEMPLATES) {
    const p = t.make()
    const v = validateProject(JSON.stringify(p))
    assert.equal(v.ok, true, `${t.id}: ${v.error}`)
    const c = compile(p.code, { controls: p.controls.map((x) => x.name) })
    assert.equal(c.ok, true, `${t.id}: line ${c.error?.line}: ${c.error?.message}`)
  }
})

test(".vb98 validation: rejects junk, duplicates, unknown types and oversized programs; clamps values", () => {
  assert.equal(validateProject("nope").ok, false)
  assert.equal(validateProject({ kind: "other" }).ok, false)
  const p = blankProject()
  p.controls = [newControl("Label", []), newControl("Label", [])]
  p.controls[1].name = p.controls[0].name
  assert.match(validateProject(p).error, /Two controls/)
  p.controls = [{ type: "Rocket", name: "R1" }]
  assert.match(validateProject(p).error, /Unknown control/)
  p.controls = [{ ...newControl("Label", []), name: "1bad" }]
  assert.match(validateProject(p).error, /valid control name/)
  p.controls = [{ ...newControl("PictureBox", []), picture: "data:image/png;base64," + "A".repeat(MAX_BYTES) }]
  assert.equal(validateProject(p).ok, false)
  const ok = validateProject({ ...blankProject(), form: { caption: "X", width: 99999, height: -5, backColor: "javascript:alert(1)" } })
  assert.equal(ok.ok, true)
  assert.equal(ok.project.form.width, 1200)
  assert.equal(ok.project.form.height, 80)
  assert.equal(ok.project.form.backColor, "#c0c0c0")
})

test("controls: names, the Code window's lists and event stubs", () => {
  const list = [newControl("CommandButton", [])]
  assert.equal(list[0].name, "Command1")
  assert.equal(nextName("CommandButton", list), "Command2")
  const objs = codeObjects(list)
  assert.deepEqual(
    objs.map((o) => o.object),
    ["Form", "Command1", "Shared"]
  )
  assert.equal(compile(procStub("Form", "KeyDown"), { controls: [] }).ok, true)
})

test("two players play Tic-Tac-Toe over Shared state", async () => {
  const t = templateById("tictactoe").make()
  const store = new Map()
  const players = []
  const mk = (name) => {
    const controls = Object.fromEntries(t.controls.map((c) => [c.name, { ...c }]))
    const p = load(t.code, controls, {
      host: {
        me: { name },
        friends: ["Ann", "Bob"],
        shared: {
          get: (k) => store.get(k) ?? "",
          set: (k, v) => {
            store.set(k, v)
            // everyone hears about it, as the server relays it
            for (const other of players) other.pending.push(k)
          },
          keys: () => [...store.keys()],
        },
      },
    })
    p.pending = []
    players.push(p)
    return p
  }
  const ann = mk("Ann")
  const bob = mk("Bob")
  const flush = async () => {
    for (const p of players) {
      const keys = p.pending.splice(0)
      for (const k of keys) await p.run("shared_changed", k)
    }
  }
  await ann.run("form_load")
  await bob.run("form_load")
  await flush()
  // Ann takes X in the corner, Bob plays, Ann plays out of turn (refused), then wins the top row
  for (const [who, cell] of [
    [ann, 1],
    [bob, 5],
    [ann, 2],
    [ann, 3],
    [bob, 9],
    [ann, 3],
  ]) {
    await who.run(`cell${cell}_click`)
    await flush()
  }
  assert.equal(store.get("X"), "Ann")
  assert.equal(store.get("O"), "Bob")
  assert.equal(store.get("board"), "XXX.O...O")
  assert.equal(bob.ctls.label1.props.caption, "X (Ann) wins!")
  assert.equal(ann.ctls.cell2.props.caption, "X")
  assert.equal(bob.ctls.cell5.props.caption, "O")
  assert.deepEqual([...ann.log.errors, ...bob.log.errors], [])
})
