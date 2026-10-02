import { useEffect, useMemo, useRef, useState } from 'react'

import Board from './Board'
import GameStats, { KeyHints } from './GameStats'
import PiecePreview from './PiecePreview'

import { useTetris } from '../hooks/useTetris'
import { NEXT_COUNT, visibleCells } from '../utils/engine'

// One game in progress. Reports the final state through onGameOver; onQuit ends early.
const TetrisWindow = ({ onGameOver, onQuit }) => {
    const { game, onKeyDown, onKeyUp, releaseKeys, pause, resume } = useTetris()
    const cells = useMemo(() => visibleCells(game), [game.board, game.active])

    useEffect(() => {
        if (game.status === "over") onGameOver(game)
    }, [game.status])

    // The window itself takes keyboard focus. Losing focus (clicking another window)
    // pauses the game; clicking back in resumes it.
    const windowRef = useRef(null)
    const [focused, setFocused] = useState(false)
    const pausedByBlur = useRef(false)

    useEffect(() => {
        windowRef.current.focus({ preventScroll: true })
    }, [])

    const onFocus = () => {
        setFocused(true)
        if (pausedByBlur.current) {
            pausedByBlur.current = false
            resume()
        }
    }

    const onBlur = (event) => {
        // Focus moving to a control inside the game (the End game button) isn't leaving it
        if (event.currentTarget.contains(event.relatedTarget)) return
        setFocused(false)
        releaseKeys()
        if (game.status === "playing") {
            pausedByBlur.current = true
            pause()
        }
    }

    return (
        <div
            className="tetrisWindow"
            tabIndex={0}
            ref={windowRef}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            onFocus={onFocus}
            onBlur={onBlur}
            onMouseDown={() => windowRef.current.focus({ preventScroll: true })}
        >
            <aside className="tetrisSide">
                <div>
                    <div className="tetrisLabel">Hold</div>
                    <PiecePreview type={game.hold} dimmed={game.holdUsed} />
                </div>
                <GameStats score={game.score} level={game.level} lines={game.lines} />
                {game.lastClear && (
                    <div key={game.lastClear.id} className="tetrisClear">
                        {game.lastClear.labels.map((label) => <div key={label}>{label}</div>)}
                        {game.lastClear.points > 0 && <div>+{game.lastClear.points.toLocaleString()}</div>}
                    </div>
                )}
            </aside>
            <div className="tetrisBoardWrap">
                <Board cells={cells}>
                    {game.status === "paused" && (
                        <div className="tetrisOverlay">
                            {focused ? (
                                <>
                                    <div>Paused</div>
                                    <div className="tetrisOverlayHint">Press P or Esc to resume</div>
                                    <button onMouseDown={(e) => e.stopPropagation()} onClick={onQuit}>End game</button>
                                </>
                            ) : (
                                <div>Click to resume</div>
                            )}
                        </div>
                    )}
                </Board>
            </div>
            <aside className="tetrisSide">
                <div className="tetrisLabel">Next</div>
                {game.queue.slice(0, NEXT_COUNT).map((type, i) => (
                    <PiecePreview key={i} type={type} small={i > 0} />
                ))}
                <KeyHints />
            </aside>
        </div>
    )
}

export default TetrisWindow
