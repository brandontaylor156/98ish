// Visual Basic 98's starter programs (File > New from Template). Each is a whole project
// (vbfile.js) that runs as-is; the ones marked shared are made to be sent in Messenger.

import { CONTROL_TYPES } from "./controls.js"

// a control with the type's defaults
const C = (type, name, left, top, width, height, props = {}) => ({
  type,
  name,
  left,
  top,
  width,
  height,
  visible: true,
  enabled: true,
  ...JSON.parse(JSON.stringify(CONTROL_TYPES[type].defaults)),
  ...props,
})
const project = (name, form, controls, code) => ({ v: 1, kind: "vb98", name, form: { backColor: "#c0c0c0", ...form }, controls, code: code.trim() + "\n", blocks: null, mode: "code" })

const poll = () =>
  project(
    "Poll",
    { caption: "Poll", width: 300, height: 250 },
    [
      C("Label", "Label1", 12, 10, 276, 24, { caption: "Where should we eat?", fontSize: 14, fontBold: true }),
      C("CommandButton", "Command1", 12, 42, 88, 30, { caption: "Pizza" }),
      C("CommandButton", "Command2", 106, 42, 88, 30, { caption: "Tacos" }),
      C("CommandButton", "Command3", 200, 42, 88, 30, { caption: "Sushi" }),
      C("Label", "Label2", 12, 86, 276, 20),
      C("Label", "Label3", 12, 108, 276, 20),
      C("Label", "Label4", 12, 130, 276, 20),
      C("Label", "Label5", 12, 170, 276, 40, { caption: "", foreColor: "#000080" }),
    ],
    `
' A poll for everyone you send it to. Change the question and the
' three buttons' captions in the Properties window.

Sub Form_Load()
  ShowResults
End Sub

Sub Command1_Click()
  Vote Command1.Caption
End Sub

Sub Command2_Click()
  Vote Command2.Caption
End Sub

Sub Command3_Click()
  Vote Command3.Caption
End Sub

Sub Vote(choice)
  Shared("vote_" & Me.Name) = choice
  Sound.Play "pop"
End Sub

' runs whenever anyone votes (you too)
Sub Shared_Changed(Key As String)
  ShowResults
End Sub

Sub ShowResults()
  Dim k, a, b, c, mine
  a = 0
  b = 0
  c = 0
  For Each k In Shared.Keys
    If Left(k, 5) = "vote_" Then
      If Shared(k) = Command1.Caption Then a = a + 1
      If Shared(k) = Command2.Caption Then b = b + 1
      If Shared(k) = Command3.Caption Then c = c + 1
    End If
  Next
  Label2.Caption = Command1.Caption & ": " & a & " " & String(a, "#")
  Label3.Caption = Command2.Caption & ": " & b & " " & String(b, "#")
  Label4.Caption = Command3.Caption & ": " & c & " " & String(c, "#")
  mine = Shared("vote_" & Me.Name)
  If mine = "" Then
    Label5.Caption = "Tap your pick."
  Else
    Label5.Caption = "You picked " & mine & ". Tap another to change it."
  End If
End Sub
`
  )

const quiz = () =>
  project(
    "Quiz",
    { caption: "Quiz", width: 300, height: 260 },
    [
      C("Label", "Label1", 12, 10, 276, 48, { caption: "", fontSize: 13, fontBold: true }),
      C("CommandButton", "Command1", 12, 66, 276, 30),
      C("CommandButton", "Command2", 12, 102, 276, 30),
      C("CommandButton", "Command3", 12, 138, 276, 30),
      C("Label", "Label2", 12, 182, 276, 20, { caption: "" }),
      C("CommandButton", "Command4", 100, 210, 100, 28, { caption: "Play Again", visible: false }),
    ],
    `
' Three questions. Add more by making the arrays bigger in Form_Load.
Dim q(2), a1(2), a2(2), a3(2), correct(2)
Dim n, score

Sub Form_Load()
  q(0) = "Which planet is called the Red Planet?"
  a1(0) = "Venus"
  a2(0) = "Mars"
  a3(0) = "Jupiter"
  correct(0) = 2
  q(1) = "How many points win a pickleball game?"
  a1(1) = "11"
  a2(1) = "15"
  a3(1) = "21"
  correct(1) = 1
  q(2) = "What year came before 1999?"
  a1(2) = "1997"
  a2(2) = "2000"
  a3(2) = "1998"
  correct(2) = 3
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

const tictactoe = () => {
  const cells = []
  for (let i = 0; i < 9; i++) cells.push(C("CommandButton", `Cell${i + 1}`, 30 + (i % 3) * 82, 44 + Math.floor(i / 3) * 82, 78, 78, { caption: "", fontSize: 28, fontBold: true }))
  const clicks = cells.map((c, i) => `Sub ${c.name}_Click()\n  Play ${i + 1}\nEnd Sub`).join("\n\n")
  const draws = cells.map((c, i) => `  ${c.name}.Caption = Show(Mid(b, ${i + 1}, 1))`).join("\n")
  return project(
    "Tic-Tac-Toe",
    { caption: "Tic-Tac-Toe", width: 306, height: 340 },
    [
      C("Label", "Label1", 12, 12, 282, 24, { caption: "", alignment: "center", fontSize: 13, fontBold: true }),
      ...cells,
      C("CommandButton", "NewGame", 103, 296, 100, 30, { caption: "New Game" }),
    ],
    `
' Two players, each on their own phone: send it in Messenger.
' The first to tap is X, the next is O. The board lives in Shared.

Sub Form_Load()
  If Shared("board") = "" Then Shared("board") = "........."
  If Shared("turn") = "" Then Shared("turn") = "X"
  Draw
End Sub

${clicks}

Sub NewGame_Click()
  Shared("board") = "........."
  Shared("turn") = "X"
  Shared("X") = ""
  Shared("O") = ""
End Sub

Sub Shared_Changed(Key As String)
  Draw
End Sub

Sub Play(i)
  Dim b, mark
  b = Shared("board")
  If Winner(b) <> "" Then Exit Sub
  mark = MyMark()
  If mark = "" Then
    MsgBox "Two people are already playing this game."
    Exit Sub
  End If
  If Shared("turn") <> mark Then
    Label1.Caption = "Wait for your turn!"
    Exit Sub
  End If
  If Mid(b, i, 1) <> "." Then Exit Sub
  b = Left(b, i - 1) & mark & Mid(b, i + 1)
  Shared("board") = b
  If mark = "X" Then
    Shared("turn") = "O"
  Else
    Shared("turn") = "X"
  End If
  Sound.Play "click"
End Sub

' X or O for you (taking a free one the first time you play)
Function MyMark()
  If Shared("X") = Me.Name Then
    MyMark = "X"
  ElseIf Shared("O") = Me.Name Then
    MyMark = "O"
  ElseIf Shared("X") = "" Then
    Shared("X") = Me.Name
    MyMark = "X"
  ElseIf Shared("O") = "" Then
    Shared("O") = Me.Name
    MyMark = "O"
  Else
    MyMark = ""
  End If
End Function

Function Winner(b)
  Dim lines, k, a, c, d
  lines = Split("123 456 789 147 258 369 159 357")
  Winner = ""
  For Each k In lines
    a = Mid(b, Val(Mid(k, 1, 1)), 1)
    c = Mid(b, Val(Mid(k, 2, 1)), 1)
    d = Mid(b, Val(Mid(k, 3, 1)), 1)
    If a <> "." And a = c And c = d Then Winner = a
  Next
End Function

Function Show(ch)
  If ch = "." Then
    Show = ""
  Else
    Show = ch
  End If
End Function

Function Who(mark)
  If Shared(mark) = "" Then
    Who = mark
  Else
    Who = mark & " (" & Shared(mark) & ")"
  End If
End Function

Sub Draw()
  Dim b, w
  b = Shared("board")
  If Len(b) <> 9 Then b = "........."
${draws}
  w = Winner(b)
  If w <> "" Then
    Label1.Caption = Who(w) & " wins!"
    If Shared(w) = Me.Name Then Sound.Play "tada"
  ElseIf InStr(b, ".") = 0 Then
    Label1.Caption = "It's a tie!"
  Else
    Label1.Caption = "Turn: " & Who(Shared("turn"))
  End If
End Sub
`
  )
}

const reaction = () =>
  project(
    "Reaction Time",
    { caption: "Reaction Time", width: 300, height: 300 },
    [
      C("Label", "Label1", 12, 10, 276, 40, { caption: "", fontSize: 12 }),
      C("Shape", "Shape1", 75, 56, 150, 110, { shape: "rounded", fillColor: "#808080" }),
      C("CommandButton", "Command1", 100, 174, 100, 30, { caption: "Start" }),
      C("ListBox", "List1", 12, 212, 276, 76),
      C("Timer", "Timer1", 260, 176, 32, 32, { enabled: false }),
    ],
    `
' Tap Start, wait for green, tap the box. Best times are shared.
Dim started, waiting

Sub Form_Load()
  Label1.Caption = "Tap Start, then tap the box the moment it turns green."
  ShowBest
End Sub

Sub Command1_Click()
  Shape1.FillColor = vbRed
  Label1.Caption = "Wait for green..."
  Timer1.Interval = Random(1500, 4000)
  Timer1.Enabled = True
  waiting = True
  started = 0
End Sub

Sub Timer1_Timer()
  Timer1.Enabled = False
  Shape1.FillColor = vbGreen
  started = Timer
  waiting = False
End Sub

Sub Shape1_Click()
  Dim ms, best
  If waiting Then
    Timer1.Enabled = False
    waiting = False
    Shape1.FillColor = "#808080"
    Label1.Caption = "Too soon! Tap Start to try again."
    Sound.Play "lose"
  ElseIf started > 0 Then
    ms = Int((Timer - started) * 1000)
    started = 0
    Shape1.FillColor = "#808080"
    Label1.Caption = "Your time: " & ms & " ms"
    Sound.Play "tada"
    best = Shared("best_" & Me.Name)
    If best = "" Or ms < Val(best) Then Shared("best_" & Me.Name) = ms
  End If
End Sub

Sub Shared_Changed(Key As String)
  ShowBest
End Sub

Sub ShowBest()
  Dim k
  List1.Clear
  For Each k In Shared.Keys
    If Left(k, 5) = "best_" Then List1.AddItem Mid(k, 6) & ": " & Shared(k) & " ms"
  Next
End Sub
`
  )

const eightBall = () =>
  project(
    "Magic 8-Ball",
    { caption: "Magic 8-Ball", width: 280, height: 290 },
    [
      C("Label", "Label1", 12, 10, 256, 20, { caption: "Ask a yes-or-no question:" }),
      C("TextBox", "Text1", 12, 32, 256, 24),
      C("Shape", "Shape1", 60, 66, 160, 160, { shape: "oval", fillColor: "#000000" }),
      C("Label", "Label2", 80, 128, 120, 40, { caption: "8", alignment: "center", foreColor: "#ffffff", fontSize: 13, fontBold: true }),
      C("CommandButton", "Command1", 90, 240, 100, 30, { caption: "Shake" }),
    ],
    `
Sub Command1_Click()
  Dim answers
  If Trim(Text1.Text) = "" Then
    MsgBox "Type a question first!"
    Exit Sub
  End If
  answers = Split("Yes!|No.|Ask again later.|Definitely.|Don't count on it.|Signs point to yes.|Very doubtful.|Without a doubt.", "|")
  Label2.Caption = "..."
  Sound.Play "boing"
  Wait 600
  Label2.Caption = answers(Random(0, UBound(answers)))
End Sub
`
  )

const soundboard = () => {
  const sounds = ["ding", "chord", "tada", "click", "pop", "boing", "win", "lose", "chimes"]
  const buttons = sounds.map((s, i) => C("CommandButton", `Command${i + 1}`, 12 + (i % 3) * 92, 44 + Math.floor(i / 3) * 52, 86, 44, { caption: s[0].toUpperCase() + s.slice(1), fontSize: 13 }))
  return project(
    "Soundboard",
    { caption: "Soundboard", width: 300, height: 210 },
    [C("Label", "Label1", 12, 10, 276, 24, { caption: "Tap a sound!", fontSize: 13, fontBold: true }), ...buttons],
    `
${sounds.map((s, i) => `Sub Command${i + 1}_Click()\n  Sound.Play "${s}"\n  Label1.Caption = "${s[0].toUpperCase() + s.slice(1)}!"\nEnd Sub`).join("\n\n")}
`
  )
}

const countdown = () =>
  project(
    "Countdown",
    { caption: "Countdown", width: 300, height: 220 },
    [
      C("Label", "Label1", 12, 10, 276, 20, { caption: "Counting down to:" }),
      C("TextBox", "Text1", 12, 32, 180, 24, { text: "12/25/2026" }),
      C("CommandButton", "Command1", 200, 30, 88, 28, { caption: "Set Date" }),
      C("Label", "Label2", 12, 74, 276, 70, { caption: "", alignment: "center", fontSize: 28, fontBold: true, foreColor: "#000080" }),
      C("Label", "Label3", 12, 150, 276, 40, { caption: "", alignment: "center" }),
      C("Timer", "Timer1", 260, 180, 32, 32, { interval: 60000 }),
    ],
    `
' Everyone you send it to counts down to the same date.
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

const platformer = () =>
  project(
    "Star Jumper",
    { caption: "Star Jumper", width: 320, height: 300, backColor: "#87ceeb" },
    [
      C("Label", "Label1", 8, 6, 200, 20, { caption: "Stars: 0", fontBold: true }),
      C("Shape", "Ground", 0, 220, 320, 30, { fillColor: "#3c9a3c", borderColor: "#2a6e2a" }),
      C("Sprite", "Player", 40, 180, 40, 40, { costume: "🐸" }),
      C("Sprite", "Star", 220, 120, 32, 32, { costume: "⭐" }),
      C("CommandButton", "GoLeft", 8, 256, 90, 36, { caption: "◀ Left" }),
      C("CommandButton", "Jump", 115, 256, 90, 36, { caption: "Jump" }),
      C("CommandButton", "GoRight", 222, 256, 90, 36, { caption: "Right ▶" }),
      C("Timer", "Timer1", 280, 8, 32, 32, { interval: 40 }),
    ],
    `
' Catch the stars! Arrow keys or the buttons. The Timer runs the game:
' it moves the frog 25 times a second.
Dim vy, onGround, score, walk

Sub Form_Load()
  vy = 0
  score = 0
  walk = 0
End Sub

Sub Timer1_Timer()
  vy = vy + 1
  Player.Top = Player.Top + vy
  Player.Left = Player.Left + walk
  walk = walk * 0.8
  If Player.Top > Ground.Top - Player.Height Then
    Player.Top = Ground.Top - Player.Height
    vy = 0
    onGround = True
  End If
  If Player.Left < 0 Then Player.Left = 0
  If Player.Left > Form.Width - Player.Width Then Player.Left = Form.Width - Player.Width
  If Player.Touching(Star) Then
    score = score + 1
    Label1.Caption = "Stars: " & score
    Star.Left = Random(10, Form.Width - 50)
    Star.Top = Random(60, 170)
    Sound.Play "pop"
  End If
End Sub

Sub GoLeft_Click()
  walk = -8
End Sub

Sub GoRight_Click()
  walk = 8
End Sub

Sub Jump_Click()
  If onGround Then
    vy = -14
    onGround = False
    Sound.Play "boing"
  End If
End Sub

Sub Form_KeyDown(Key As String)
  Select Case Key
    Case "ArrowLeft"
      GoLeft_Click
    Case "ArrowRight"
      GoRight_Click
    Case "ArrowUp", " "
      Jump_Click
  End Select
End Sub
`
  )

const hello = () =>
  project(
    "Hello",
    { caption: "Hello", width: 280, height: 160 },
    [C("Label", "Label1", 16, 20, 248, 24, { caption: "Hi there!", fontSize: 14 }), C("CommandButton", "Command1", 90, 70, 100, 30, { caption: "Click me" })],
    `
Sub Command1_Click()
  Label1.Caption = "Hello, " & Me.Name & "!"
  Sound.Play "tada"
End Sub
`
  )

// [id, title, what it is, make, shared?]
export const TEMPLATES = [
  ["hello", "Hello", "A button that says hello", hello, false],
  ["poll", "Poll", "Everyone votes; results update live", poll, true],
  ["quiz", "Quiz", "Three questions and a score", quiz, false],
  ["tictactoe", "Tic-Tac-Toe", "Two players on two phones", tictactoe, true],
  ["reaction", "Reaction Time", "How fast are you? Shared best times", reaction, true],
  ["eightball", "Magic 8-Ball", "Ask it anything", eightBall, false],
  ["soundboard", "Soundboard", "Nine buttons, nine sounds", soundboard, false],
  ["countdown", "Countdown", "Days until a date you all share", countdown, true],
  ["platformer", "Star Jumper", "A tiny platform game with sprites", platformer, false],
].map(([id, title, about, make, shared]) => ({ id, title, about, make, shared }))

export const templateById = (id) => TEMPLATES.find((t) => t.id === id) || null
