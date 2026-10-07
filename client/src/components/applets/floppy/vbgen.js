// "Floppy, make me a program that...": Visual Basic 98 programs from a sentence. Pure (no DOM).
// A small model is good at filling in a form and bad at writing whole programs, so Floppy picks
// one of a few program kinds and fills its parameters (the question and choices of a poll, a
// quiz's questions...). The program itself is built here from a known-good pattern, then checked
// with Visual Basic 98's own validator and compiler; a parameter or compile problem goes back to
// the model to fix (generate -> check -> repair, at most a few rounds). Plain requests ("make a
// poll: where should we eat? pizza, tacos, sushi") need no model at all.
// Tested in hands.test.js.

import { CONTROL_TYPES } from "../vb98/controls.js"
import { templateById } from "../vb98/templates.js"
import { validateProject } from "../vb98/vbfile.js"
import { compile } from "../vb98/vblang.js"
import { firstObject, tryJson } from "./floppyCore.js"

// ---- building blocks (the same shape templates.js makes) ----

const C = (type, name, left, top, width, height, props = {}) => ({ type, name, left, top, width, height, visible: true, enabled: true, ...JSON.parse(JSON.stringify(CONTROL_TYPES[type].defaults)), ...props })
const project = (name, form, controls, code) => ({ v: 1, kind: "vb98", name: String(name).slice(0, 60), form: { backColor: "#c0c0c0", ...form }, controls, code: code.trim() + "\n", blocks: null, mode: "code" })
// a VB string literal: quotes doubled, one line, not too long
export const vbStr = (s, max = 120) => `"${String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/"/g, '""').trim().slice(0, max)}"`
const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const clean = (s, max = 120) => String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max)

// ---- the program kinds ----

export const KINDS = {
  poll: { title: "Poll", about: "everyone votes on a question; results update live (send it in Messenger)", schema: '{"question":"...","options":["...","...","..."]}', example: ["a poll on where to eat: pizza, tacos or sushi", { question: "Where should we eat?", options: ["Pizza", "Tacos", "Sushi"] }] },
  quiz: { title: "Quiz", about: "multiple-choice questions with a score", schema: '{"title":"...","questions":[{"q":"...","answers":["...","...","..."],"correct":1}]}', example: ["a quiz about space", { title: "Space Quiz", questions: [{ q: "Which planet is called the Red Planet?", answers: ["Venus", "Mars", "Jupiter"], correct: 2 }, { q: "What is the closest star to Earth?", answers: ["The Sun", "Sirius", "Polaris"], correct: 1 }] }] },
  eightball: { title: "Magic 8-Ball", about: "ask it a yes-or-no question for a random answer", schema: '{"title":"...","answers":["...","..."]}', example: ["a magic 8-ball that answers like a pirate", { title: "Pirate 8-Ball", answers: ["Aye!", "Arr, no.", "Ask the parrot later.", "Shiver me timbers, yes!", "Walk the plank, no."] }] },
  countdown: { title: "Countdown", about: "days until a date everyone shares", schema: '{"event":"...","date":"MM/DD/YYYY"}', example: ["a countdown to Christmas", { event: "Christmas", date: "12/25/2026" }] },
  picker: { title: "Picker", about: "picks one thing at random from a list (who pays, what to watch)", schema: '{"title":"...","items":["...","..."]}', example: ["a program that picks who pays for dinner", { title: "Who Pays?", items: ["Brandon", "Sam", "Mia"] }] },
  hello: { title: "Hello", about: "a button that shows a message", schema: '{"title":"...","message":"..."}', example: ["a program that says happy birthday", { title: "Birthday", message: "Happy birthday!" }] },
}
// the ready-made ones Floppy opens as they are (no parameters)
const AS_IS = { tictactoe: /tic[\s-]*tac[\s-]*toe|noughts/, reaction: /reaction|reflex|how fast/, soundboard: /sound\s*board/, platformer: /platform|jump(er|ing)? game|star jumper/ }

// ---- understanding the request ----

const ASK = /\b(make|build|create|write|code|program|design|whip up|put together)\b[^.]*?\b(program|app|application|game|quiz|trivia|poll|vote|survey|8[\s-]?ball|eight[\s-]?ball|countdown|picker|randomi[sz]er|spinner|wheel|button|tic[\s-]*tac|soundboard|platformer)\b/i
// -> { kind } | { template: id } | null (not a program request)
export const detectVbRequest = (input) => {
  const text = String(input || "")
  if (!ASK.test(text) && !/\bvisual basic\b|\bvb ?98\b/i.test(text)) return null
  // "make a note about the quiz", "remind me about the poll": not a program
  if (/\b(note|notes|remind|reminder|calendar|event|task|to-?do|message|text|email)\b/i.test(text) && !/\b(program|app|application|visual basic)\b/i.test(text)) return null
  const t = text.toLowerCase()
  for (const [id, re] of Object.entries(AS_IS)) if (re.test(t)) return { template: id }
  if (/\b(quiz|trivia|questions)\b/.test(t)) return { kind: "quiz" }
  if (/\b(poll|vote|voting|survey)\b/.test(t)) return { kind: "poll" }
  if (/8[\s-]?ball|eight[\s-]?ball|fortune|magic answer/.test(t)) return { kind: "eightball" }
  if (/count\s*down|days (until|till|to)\b/.test(t)) return { kind: "countdown" }
  if (/\b(pick|picks|picker|choose|chooses|random(ly)?|spin|wheel|decide|who pays|draw names)\b/.test(t)) return { kind: "picker" }
  return { kind: "hello" }
}

const listOf = (s) =>
  String(s || "")
    .split(/\s*(?:,|\bor\b|\band\b|\/|;)\s*/i)
    .map((x) => clean(x.replace(/^(either|maybe)\s+/i, "").replace(/[?.!]+$/, ""), 40))
    .filter(Boolean)

// parameters read straight from the sentence when it spells them out; null = ask the model
export const ruleParams = (kind, input, { now = Date.now() } = {}) => {
  const text = String(input || "").trim()
  if (kind === "poll") {
    // "poll: where should we eat? pizza, tacos, sushi" / "a poll asking X with A, B and C"
    let m = /(?:poll|vote|survey)\s*(?:asking|about|on|:)?\s*(.+?\?)\s*(.+)$/i.exec(text)
    if (m) return { question: clean(m[1], 80), options: listOf(m[2].replace(/^(options?|choices?|with)\s*:?\s*/i, "")) }
    m = /(?:poll|vote|survey)\s+(?:on|about|for)\s+(.+?)\s*(?::|with|between)\s+(.+)$/i.exec(text)
    if (m) return { question: clean(m[1][0].toUpperCase() + m[1].slice(1).replace(/[?]*$/, "?"), 80), options: listOf(m[2]) }
    return null
  }
  if (kind === "quiz") {
    // the person wrote the questions: "quiz: Q? a / *b / c; Q2? ..." (* marks the right answer)
    const parts = text.replace(/^.*?\bquiz\b[^:]*:\s*/i, "").split(/\s*;\s*/)
    const qs = []
    for (const p of parts) {
      const m = /^(.+?\?)\s*(.+)$/.exec(p)
      if (!m) continue
      const answers = m[2].split(/\s*\/\s*/).map((a) => a.trim()).filter(Boolean)
      const correct = answers.findIndex((a) => a.startsWith("*")) + 1
      if (answers.length >= 2 && correct) qs.push({ q: m[1], answers: answers.map((a) => a.replace(/^\*/, "")), correct })
    }
    return qs.length ? { title: "Quiz", questions: qs } : null
  }
  if (kind === "countdown") {
    const m = /count\s*down\s+(?:to|until|till|for)\s+(.+?)(?:\s+(?:on|at)\s+(.+))?$/i.exec(text) || /days\s+(?:until|till|to)\s+(.+?)(?:\s+(?:on|at)\s+(.+))?$/i.exec(text)
    if (!m) return null
    const event = clean(m[1].replace(/^(the|my|our)\s+/i, ""), 40)
    const date = m[2] ? toUsDate(m[2]) : knownDate(event, now)
    return date ? { event: event[0].toUpperCase() + event.slice(1), date } : null
  }
  if (kind === "picker") {
    const m = /(?:between|from|among|of)\s+(.+)$/i.exec(text) || /:\s*(.+)$/.exec(text)
    if (!m) return null
    const items = listOf(m[1])
    return items.length >= 2 ? { title: /who pays/i.test(text) ? "Who Pays?" : "Picker", items } : null
  }
  if (kind === "hello") {
    const m = /(?:says?|shows?|saying|with the message)\s+["“]?(.+?)["”]?$/i.exec(text)
    return m ? { title: "Hello", message: clean(m[1], 80) } : null
  }
  if (kind === "eightball") {
    const m = /answers?\s*:?\s*(.+)$/i.exec(text)
    const answers = m ? listOf(m[1]) : null
    return { title: "Magic 8-Ball", answers: answers?.length >= 2 ? answers : ["Yes!", "No.", "Ask again later.", "Definitely.", "Don't count on it.", "Signs point to yes.", "Very doubtful.", "Without a doubt."] }
  }
  return null
}

// "12/25", "dec 25 2026", "2026-12-25" -> "MM/DD/YYYY"
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
export const toUsDate = (s, now = Date.now()) => {
  const t = String(s || "").trim().toLowerCase()
  const year = new Date(now).getUTCFullYear()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (m) return `${m[2].padStart(2, "0")}/${m[3].padStart(2, "0")}/${m[1]}`
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t)
  if (m) return `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : year}`
  m = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?$/.exec(t)
  if (m && MONTHS.includes(m[1])) return `${String(MONTHS.indexOf(m[1]) + 1).padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3] || year}`
  return null
}
const knownDate = (event, now) => {
  const y = new Date(now).getUTCFullYear()
  const md = /christmas|xmas/i.test(event) ? "12/25" : /new year/i.test(event) ? "01/01" : /halloween/i.test(event) ? "10/31" : /valentine/i.test(event) ? "02/14" : /independence|4th of july|fourth of july/i.test(event) ? "07/04" : null
  if (!md) return null
  const d = new Date(`${y}-${md.replace("/", "-")}T12:00:00Z`)
  return `${md}/${d.getTime() < now - 864e5 ? y + 1 : y}`
}

// ---- checking parameters (from the rules or the model) ----
// -> { ok: true, params } | { ok: false, error } (the error goes back to the model)
export const validateParams = (kind, p) => {
  if (!p || typeof p !== "object") return { ok: false, error: "Answer with a JSON object." }
  const strs = (a, max) => (Array.isArray(a) ? a.map((x) => clean(x, max)).filter(Boolean) : [])
  switch (kind) {
    case "poll": {
      const question = capFirst(clean(p.question, 80))
      const options = [...new Set(strs(p.options, 28).map(capFirst))].slice(0, 4)
      if (!question) return { ok: false, error: 'Missing "question".' }
      if (options.length < 2) return { ok: false, error: '"options" needs 2 to 4 short choices.' }
      return { ok: true, params: { question, options } }
    }
    case "quiz": {
      const qs = Array.isArray(p.questions) ? p.questions : []
      const questions = []
      for (const [i, q] of qs.slice(0, 8).entries()) {
        const text = clean(q?.q ?? q?.question, 100)
        const answers = strs(q?.answers ?? q?.options, 40).slice(0, 3)
        let correct = Number(q?.correct)
        // a model sometimes gives the right answer's text instead of its number
        if (!Number.isInteger(correct) && typeof q?.correct === "string") correct = answers.findIndex((a) => a.toLowerCase() === q.correct.toLowerCase()) + 1
        if (!text) return { ok: false, error: `Question ${i + 1} is missing its "q" text.` }
        if (answers.length !== 3) return { ok: false, error: `Question ${i + 1} needs exactly 3 "answers".` }
        if (!(correct >= 1 && correct <= 3)) return { ok: false, error: `Question ${i + 1}: "correct" must be 1, 2 or 3 (the right answer's place).` }
        questions.push({ q: text, answers, correct })
      }
      if (!questions.length) return { ok: false, error: '"questions" needs at least one question.' }
      return { ok: true, params: { title: clean(p.title, 40) || "Quiz", questions } }
    }
    case "eightball": {
      const answers = [...new Set(strs(p.answers, 40))].slice(0, 16)
      if (answers.length < 2) return { ok: false, error: '"answers" needs at least 2 answers.' }
      return { ok: true, params: { title: clean(p.title, 40) || "Magic 8-Ball", answers } }
    }
    case "countdown": {
      const event = clean(p.event, 40)
      const date = toUsDate(p.date)
      if (!event) return { ok: false, error: 'Missing "event".' }
      if (!date) return { ok: false, error: '"date" must look like MM/DD/YYYY.' }
      return { ok: true, params: { event, date } }
    }
    case "picker": {
      const items = [...new Set(strs(p.items, 30))].slice(0, 20)
      if (items.length < 2) return { ok: false, error: '"items" needs at least 2 things to pick from.' }
      return { ok: true, params: { title: clean(p.title, 40) || "Picker", items } }
    }
    case "hello": {
      const message = clean(p.message, 80)
      if (!message) return { ok: false, error: 'Missing "message".' }
      return { ok: true, params: { title: clean(p.title, 40) || "Hello", message } }
    }
    default:
      return { ok: false, error: `Unknown kind ${kind}.` }
  }
}

// ---- the programs ----

export const buildProject = (kind, p) => {
  if (kind === "poll") {
    const n = p.options.length
    const w = Math.floor((276 - (n - 1) * 6) / n)
    const buttons = p.options.map((o, i) => C("CommandButton", `Command${i + 1}`, 12 + i * (w + 6), 42, w, 30, { caption: o }))
    const labels = p.options.map((_, i) => C("Label", `Result${i + 1}`, 12, 86 + i * 22, 276, 20, { caption: "" }))
    const top = 86 + n * 22 + 10
    return project(
      p.question.replace(/[?]+$/, "").slice(0, 40) || "Poll",
      { caption: "Poll", width: 300, height: top + 60 },
      [C("Label", "Label1", 12, 10, 276, 24, { caption: p.question, fontSize: 14, fontBold: true }), ...buttons, ...labels, C("Label", "Status", 12, top, 276, 40, { caption: "", foreColor: "#000080" })],
      `
' Made by Floppy. Send it in Messenger: everyone's votes show up live.
Sub Form_Load()
  ShowResults
End Sub

${p.options.map((_, i) => `Sub Command${i + 1}_Click()\n  Vote Command${i + 1}.Caption\nEnd Sub`).join("\n\n")}

Sub Vote(choice)
  Shared("vote_" & Me.Name) = choice
  Sound.Play "pop"
End Sub

Sub Shared_Changed(Key As String)
  ShowResults
End Sub

Sub ShowResults()
  Dim k, mine
  Dim counts(${n - 1})
${p.options.map((_, i) => `  counts(${i}) = 0`).join("\n")}
  For Each k In Shared.Keys
    If Left(k, 5) = "vote_" Then
${p.options.map((_, i) => `      If Shared(k) = Command${i + 1}.Caption Then counts(${i}) = counts(${i}) + 1`).join("\n")}
    End If
  Next
${p.options.map((_, i) => `  Result${i + 1}.Caption = Command${i + 1}.Caption & ": " & counts(${i}) & " " & String(counts(${i}), "#")`).join("\n")}
  mine = Shared("vote_" & Me.Name)
  If mine = "" Then
    Status.Caption = "Tap your pick."
  Else
    Status.Caption = "You picked " & mine & ". Tap another to change it."
  End If
End Sub
`
    )
  }
  if (kind === "quiz") {
    const last = p.questions.length - 1
    const fill = p.questions.map((q, i) => [`  q(${i}) = ${vbStr(q.q)}`, ...q.answers.map((a, j) => `  a${j + 1}(${i}) = ${vbStr(a)}`), `  correct(${i}) = ${q.correct}`].join("\n")).join("\n")
    return project(
      p.title,
      { caption: p.title, width: 300, height: 260 },
      [
        C("Label", "Label1", 12, 10, 276, 48, { caption: "", fontSize: 13, fontBold: true }),
        C("CommandButton", "Command1", 12, 66, 276, 30),
        C("CommandButton", "Command2", 12, 102, 276, 30),
        C("CommandButton", "Command3", 12, 138, 276, 30),
        C("Label", "Label2", 12, 182, 276, 20, { caption: "" }),
        C("CommandButton", "Command4", 100, 210, 100, 28, { caption: "Play Again", visible: false }),
      ],
      `
' Made by Floppy: ${p.questions.length} question${p.questions.length === 1 ? "" : "s"}. Add more in Form_Load.
Dim q(${last}), a1(${last}), a2(${last}), a3(${last}), correct(${last})
Dim n, score

Sub Form_Load()
${fill}
  StartOver
End Sub

Sub StartOver()
  n = 0
  score = 0
  Command4.Visible = False
  ShowQuestion
End Sub

Sub ShowQuestion()
  If n > UBound(q) Then
    Label1.Caption = "Done! You got " & score & " of " & (UBound(q) + 1) & "."
    Command1.Visible = False
    Command2.Visible = False
    Command3.Visible = False
    Command4.Visible = True
    Shared("score_" & Me.Name) = score
    Exit Sub
  End If
  Command1.Visible = True
  Command2.Visible = True
  Command3.Visible = True
  Label1.Caption = (n + 1) & ". " & q(n)
  Command1.Caption = a1(n)
  Command2.Caption = a2(n)
  Command3.Caption = a3(n)
End Sub

Sub Answer(pick)
  If pick = correct(n) Then
    score = score + 1
    Label2.Caption = "Right!"
    Sound.Play "win"
  Else
    Label2.Caption = "Not quite."
    Sound.Play "lose"
  End If
  n = n + 1
  ShowQuestion
End Sub

Sub Command1_Click()
  Answer 1
End Sub

Sub Command2_Click()
  Answer 2
End Sub

Sub Command3_Click()
  Answer 3
End Sub

Sub Command4_Click()
  StartOver
End Sub
`
    )
  }
  if (kind === "eightball") {
    return project(
      p.title,
      { caption: p.title, width: 280, height: 290 },
      [
        C("Label", "Label1", 12, 10, 256, 20, { caption: "Ask a yes-or-no question:" }),
        C("TextBox", "Text1", 12, 32, 256, 24),
        C("Shape", "Shape1", 60, 66, 160, 160, { shape: "oval", fillColor: "#000000" }),
        C("Label", "Label2", 70, 120, 140, 56, { caption: "8", alignment: "center", foreColor: "#ffffff", fontSize: 12, fontBold: true }),
        C("CommandButton", "Command1", 90, 240, 100, 30, { caption: "Shake" }),
      ],
      `
' Made by Floppy.
Sub Command1_Click()
  Dim answers
  If Trim(Text1.Text) = "" Then
    MsgBox "Type a question first!"
    Exit Sub
  End If
  answers = Split(${vbStr(p.answers.map((a) => a.replace(/\|/g, "/")).join("|"), 900)}, "|")
  Label2.Caption = "..."
  Sound.Play "boing"
  Wait 600
  Label2.Caption = answers(Random(0, UBound(answers)))
End Sub
`
    )
  }
  if (kind === "countdown") {
    return project(
      `${p.event} Countdown`,
      { caption: `${p.event} Countdown`.slice(0, 80), width: 300, height: 220 },
      [
        C("Label", "Label1", 12, 10, 276, 20, { caption: `Counting down to ${p.event}:` }),
        C("TextBox", "Text1", 12, 32, 180, 24, { text: p.date }),
        C("CommandButton", "Command1", 200, 30, 88, 28, { caption: "Set Date" }),
        C("Label", "Label2", 12, 74, 276, 70, { caption: "", alignment: "center", fontSize: 28, fontBold: true, foreColor: "#000080" }),
        C("Label", "Label3", 12, 150, 276, 40, { caption: "", alignment: "center" }),
        C("Timer", "Timer1", 260, 180, 32, 32, { interval: 60000 }),
      ],
      `
' Made by Floppy. Everyone you send it to counts down to the same date.
Sub Form_Load()
  If Shared("date") <> "" Then Text1.Text = Shared("date")
  Update
End Sub

Sub Command1_Click()
  Shared("date") = Text1.Text
  Shared("setby") = Me.Name
End Sub

Sub Shared_Changed(Key As String)
  Text1.Text = Shared("date")
  Update
End Sub

Sub Timer1_Timer()
  Update
End Sub

Sub Update()
  Dim d
  d = DaysUntil(Text1.Text)
  If d > 1 Then
    Label2.Caption = d & " days"
  ElseIf d = 1 Then
    Label2.Caption = "Tomorrow!"
  ElseIf d = 0 Then
    Label2.Caption = "Today!"
    Sound.Play "tada"
  Else
    Label2.Caption = "It's past"
  End If
  If Shared("setby") <> "" Then Label3.Caption = "Set by " & Shared("setby")
End Sub
`
    )
  }
  if (kind === "picker") {
    return project(
      p.title,
      { caption: p.title, width: 280, height: 200 },
      [
        C("Label", "Label1", 12, 10, 256, 24, { caption: p.title, fontSize: 14, fontBold: true }),
        C("Label", "Label2", 12, 46, 256, 60, { caption: "?", alignment: "center", fontSize: 24, fontBold: true, foreColor: "#000080" }),
        C("CommandButton", "Command1", 90, 120, 100, 32, { caption: "Pick!" }),
        C("Label", "Label3", 12, 162, 256, 20, { caption: `${p.items.length} to pick from`, alignment: "center" }),
      ],
      `
' Made by Floppy. Change the list in Command1_Click.
Sub Command1_Click()
  Dim items, i
  items = Split(${vbStr(p.items.map((a) => a.replace(/\|/g, "/")).join("|"), 900)}, "|")
  For i = 1 To 8
    Label2.Caption = items(Random(0, UBound(items)))
    Sound.Play "click"
    Wait 80
  Next
  Label2.Caption = items(Random(0, UBound(items)))
  Sound.Play "tada"
End Sub
`
    )
  }
  // hello
  return project(
    p.title,
    { caption: p.title, width: 280, height: 160 },
    [C("Label", "Label1", 16, 20, 248, 40, { caption: "Tap the button!", fontSize: 14 }), C("CommandButton", "Command1", 90, 80, 100, 30, { caption: "Click me" })],
    `
' Made by Floppy.
Sub Command1_Click()
  Label1.Caption = ${vbStr(p.message, 80)}
  Sound.Play "tada"
End Sub
`
  )
}

// Visual Basic 98's own checks -> { ok: true, project } | { ok: false, error }
export const checkProject = (p) => {
  const v = validateProject(JSON.stringify(p))
  if (!v.ok) return { ok: false, error: v.error }
  const c = compile(v.project.code, { controls: v.project.controls.map((x) => x.name) })
  if (!c.ok) return { ok: false, error: `Line ${c.error.line}: ${c.error.message}` }
  return { ok: true, project: v.project }
}

// ---- the model's part ----

export const paramMessages = (kind, request, { today = "" } = {}) => {
  const k = KINDS[kind]
  return [
    { role: "system", content: `You fill in a ${k.title} program for Visual Basic 98 (${k.about}). Reply with ONE line of JSON in this shape and nothing else:\n${k.schema}${today ? `\nToday is ${today}.` : ""}${kind === "quiz" ? '\nWrite 3 to 5 questions with true, checkable facts; "correct" is the place (1-3) of the right answer.' : ""}` },
    { role: "user", content: k.example[0] },
    { role: "assistant", content: JSON.stringify(k.example[1]) },
    { role: "user", content: String(request).slice(0, 300) },
  ]
}
const parseJson = (text) => {
  const raw = firstObject(text)
  return raw ? tryJson(raw) : undefined
}

// The whole flow. generate(messages) -> text is the model (optional: without it only requests
// that spell everything out work). -> { ok, project, kind, via: "rules" | "model" | "template", attempts }
//                                   | { ok: false, error, kind, needsBrain? }
export const makeProgram = async (request, { generate = null, now = Date.now(), today = "", maxAttempts = 3 } = {}) => {
  const want = detectVbRequest(request)
  if (!want) return { ok: false, error: "That doesn't sound like a program request." }
  if (want.template) {
    const t = templateById(want.template)
    return { ok: true, project: t.make(), kind: want.template, via: "template", attempts: 0 }
  }
  const kind = want.kind
  const fromRules = ruleParams(kind, request, { now })
  if (fromRules) {
    const v = validateParams(kind, fromRules)
    if (v.ok) {
      const checked = checkProject(buildProject(kind, v.params))
      if (checked.ok) return { ok: true, project: checked.project, kind, via: "rules", attempts: 0, params: v.params }
    }
  }
  if (!generate) return { ok: false, kind, needsBrain: true, error: kind === "quiz" ? "Writing quiz questions needs my brain. Or spell them out: quiz: Q? a / *b / c; Q2? ..." : "I need my brain to fill that in. Or spell it out, like: poll: where should we eat? pizza, tacos, sushi" }
  let messages = paramMessages(kind, request, { today })
  let lastError = ""
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const out = await generate(messages)
    const v = validateParams(kind, parseJson(out))
    let error = v.ok ? null : v.error
    if (v.ok) {
      const checked = checkProject(buildProject(kind, v.params))
      if (checked.ok) return { ok: true, project: checked.project, kind, via: "model", attempts: attempt, params: v.params }
      error = `The program didn't compile (${checked.error}). Use plain text without special characters.`
    }
    lastError = error
    messages = [...messages, { role: "assistant", content: String(out).slice(0, 1500) }, { role: "user", content: `That wasn't right: ${error} Reply again with the fixed JSON only.` }]
  }
  return { ok: false, kind, error: `I couldn't get that program right (${lastError}).` }
}
