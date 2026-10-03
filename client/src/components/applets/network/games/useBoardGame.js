import { useEffect, useRef, useState } from "react"
import { useNet } from "../NetContext"
import * as reversi from "../rules/reversi.js"
import * as chess from "../rules/chess.js"
import * as battleship from "../rules/battleship.js"
import { bestMove, evaluate } from "../rules/chessAI.js"

// Reversi, Chess and Battleship are played two ways with the same screens: against someone
// on the network (the server keeps the game and sends each player a "view"), or against the
// computer, right here in the browser. Either way a game gets { view, act }: the view has the
// same shape, and act has move / resign / draw / rematch.

export const useNetGame = (matchId) => {
  const net = useNet()
  return {
    view: net.matches[matchId] || null,
    act: {
      move: (move) => net.gameMove(matchId, move),
      resign: () => net.resign(matchId),
      draw: (action) => net.draw(matchId, action),
      rematch: () => net.rematch(matchId),
    },
  }
}

const YOU = "You"
const COMPUTER = "Computer"
const soloResult = (winnerIsYou, draw, reason) => ({ winner: draw ? null : winnerIsYou ? "you" : "computer", draw, reason, youWon: !draw && winnerIsYou, winnerName: draw ? null : winnerIsYou ? YOU : COMPUTER })
const NO_REMATCH = { you: false, them: false }

// Schedule the computer's turn: `think` runs after `delay` unless the game moved on
const useComputerTurn = (active, key, delay, think) => {
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(think, delay)
    return () => clearTimeout(timer)
  }, [active, key])
}

// ---------- Reversi ----------

export const useSoloReversi = () => {
  const [solo, setSolo] = useState(() => ({ round: 1, you: "b", game: reversi.newGame(), resigned: false }))
  const { game, you } = solo
  const them = reversi.other(you)
  const over = game.result || solo.resigned
  const computerTurn = !over && game.turn === them

  useComputerTurn(computerTurn, `${solo.round}:${game.moves}:${game.turn}`, 650, () => {
    setSolo((s) => {
      if (s.game.result || s.resigned || s.game.turn !== them) return s
      const square = reversi.bestMove(s.game)
      const r = square === null ? null : reversi.applyMove(s.game, square)
      return r?.ok ? { ...s, game: r.state } : s
    })
  })

  const result = solo.resigned
    ? soloResult(false, false, "resigned")
    : game.result && soloResult(game.result.winner === you, !game.result.winner, game.result.reason)

  const view = {
    id: "solo",
    game: "reversi",
    solo: true,
    round: solo.round,
    you,
    names: { [you]: YOU, [them]: COMPUTER },
    board: game.board,
    turn: game.turn,
    moves: game.moves,
    last: game.last,
    passed: game.passed,
    legal: !over && game.turn === you ? reversi.legalMoves(game.board, you) : [],
    counts: reversi.countDiscs(game.board),
    thinking: computerTurn,
    result,
    rematch: NO_REMATCH,
  }
  const act = {
    move: async ({ square }) => {
      const r = reversi.applyMove(game, square)
      if (r.ok) setSolo((s) => ({ ...s, game: r.state }))
      return r.ok ? { ok: true } : r
    },
    resign: async () => (setSolo((s) => ({ ...s, resigned: true })), { ok: true }),
    // a new game, swapping colors (or playing the color asked for)
    rematch: async (color) => {
      setSolo((s) => ({ round: s.round + 1, you: color || reversi.other(s.you), game: reversi.newGame(), resigned: false }))
      return { ok: true }
    },
  }
  return { view, act }
}

// ---------- Chess ----------

export const CHESS_LEVELS = { 1: "Easy", 2: "Normal", 3: "Hard" }

// The computer thinks in a Web Worker so the window never freezes; without workers it
// thinks here, a little shallower
const makeThinker = () => {
  let worker = null
  try {
    worker = new Worker(new URL("../rules/chessWorker.js", import.meta.url), { type: "module" })
  } catch {
    worker = null
  }
  let seq = 0
  const waiting = new Map()
  if (worker) {
    worker.onmessage = ({ data }) => {
      waiting.get(data.id)?.(data.move)
      waiting.delete(data.id)
    }
  }
  return {
    think: (game, depth) =>
      new Promise((resolve) => {
        if (worker) {
          const id = ++seq
          waiting.set(id, resolve)
          worker.postMessage({ id, game, depth })
        } else {
          setTimeout(() => resolve(bestMove(game, { depth: Math.min(depth, 2) })), 30)
        }
      }),
    stop: () => worker?.terminate(),
  }
}

export const useSoloChess = () => {
  const [solo, setSolo] = useState(() => ({ round: 1, you: "w", game: chess.newGame(), resigned: false, agreed: false, level: 2, declined: 0 }))
  const thinker = useRef(null)
  const { game, you } = solo
  const them = chess.other(you)
  const over = game.result || solo.resigned || solo.agreed
  const computerTurn = !over && game.turn === them

  useEffect(() => {
    thinker.current = makeThinker()
    return () => thinker.current.stop()
  }, [])

  useComputerTurn(computerTurn, `${solo.round}:${game.sans.length}`, 250, () => {
    const startedOn = game
    const started = Date.now()
    thinker.current.think(game, solo.level).then((move) => {
      // at least a moment, so the reply doesn't feel instant
      setTimeout(
        () =>
          setSolo((s) => {
            // (not after you resigned or took a draw while it was thinking)
            if (s.game !== startedOn || s.resigned || s.agreed || !move) return s
            const r = chess.applyMove(s.game, move)
            return r.ok ? { ...s, game: r.state } : s
          }),
        Math.max(0, 450 - (Date.now() - started))
      )
    })
  })

  const result = solo.resigned
    ? soloResult(false, false, "resigned")
    : solo.agreed
      ? soloResult(false, true, "agreed")
      : game.result && soloResult(game.result.winner === you, !game.result.winner, game.result.reason)

  const view = {
    id: "solo",
    game: "chess",
    solo: true,
    round: solo.round,
    you,
    level: solo.level,
    names: { [you]: YOU, [them]: COMPUTER },
    board: game.board,
    turn: game.turn,
    check: game.check,
    sans: game.sans,
    last: game.last,
    legal: !over && game.turn === you ? chess.movesForView(game) : [],
    captured: chess.captured(game.board),
    thinking: computerTurn,
    drawOffer: null,
    drawDeclined: solo.declined,
    result,
    rematch: NO_REMATCH,
  }
  const act = {
    move: async (move) => {
      const r = chess.applyMove(game, move)
      if (r.ok) setSolo((s) => ({ ...s, game: r.state }))
      return r.ok ? { ok: true } : r
    },
    resign: async () => (setSolo((s) => ({ ...s, resigned: true })), { ok: true }),
    // the computer takes a draw only when it's worse off
    draw: async (action) => {
      if (action !== "offer" || over) return { ok: false }
      const score = evaluate(game) * (them === "w" ? 1 : -1)
      if (score < -150) setSolo((s) => ({ ...s, agreed: true }))
      else setSolo((s) => ({ ...s, declined: s.declined + 1 }))
      return { ok: true }
    },
    rematch: async (color) => {
      setSolo((s) => ({ ...s, round: s.round + 1, you: color || chess.other(s.you), game: chess.newGame(), resigned: false, agreed: false }))
      return { ok: true }
    },
    setLevel: (level) => setSolo((s) => ({ ...s, level })),
  }
  return { view, act }
}

// ---------- Battleship ----------

const newSoloBattle = (round, first) => {
  // the computer is side 1 and places its fleet straight away
  const placed = battleship.place(battleship.newGame(), 1, battleship.randomFleet()).state
  return { round, first, game: { ...placed, turn: first }, resigned: false }
}

export const useSoloBattleship = () => {
  const [solo, setSolo] = useState(() => newSoloBattle(1, 0))
  const { game } = solo
  const over = game.phase === "over" || solo.resigned
  const computerTurn = !over && game.phase === "playing" && game.turn === 1

  useComputerTurn(computerTurn, `${solo.round}:${game.sides[0].shots.length}`, 800, () => {
    setSolo((s) => {
      if (s.resigned || s.game.phase !== "playing" || s.game.turn !== 1) return s
      const cell = battleship.aiShot(battleship.enemyView(s.game, 1))
      const r = battleship.fire(s.game, 1, cell)
      return r.ok ? { ...s, game: r.state } : s
    })
  })

  const result = solo.resigned ? soloResult(false, false, "resigned") : game.phase === "over" ? soloResult(game.winner === 0, false, "sunk") : null
  const view = {
    id: "solo",
    game: "battleship",
    solo: true,
    round: solo.round,
    names: { you: YOU, them: COMPUTER },
    phase: game.phase,
    placed: { you: !!game.sides[0].fleet, them: true },
    yourTurn: !over && game.phase === "playing" && game.turn === 0,
    firstShot: solo.first === 0 ? "you" : "them",
    own: battleship.ownView(game, 0),
    enemy: battleship.enemyView(game, 0),
    last: game.last && { ...game.last, by: game.last.by === 0 ? "you" : "them" },
    thinking: computerTurn,
    result,
    rematch: NO_REMATCH,
  }
  if (result) view.enemyFleet = game.sides[1].fleet
  const act = {
    move: async (move) => {
      const r = move.fleet !== undefined ? battleship.place(game, 0, move.fleet) : battleship.fire(game, 0, move.cell)
      if (r.ok) setSolo((s) => ({ ...s, game: r.state }))
      return r.ok ? { ok: true } : r
    },
    resign: async () => (setSolo((s) => ({ ...s, resigned: true })), { ok: true }),
    rematch: async () => (setSolo((s) => newSoloBattle(s.round + 1, 1 - s.first)), { ok: true }),
  }
  return { view, act }
}

// A board that fills the space it's given: the largest multiple of `cells` that fits
export const useBoardSize = (ref, cells, deps = [], min = 160) => {
  const [size, setSize] = useState(320)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize(Math.max(min, Math.floor(Math.min(el.clientWidth - 8, el.clientHeight - 8) / cells) * cells))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, deps)
  return size
}
