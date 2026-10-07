// node --test client/src/components/applets/floppy/hands.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { agentMessages, appAccess, isRisky, parseAgentAction, planRecipe, snapshotText } from "./handsCore.js"
import { KINDS, buildProject, checkProject, detectVbRequest, makeProgram, ruleParams, toUsDate, validateParams, vbStr } from "./vbgen.js"
import { compile } from "../vb98/vblang.js"
import { makeRuntime } from "../vb98/vbruntime.js"

const NOW = Date.parse("2026-10-06T20:00:00Z") // a Tuesday
const ctx = { programs: ["Paint", "Notepad", "Pickleball 98", "Visual Basic 98"], buddies: ["Sam", "Mia Lee"], venues: [{ id: "loscab", name: "Los Cab Sports Village", short: "Los Cab" }], now: NOW, zone: "America/Los_Angeles" }

test("safety: Passwords never, private programs ask, risky presses confirm", () => {
  assert.equal(appAccess("passwords"), "never")
  assert.equal(appAccess("users"), "never")
  for (const a of ["notes", "mail", "photos", "aim-im", "chat", "locator"]) assert.equal(appAccess(a), "ask", a)
  for (const a of ["paint", "notepad", "pickleball", "vb98", "calculator"]) assert.equal(appAccess(a), "ok", a)
  for (const l of ["Send", "Delete", "Empty Recycle Bin", "Bet 25", "Share...", "Invite", "Create", "Sign Out"]) assert.equal(isRisky(l), true, l)
  for (const l of ["Open", "Next", "Bold", "Clear Image", "Color #0000ff", "Cancel"]) assert.equal(isRisky(l), false, l)
  // an OK in a dialog that deletes is risky; in a harmless one it isn't
  assert.equal(isRisky("OK", "Are you sure you want to delete this file?"), true)
  assert.equal(isRisky("OK", "Paragraph spacing"), false)
})

test("recipes: Paint background + send, Notepad typing, a Who's in? session", () => {
  const paint = planRecipe("make Paint's background blue and send it to Sam", ctx)
  assert.equal(paint.steps[0].program, "Paint")
  assert.equal(paint.steps[1].target.css, '.pSwatch[aria-label="Color #0000ff"]')
  assert.equal(paint.steps[1].pointer.button, 2) // a right-click picks the background color
  assert.deepEqual(paint.steps[2].path, ["Image", "Clear Image"])
  assert.deepEqual(paint.steps[3].call, { tool: "send_picture", args: { to: "Sam", app: "Paint" } })
  assert.equal(paint.steps[3].risky, true)
  assert.equal(planRecipe("fill the paint canvas with dark green", ctx).steps[1].target.css, '.pSwatch[aria-label="Color #008000"]')
  assert.equal(planRecipe("make paint's background chartreuse", ctx), null) // not on the palette

  const np = planRecipe('open notepad and type "groceries: milk, eggs"', ctx)
  assert.equal(np.steps[1].text, "groceries: milk, eggs")

  const s = planRecipe("set up a Who's in? at Los Cab Saturday 9am", ctx)
  assert.deepEqual(s.steps[0].handoff, { venue: "loscab" })
  assert.equal(s.steps.find((x) => x.target?.css === "input[data-date]" && x.do === "set").value, "2026-10-10")
  assert.equal(s.steps.find((x) => x.target?.css === "input[data-time]").value, "09:00")
  assert.equal(s.steps.at(-1).risky, true) // creating invites people: confirmed first
  assert.equal(planRecipe("remind me to open paint at 7", ctx), null)
})

test("the agent: a window as numbered text, and its answers checked against it", () => {
  const elements = [
    { role: "button", label: "New Game" },
    { role: "textbox", label: "Your name", value: "" },
    { role: "combobox", label: "Level", value: "club" },
    { role: "button", label: "Delete", disabled: true },
  ]
  const text = snapshotText("Minesweeper", elements)
  assert.match(text, /\[0\] button "New Game"/)
  assert.match(text, /\[2\] combobox "Level" = "club"/)
  assert.match(text, /\[3\] button "Delete" \(disabled\)/)
  assert.match(agentMessages({ goal: "start a new game", title: "Minesweeper", elements }).at(-1).content, /Goal: start a new game/)
  assert.deepEqual(parseAgentAction('{"do":"click","i":0}', elements).action, { do: "click", i: 0 })
  assert.deepEqual(parseAgentAction('Sure! ```json\n{"do":"type","i":1,"text":"Sam"}\n```', elements).action, { do: "type", i: 1, text: "Sam" })
  assert.equal(parseAgentAction('{"do":"type","i":0,"text":"x"}', elements).ok, false) // not a text box
  assert.equal(parseAgentAction('{"do":"click","i":9}', elements).ok, false) // not on the list
  assert.equal(parseAgentAction('{"do":"click","i":3}', elements).ok, false) // disabled
  assert.equal(parseAgentAction('{"do":"open","program":"Passwords"}', elements).ok, false) // not an allowed action
  assert.deepEqual(parseAgentAction("{do:'done', say:'Started a new game'}", elements).action, { do: "done", say: "Started a new game" })
})

test("programs: what kind of program, and parameters from the sentence", () => {
  assert.deepEqual(detectVbRequest("make me a quiz about pickleball"), { kind: "quiz" })
  assert.deepEqual(detectVbRequest("build a tic tac toe game"), { template: "tictactoe" })
  assert.deepEqual(detectVbRequest("write a program that picks who pays for dinner"), { kind: "picker" })
  assert.equal(detectVbRequest("make a note about the quiz"), null)
  assert.equal(detectVbRequest("open paint"), null)
  assert.deepEqual(ruleParams("poll", "make a poll: where should we eat? pizza, tacos or sushi"), { question: "where should we eat?", options: ["pizza", "tacos", "sushi"] })
  assert.deepEqual(ruleParams("countdown", "make a countdown to Christmas", { now: NOW }), { event: "Christmas", date: "12/25/2026" })
  assert.deepEqual(ruleParams("countdown", "make a countdown to our trip on 2026-11-20"), { event: "Trip", date: "11/20/2026" })
  assert.deepEqual(ruleParams("quiz", "make a quiz: 2+2? 3 / *4 / 5; Capital of France? *Paris / Rome / Oslo").questions.map((q) => q.correct), [2, 1])
  assert.equal(toUsDate("dec 5 2026"), "12/05/2026")
  assert.equal(vbStr('say "hi"\nnow'), '"say ""hi"" now"')
})

test("every program kind builds a project Visual Basic 98 accepts, quotes and all", () => {
  for (const [kind, k] of Object.entries(KINDS)) {
    const v = validateParams(kind, k.example[1])
    assert.equal(v.ok, true, kind)
    assert.equal(checkProject(buildProject(kind, v.params)).ok, true, kind)
  }
  // nasty text from a model still compiles
  const v = validateParams("quiz", { questions: [{ q: 'He said "hi" & left? \\ end', answers: ['"A"', "B & C", "D'E"], correct: 3 }] })
  assert.equal(checkProject(buildProject("quiz", v.params)).ok, true)
  // a poll with 2 or 4 options lays out and compiles
  for (const options of [["Yes", "No"], ["A", "B", "C", "D"]]) assert.equal(checkProject(buildProject("poll", { question: "Q?", options })).ok, true)
})

test("a generated quiz runs: questions, the score, the last screen", async () => {
  const { params } = validateParams("quiz", { title: "T", questions: [{ q: "One?", answers: ["a", "b", "c"], correct: 2 }, { q: "Two?", answers: ["x", "y", "z"], correct: 1 }] })
  const p = buildProject("quiz", params)
  const c = compile(p.code, { controls: p.controls.map((x) => x.name) })
  const ctls = Object.fromEntries(p.controls.map((x) => [x.name.toLowerCase(), { __control: true, name: x.name, type: x.type, props: { caption: "", visible: true } }]))
  const shared = new Map()
  const R = makeRuntime({
    control: (n) => ctls[n] || null,
    get: (ctl, prop) => (prop === null ? ctl.props.caption : ctl.props[prop] ?? ""),
    set: (ctl, prop, v) => (ctl.props[prop === null ? "caption" : prop] = v),
    setAt: () => {},
    call: () => "",
    msgbox: async () => 1,
    inputbox: async () => "",
    sound: () => {},
    shared: { get: (k) => shared.get(k) ?? "", set: (k, v) => shared.set(k, v), keys: () => [...shared.keys()] },
    me: { name: "Brandon", host: true },
    friends: [],
    form: { get: () => 0, set: () => {} },
    error: (m) => assert.fail(m),
  })
  const procs = new Function("R", c.js)(R)
  await R.run(procs.form_load, [])
  assert.equal(ctls.label1.props.caption, "1. One?")
  assert.equal(ctls.command2.props.caption, "b")
  await R.run(procs.command2_click, []) // right
  await R.run(procs.command3_click, []) // wrong
  assert.match(ctls.label1.props.caption, /You got 1 of 2/)
  assert.equal(shared.get("score_Brandon"), 1)
})

test("generate -> check -> repair: the model's mistakes go back to it, then the program is built", async () => {
  const replies = [
    "I think a quiz is great!", // no JSON
    '{"title":"Space","questions":[{"q":"Red planet?","answers":["Mars","Venus"],"correct":1}]}', // 2 answers
    '{"title":"Space","questions":[{"q":"Red planet?","answers":["Venus","Mars","Jupiter"],"correct":"Mars"}]}', // fixed (correct as text is fine)
  ]
  const seen = []
  const r = await makeProgram("make me a quiz about space", {
    generate: async (messages) => {
      seen.push(messages.at(-1).content)
      return replies.shift()
    },
  })
  assert.equal(r.ok, true)
  assert.equal(r.via, "model")
  assert.equal(r.attempts, 3)
  assert.equal(r.params.questions[0].correct, 2)
  assert.match(seen[1], /Answer with a JSON object/)
  assert.match(seen[2], /exactly 3 "answers"/)
  // never right: it gives up with the last reason
  const bad = await makeProgram("make me a quiz about space", { generate: async () => "{}", maxAttempts: 2 })
  assert.equal(bad.ok, false)
  // no brain and nothing spelled out: says what to do
  assert.equal((await makeProgram("make me a quiz about space")).needsBrain, true)
  // spelled out: no model needed
  const poll = await makeProgram("make a poll: best paddle? Selkirk, Joola, Engage")
  assert.equal(poll.via, "rules")
  assert.deepEqual(poll.params.options, ["Selkirk", "Joola", "Engage"])
})
