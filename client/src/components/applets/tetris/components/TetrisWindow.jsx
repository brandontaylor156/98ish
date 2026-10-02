import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import Board from './Board'
import GameStats, { KeyHints } from './GameStats'
import PiecePreview from './PiecePreview'
import TouchControls from './TouchControls'

import { useTetris } from '../hooks/useTetris'
import { useIsTouch } from '../../../../hooks/useMediaQuery'
import { NEXT_COUNT, visibleCells } from '../utils/engine'

// Below this width the side panels shrink so the board keeps most of the window
const COMPACT_WIDTH = 440

// "wide": roomy side panels. "compact": slim side panels, for narrow windows.
// Touch screens add on-screen controls: under the board when the window is tall
// ("portrait"), on either side of it when wide ("landscape").
const pickLayout = ({ width, height }, touch) => {
    if (touch) return height >= width ? "portrait" : "landscape"
    return width < COMPACT_WIDTH ? "compact" : "wide"
}

const useSize = (ref) => {
    const [size, setSize] = useState(null)
    useLayoutEffect(() => {
        const element = ref.current
        const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight })
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(element)
        return () => observer.disconnect()
    }, [])
    return size
}

// One game in progress. Reports the final state through onGameOver; onQuit ends early.
const TetrisWindow = ({ onGameOver, onQuit }) => {
    const { game, press, release, onKeyDown, onKeyUp, releaseKeys, pause, resume } = useTetris()
    const cells = useMemo(() => visibleCells(game), [game.board, game.active])
    const touch = useIsTouch()

    useEffect(() => {
        if (game.status === "over") onGameOver(game)
    }, [game.status])

    // The window itself takes keyboard focus. Losing focus (clicking another window)
    // pauses the game; clicking back in resumes it.
    const windowRef = useRef(null)
    const [focused, setFocused] = useState(false)
    const pausedByBlur = useRef(false)
    const size = useSize(windowRef)
    const layout = size ? pickLayout(size, touch) : "wide"

    const focusWindow = () => windowRef.current.focus({ preventScroll: true })

    useEffect(() => {
        focusWindow()
    }, [])

    // Switching apps or locking the phone doesn't always blur the window; pause anyway
    useEffect(() => {
        const onVisibilityChange = () => {
            if (!document.hidden) return
            releaseKeys()
            pause()
        }
        document.addEventListener("visibilitychange", onVisibilityChange)
        return () => document.removeEventListener("visibilitychange", onVisibilityChange)
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

    // Name of the last line clear: under the stats, or floated over the board when the
    // side panels are too slim for it
    const clearLabel = game.lastClear && (
        <div key={game.lastClear.id} className="tetrisClear">
            {game.lastClear.labels.map((label) => <div key={label}>{label}</div>)}
            {game.lastClear.points > 0 && <div>+{game.lastClear.points.toLocaleString()}</div>}
        </div>
    )

    // Buttons in the pause overlay mustn't start a refocus of the window under them
    const keepFocus = (event) => event.stopPropagation()

    return (
        <div
            className={layout === "wide" ? "tetrisWindow" : "tetrisWindow tetrisWindow--compact"}
            data-layout={layout}
            tabIndex={0}
            ref={windowRef}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            onFocus={onFocus}
            onBlur={onBlur}
            onMouseDown={focusWindow}
        >
            <aside className="tetrisSide tetrisSide--left">
                <div>
                    <div className="tetrisLabel">Hold</div>
                    <PiecePreview type={game.hold} dimmed={game.holdUsed} />
                </div>
                <GameStats score={game.score} level={game.level} lines={game.lines} />
                {layout === "wide" && clearLabel}
                {touch && (
                    <button
                        type="button"
                        className="tetrisPauseButton"
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={pause}
                    >
                        Pause
                    </button>
                )}
            </aside>
            {layout !== "wide" && clearLabel}
            <div className="tetrisBoardWrap">
                <Board cells={cells}>
                    {game.status === "paused" && (
                        <div className="tetrisOverlay">
                            {focused ? (
                                <>
                                    <div>Paused</div>
                                    {!touch && <div className="tetrisOverlayHint">Press P or Esc to resume</div>}
                                    <button onMouseDown={keepFocus} onClick={resume}>Resume</button>
                                    <button onMouseDown={keepFocus} onClick={onQuit}>End game</button>
                                </>
                            ) : (
                                <div>{touch ? "Tap to resume" : "Click to resume"}</div>
                            )}
                        </div>
                    )}
                </Board>
            </div>
            <aside className="tetrisSide tetrisSide--right">
                <div className="tetrisLabel">Next</div>
                {game.queue.slice(0, NEXT_COUNT).map((type, i) => (
                    <PiecePreview key={i} type={type} small={i > 0} />
                ))}
                {!touch && <KeyHints />}
            </aside>
            {touch && <TouchControls press={press} release={release} onActivate={focusWindow} />}
        </div>
    )
}

export default TetrisWindow
