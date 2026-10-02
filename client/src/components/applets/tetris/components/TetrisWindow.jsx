import { useEffect, useRef, useState } from 'react'

import Board from './Board'
import GameStats from './GameStats'
import Previews from './Previews'

import {useBoard} from '../hooks/useBoard'
import {useGameController} from '../hooks/useGameController'
import {useGameStats} from '../hooks/useGameStats'
import {usePlayer} from '../hooks/usePlayer'

// Game rows=20 columns=10 setGameOver (true=game not started)
const TetrisWindow = ({rows, columns, setGameOver}) => {

    // gameStats initial state = buildGameStats() (LAZY INITIALIZATION, computation done only once and not necessary on subsequent re-renders)
    // buildGameStats sets initial state to --> level: 1, linesCompleted: 0,
    // linesPerLevel: 10, points: 0

    // addLinesCleared is a function that takes in the number of new lines cleared
    // and adjusts the state of gameStats accordingly. Utilizes useCallback for performance
    // optimization (? still need to know how exactly)
    const [gameStats, addLinesCleared] = useGameStats();

    // initial player has the following attributes --> collided: false, isFastDropping: false,
    // position: up top, array of tetrominoes (random), popped off tetromino from end of array of tetrominoes
    const [player, setPlayer, resetPlayer] = usePlayer();

    // takes in rows, columns from game, player/reset player from above, addLinesCleared from above
    const [board] = useBoard({
        rows,
        columns,
        player,
        resetPlayer,
        addLinesCleared
    })

    const { onKeyDown, paused, pause, resume } = useGameController({
        board,
        gameStats,
        player,
        setGameOver,
        setPlayer
    })

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

    const onBlur = () => {
        setFocused(false)
        if (!paused) {
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
            onFocus={onFocus}
            onBlur={onBlur}
            onMouseDown={() => windowRef.current.focus({ preventScroll: true })}
        >
            <aside className="tetrisSide">
                <div className="tetrisLabel">Next</div>
                <Previews tetrominoes={player.tetrominoes} />
            </aside>
            <div className="tetrisBoardWrap">
                <Board board={board}>
                    {paused && (
                        <div className="tetrisOverlay">
                            {focused ? "Paused\nPress P to resume" : "Click to resume"}
                        </div>
                    )}
                </Board>
            </div>
            <aside className="tetrisSide">
                <GameStats gameStats={gameStats}/>
            </aside>
        </div>
    )
}

export default TetrisWindow
