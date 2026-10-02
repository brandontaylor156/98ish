import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import MenuBar from "../../../shared/MenuBar"
import { DrawOffer, GameButtons, GameOver, PlayerBar, ResignDialog, ResultBanner, RulesDialog, waitingText } from "./GameParts"
import { CHESS_LEVELS, useNetGame, useSoloChess } from "./useBoardGame"
import { ChessPiece, PIECE_NAMES } from "./ChessPieces"
import "./BoardGames.css"

// Chess against another computer on the network, or against this one. Click (or drag) a
// piece, then where it goes. Black sees the board from their side.

const FILES = "abcdefgh"
const COLOR_NAME = { w: "White", b: "Black" }
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 }
const squareName = (i) => FILES[i % 8] + (8 - Math.floor(i / 8))
const colorOf = (p) => (!p ? null : p === p.toUpperCase() ? "w" : "b")
const other = (c) => (c === "w" ? "b" : "w")

const REASONS = {
  checkmate: (winner) => (winner === "You" ? "Checkmate! You win." : `Checkmate! ${winner} wins.`),
  stalemate: () => "Stalemate: it's a draw.",
  repetition: () => "The same position came up three times: it's a draw.",
  fifty: () => "Fifty moves without a capture or a pawn move: it's a draw.",
  material: () => "Neither side has enough pieces left to checkmate: it's a draw.",
  agreed: () => "Draw agreed.",
}

const Captured = ({ pieces, lead }) => (
  <span className="chTaken" aria-label={`captured ${pieces.length}`}>
    {pieces.map((p, i) => (
      <ChessPiece key={i} piece={p} className="chTakenPiece" />
    ))}
    {lead > 0 && <span className="chLead">+{lead}</span>}
  </span>
)

const MoveList = ({ sans, compact }) => {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (el) compact ? (el.scrollLeft = el.scrollWidth) : (el.scrollTop = el.scrollHeight)
  }, [sans.length, compact])
  const rows = []
  for (let i = 0; i < sans.length; i += 2) rows.push([i / 2 + 1, sans[i], sans[i + 1]])
  if (compact) {
    return (
      <div className="chMovesLine" ref={ref} aria-label="Moves">
        {rows.length ? rows.map(([n, w, b]) => <span key={n}><b>{n}.</b> {w} {b || ""}</span>) : <span className="chMovesEmpty">No moves yet</span>}
      </div>
    )
  }
  return (
    <div className="chMoves" ref={ref}>
      <table aria-label="Moves">
        <tbody>
          {rows.map(([n, w, b]) => (
            <tr key={n}>
              <td className="chMoveNo">{n}.</td>
              <td>{w}</td>
              <td>{b || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="chMovesEmpty">No moves yet</p>}
    </div>
  )
}

const ChessBoard = ({ view, act, onClose }) => {
  const [sel, setSel] = useState(null)
  const [promo, setPromo] = useState(null) // { from, to } waiting for a piece choice
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [sending, setSending] = useState(false)
  const [dialog, setDialog] = useState(null)
  const [turned, setTurned] = useState(false) // View > Flip Board
  const [drag, setDrag] = useState(null) // { from, x, y, moved }
  const [layout, setLayout] = useState({ wide: true, size: 320 })
  const rootRef = useRef(null)
  const areaRef = useRef(null)
  const draggedRef = useRef(false)

  const you = view.you
  const them = other(you)
  const themName = view.names[them]
  const result = view.result
  const yourTurn = !result && view.turn === you
  const legal = view.legal || []
  const flipped = (you === "b") !== turned

  useEffect(() => {
    setSel(null)
    setPromo(null)
    setError(null)
  }, [view.sans.length, view.round])

  useEffect(() => {
    if (view.drawDeclined) setNotice("The computer declines your draw offer.")
  }, [view.drawDeclined])
  useEffect(() => setNotice(null), [view.sans.length])

  // Side panel beside the board when there's room, the move list underneath when not
  useLayoutEffect(() => {
    const root = rootRef.current
    const area = areaRef.current
    if (!root || !area) return
    const measure = () => {
      const wide = root.clientWidth >= 540
      const size = Math.max(160, Math.floor(Math.min(area.clientWidth - 22, area.clientHeight - 22) / 8) * 8)
      setLayout((l) => (l.wide === wide && l.size === size ? l : { wide, size }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    observer.observe(area)
    return () => observer.disconnect()
  }, [layout.wide])

  const movesFrom = (square) => legal.filter((m) => m.from === square)
  // the piece being moved: the one being dragged, or the one clicked
  const active = drag?.moved ? drag.from : sel
  const targets = active === null ? [] : movesFrom(active)
  const targetSet = new Set(targets.map((m) => m.to))

  const send = async (move) => {
    setSending(true)
    setSel(null)
    const r = await act.move(move)
    setSending(false)
    if (!r.ok) setError(r.error)
  }

  const goTo = (to) => {
    const move = targets.find((m) => m.to === to)
    if (!move) return false
    if (move.promotion) setPromo({ from: move.from, to })
    else send({ from: move.from, to })
    return true
  }

  const choose = (square) => {
    setError(null)
    if (draggedRef.current) return (draggedRef.current = false)
    if (promo || sending) return
    if (!yourTurn) {
      if (!result && colorOf(view.board[square]) === you) setError(view.solo ? "Wait for the computer to move." : `It's ${themName}'s move.`)
      return
    }
    if (sel !== null && targetSet.has(square)) return goTo(square)
    if (colorOf(view.board[square]) === you) {
      if (!movesFrom(square).length) {
        setSel(null)
        return setError(view.check ? "You're in check: that piece can't help." : "That piece can't move right now.")
      }
      return setSel(square === sel ? null : square)
    }
    setSel(null)
  }

  // Dragging a piece: pick it up, follow the pointer, drop it on a highlighted square. A
  // press that doesn't move is just a click.
  const dragRef = useRef(null)
  const startDrag = (e, square) => {
    if (!yourTurn || promo || sending || colorOf(view.board[square]) !== you || !movesFrom(square).length) return
    if (e.button !== undefined && e.button !== 0) return
    dragRef.current = { from: square, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false }
    setDrag(dragRef.current)
  }
  useEffect(() => {
    if (!drag) return
    const move = (e) => {
      const d = dragRef.current
      if (!d) return
      dragRef.current = { ...d, x: e.clientX, y: e.clientY, moved: d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6 }
      if (dragRef.current.moved) setDrag(dragRef.current)
    }
    const up = (e) => {
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!d?.moved) return
      // the click that follows a drop isn't a click
      draggedRef.current = true
      setTimeout(() => (draggedRef.current = false), 50)
      setSel(null)
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-square]")
      const to = el ? Number(el.dataset.square) : -1
      const m = legal.find((x) => x.from === d.from && x.to === to)
      if (m?.promotion) setPromo({ from: d.from, to })
      else if (m) send({ from: d.from, to })
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
    }
  }, [!!drag, legal])

  const kingInCheck = view.check && !result?.draw ? view.board.indexOf(view.turn === "w" ? "K" : "k") : -1
  const winnerName = result && !result.draw ? (result.youWon ? view.names[you] : themName) : null
  const resultText = result
    ? result.reason === "resigned"
      ? result.youWon
        ? `${themName} resigned. You win!`
        : "You resigned."
      : REASONS[result.reason]?.(result.youWon ? "You" : winnerName) || (result.draw ? "It's a draw." : `${winnerName} wins.`)
    : null
  const status = result
    ? resultText
    : yourTurn
      ? view.check
        ? "Your move. You're in check!"
        : sel !== null
          ? `${PIECE_NAMES[view.board[sel].toLowerCase()][0].toUpperCase()}${PIECE_NAMES[view.board[sel].toLowerCase()].slice(1)} on ${squareName(sel)}: pick a square.`
          : "Your move."
      : view.check && !view.left && !view.away
        ? `${themName} is in check. ${view.solo ? "The computer is thinking..." : `Waiting for ${themName}...`}`
        : waitingText(view, themName)

  const material = (list) => list.reduce((sum, p) => sum + (VALUE[p.toLowerCase()] || 0), 0)
  const lead = material(view.captured[you]) - material(view.captured[them])

  const menus = [
    {
      label: "Game",
      items: [
        ...(view.solo
          ? [
              { label: "New Game (play White)", onClick: () => act.rematch("w") },
              { label: "New Game (play Black)", onClick: () => act.rematch("b") },
              "-",
            ]
          : []),
        { label: "Offer Draw", disabled: !!result || !!view.drawOffer, onClick: () => act.draw("offer") },
        { label: "Resign...", disabled: !!result, onClick: () => setDialog("resign") },
        ...(view.solo ? [] : [{ label: "Rematch", disabled: !result || view.rematch.you || view.left, onClick: () => act.rematch() }]),
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    { label: "View", items: [{ label: "Flip Board", checked: turned, onClick: () => setTurned(!turned) }] },
    ...(view.solo ? [{ label: "Level", items: Object.entries(CHESS_LEVELS).map(([level, label]) => ({ label, checked: view.level === Number(level), onClick: () => act.setLevel(Number(level)) })) }] : []),
    { label: "Help", items: [{ label: "Rules...", onClick: () => setDialog("rules") }] },
  ]

  const order = Array.from({ length: 64 }, (_, i) => (flipped ? 63 - i : i))
  const size = layout.size
  const fileLabels = flipped ? [...FILES].reverse() : [...FILES]
  const rankLabels = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1]

  const board = (
    <div className="ckArea chArea" ref={areaRef}>
      <div className="chFrame" style={{ width: size + 16, height: size + 16 }}>
        <div className="chRanks" aria-hidden="true">
          {rankLabels.map((r) => (
            <span key={r}>{r}</span>
          ))}
        </div>
        <div className="chBoard" style={{ width: size, height: size }} role="grid" aria-label="Chessboard">
          {order.map((square) => {
            const piece = view.board[square]
            const light = (Math.floor(square / 8) + (square % 8)) % 2 === 0
            const classes = ["chSquare", light ? "is-light" : "is-dark"]
            if (view.last && (view.last.from === square || view.last.to === square)) classes.push("is-last")
            if (active === square) classes.push("is-selected")
            if (targetSet.has(square)) classes.push(piece || (view.board[active]?.toLowerCase() === "p" && square % 8 !== active % 8) ? "is-capture" : "is-target")
            if (square === kingInCheck) classes.push("is-check")
            if (yourTurn && colorOf(piece) === you && movesFrom(square).length) classes.push("is-movable")
            const dragging = drag?.moved && drag.from === square
            return (
              <button
                type="button"
                key={square}
                className={classes.join(" ")}
                data-square={square}
                data-name={squareName(square)}
                onClick={() => choose(square)}
                onPointerDown={(e) => startDrag(e, square)}
                aria-label={`${squareName(square)}${piece ? ` ${COLOR_NAME[colorOf(piece)]} ${PIECE_NAMES[piece.toLowerCase()]}` : ""}`}
              >
                {piece && <ChessPiece piece={piece} className={dragging ? "chPiece is-lifted" : "chPiece"} />}
              </button>
            )
          })}
        </div>
        <div className="chFiles" aria-hidden="true">
          {fileLabels.map((f) => (
            <span key={f}>{f}</span>
          ))}
        </div>
        {promo && (
          <div className="chPromo" role="dialog" aria-label="Promote to">
            <p>Promote to:</p>
            <div>
              {["q", "r", "b", "n"].map((p) => (
                <button type="button" key={p} data-promote={p} aria-label={PIECE_NAMES[p]} onClick={() => (setPromo(null), send({ ...promo, promotion: p }))}>
                  <ChessPiece piece={you === "w" ? p.toUpperCase() : p} />
                </button>
              ))}
            </div>
            <button type="button" className="chPromoCancel" onClick={() => (setPromo(null), setSel(null))}>
              Cancel
            </button>
          </div>
        )}
      </div>
      {drag?.moved && (
        <div className="chDragGhost" style={{ left: drag.x, top: drag.y, width: size / 8, height: size / 8 }}>
          <ChessPiece piece={view.board[drag.from]} />
        </div>
      )}
    </div>
  )

  const top = <PlayerBar active={!result && view.turn === them} swatch={<span className={`chSwatch chSwatch--${them}`} />} name={themName} sub={<Captured pieces={view.captured[them]} lead={-lead} />} away={view.away} thinking={view.thinking} />
  const bottom = <PlayerBar active={yourTurn} swatch={<span className={`chSwatch chSwatch--${you}`} />} name={view.names[you]} you sub={<Captured pieces={view.captured[you]} lead={lead} />} />

  return (
    <div className={layout.wide ? "netApp ckRoot chRoot is-wide" : "netApp ckRoot chRoot"} ref={rootRef} data-game="chess">
      <MenuBar menus={menus} />
      <div className="chMain">
        <div className="chLeft">
          {top}
          {board}
          {bottom}
        </div>
        {layout.wide && (
          <div className="chSide">
            <b className="chSideTitle">Moves</b>
            <MoveList sans={view.sans} />
          </div>
        )}
      </div>
      {!layout.wide && <MoveList sans={view.sans} compact />}
      <DrawOffer view={view} act={act} them={themName} />
      <GameButtons view={view} act={act} onClose={onClose} onResign={() => setDialog("resign")} canDraw />
      <div className="status-bar">
        <p className={error ? "status-bar-field ckError" : "status-bar-field"} role="status">
          {error || notice || status}
        </p>
      </div>
      <ResultBanner view={view} them={themName} />

      {dialog === "resign" && <ResignDialog them={themName} onResign={() => (act.resign(), setDialog(null))} onCancel={() => setDialog(null)} />}
      {dialog === "rules" && (
        <RulesDialog title="Chess Rules" onOk={() => setDialog(null)}>
          Checkmate the other king: attack it so it has no way out. Click a piece to see where it can go, then click the
          square (or drag the piece there).
          <br />
          <br />
          To castle, move your king two squares toward a rook. A pawn that reaches the far side becomes the piece you
          choose. Stalemate, three repetitions of a position, 50 moves without a capture or pawn move, or too few pieces to
          checkmate make a draw.
        </RulesDialog>
      )}
    </div>
  )
}

const NetChess = ({ matchId, onClose }) => {
  const { view, act } = useNetGame(matchId)
  if (!view) return <GameOver />
  return <ChessBoard view={view} act={act} onClose={onClose} />
}

const SoloChess = ({ onClose }) => {
  const { view, act } = useSoloChess()
  return <ChessBoard view={view} act={act} onClose={onClose} />
}

const Chess = ({ matchId, onClose }) => (matchId ? <NetChess matchId={matchId} onClose={onClose} /> : <SoloChess onClose={onClose} />)

export default Chess
