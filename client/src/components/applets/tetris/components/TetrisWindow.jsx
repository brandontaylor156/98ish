import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import Board from './Board'
import GameStats, { KeyHints } from './GameStats'
import PiecePreview from './PiecePreview'
import TouchControls, { useTouchControlsVisible } from '../../../shared/controls'
import { useControlsStore } from '../../../shared/controls/store'
import { controlsFor, controlsGameFor } from './tetrisControls'
import TouchSettings from './TouchSettings'
import { useSwipeControls } from '../hooks/useSwipeControls'
import { hintSeen, markHintSeen, useTetrisTouchPrefs } from '../utils/touchPrefs'

import { NEXT_COUNT, pendingLines, visibleCells } from '../utils/engine'
import { ITEM_INFO } from '../utils/items'

// Below this width the side panels shrink so the board keeps most of the window
const COMPACT_WIDTH = 440

// "wide": roomy side panels. "compact": slim side panels, for narrow windows.
// Touch screens add on-screen controls (shared/controls, which players can rearrange):
// room for them is kept under the board when the window is tall ("portrait"), on either
// side of it when wide ("landscape").
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

// One game in progress, driven by a useTetris() instance. Reports the end through
// onGameOver; onQuit ends early. Online matches add: no pausing, an incoming-garbage meter,
// an item slot (Arena), Darkness, and an overlay over the board (countdown, KO...).
// stats: [{ label, value }] for the left panel (default: score, level, lines).
const TetrisWindow = ({ tetris, onGameOver, onQuit, editControls = false, stats, online = false, item, dark = false, overlay = null }) => {
    const { game, press, release, onKeyDown, onKeyUp, releaseKeys, pause, resume } = tetris
    const cells = useMemo(() => visibleCells(game), [game.board, game.active, game.finale])
    const touch = useTouchControlsVisible()
    const [editing, setEditing] = useState(editControls)
    // Touch: swipe gestures on the board and/or on-screen buttons (Customize controls)
    const touchPrefs = useTetrisTouchPrefs()
    const scheme = touch ? touchPrefs.scheme : "buttons"
    const swipe = scheme !== "buttons"
    const { haptics } = useControlsStore().prefs
    const controls = useMemo(() => controlsFor({ item: item !== undefined, pause: !online, scheme }), [item !== undefined, online, scheme])
    const meter = online ? pendingLines(game) : 0

    useEffect(() => {
        if (game.status === "over") onGameOver(game)
    }, [game.status, game.kos])

    // The window itself takes keyboard focus. Losing focus (clicking another window)
    // pauses the game; clicking back in resumes it.
    const windowRef = useRef(null)
    const [focused, setFocused] = useState(false)
    const pausedByBlur = useRef(false)
    const size = useSize(windowRef)
    const layout = size ? pickLayout(size, touch) : "wide"

    const focusWindow = () => windowRef.current.focus({ preventScroll: true })

    // The first game with swipe controls shows how they work until the first touch
    const [swipeHint, setSwipeHint] = useState(() => swipe && !online && !editControls && !hintSeen())
    useEffect(() => {
        if (!swipeHint) return
        markHintSeen()
        const t = setTimeout(() => setSwipeHint(false), 8000)
        return () => clearTimeout(t)
    }, [swipeHint])
    const onSwipeTouch = () => {
        focusWindow()
        setSwipeHint(false)
    }

    useSwipeControls(windowRef, { enabled: swipe && !editing, tetris, prefs: touchPrefs, haptics, onTouch: onSwipeTouch })

    // (a new Tetris Online round mounts this again: don't take the keyboard from someone
    // typing in another window)
    useEffect(() => {
        const other = document.activeElement?.closest?.(".window")
        if (!other || other.contains(windowRef.current)) focusWindow()
    }, [])

    // Customizing the controls pauses the game; it stays paused afterwards
    useEffect(() => {
        if (!editing) return
        releaseKeys()
        pause()
    }, [editing, game.status === "playing"])

    const setEditingAndFocus = (value) => {
        setEditing(value)
        if (!value) focusWindow()
    }

    const onPadPress = (action) => {
        focusWindow()
        if (action === "pause") pause()
        else press(action)
    }

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
        if (game.status === "playing" && !online) {
            pausedByBlur.current = true
            pause()
        }
    }

    // Name of the last line clear: under the stats, or floated over the board when the
    // side panels are too slim for it
    const clearLabel = game.lastClear && (
        <div key={game.lastClear.id} className="tetrisClear">
            {game.lastClear.labels.map((label) => <div key={label}>{label}</div>)}
            {online
                ? game.lastClear.attack > 0 && <div>{game.lastClear.attack} line{game.lastClear.attack === 1 ? "" : "s"}!</div>
                : game.lastClear.points > 0 && <div>+{game.lastClear.points.toLocaleString()}</div>}
        </div>
    )

    // Buttons in the pause overlay mustn't start a refocus of the window under them
    const keepFocus = (event) => event.stopPropagation()

    return (
        <div
            className={layout === "wide" ? "tetrisWindow" : "tetrisWindow tetrisWindow--compact"}
            data-layout={layout}
            data-scheme={touch ? scheme : undefined}
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
                <GameStats stats={stats || [
                    { label: "Score", value: game.score.toLocaleString() },
                    { label: "Level", value: game.level },
                    { label: "Lines", value: game.lines },
                ]} />
                {layout === "wide" && clearLabel}
                {/* room for the default Pause and Hold buttons */}
                {touch && <div className={scheme === "gestures" ? "tetrisSideButtons tetrisSideButtons--slim" : "tetrisSideButtons"} />}
            </aside>
            {layout !== "wide" && clearLabel}
            <div className="tetrisBoardWrap">
                <Board cells={cells}>
                    {online && (
                        <div className="tetrisMeter" aria-label={`${meter} garbage lines coming`} data-lines={meter}>
                            <div style={{ height: `${Math.min(100, meter * 5)}%` }} />
                        </div>
                    )}
                    {game.shield && <div className="tetrisShield" title="Shield: blocks the next garbage" />}
                    {dark && <div className="tetrisDark" />}
                    {overlay}
                    {swipeHint && swipe && game.status === "playing" && (
                        <div className="tetrisSwipeHint" aria-live="polite">
                            <div><b>Drag</b> to move</div>
                            <div><b>Tap</b> to rotate</div>
                            <div><b>Drag down</b> to soft drop</div>
                            <div><b>Flick down</b> to hard drop</div>
                            <div><b>Swipe up</b> to hold</div>
                        </div>
                    )}
                    {game.status === "paused" && (
                        <div className="tetrisOverlay">
                            {focused ? (
                                <>
                                    <div>Paused</div>
                                    {!touch && <div className="tetrisOverlayHint">Press P or Esc to resume</div>}
                                    <button onMouseDown={keepFocus} onClick={resume}>Resume</button>
                                    <button onMouseDown={keepFocus} onClick={onQuit}>End game</button>
                                    {touch && <button onMouseDown={keepFocus} onClick={() => setEditing(true)}>Controls...</button>}
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
                {item !== undefined && (
                    <div className="tetrisItemSlot" title={item ? ITEM_INFO[item].about : "Clear lines to earn an item"}>
                        <div className="tetrisLabel">Item</div>
                        <div className={item ? "tetrisItem" : "tetrisItem tetrisItem--empty"} data-item={item || ""}>
                            {item ? ITEM_INFO[item].name : "-"}
                        </div>
                        {!touch && item && <div className="tetrisItemHint"><kbd>V</kbd> to use</div>}
                    </div>
                )}
                {!touch && !online && <KeyHints />}
                {/* room for the default Item button */}
                {touch && item !== undefined && <div className="tetrisSideButtons tetrisSideButtons--item" />}
            </aside>
            {touch && layout === "portrait" && scheme !== "gestures" && <div className="tetrisPad" />}
            {touch && (
                <TouchControls
                    key={scheme}
                    game={controlsGameFor(scheme)}
                    controls={controls}
                    onPress={onPadPress}
                    onRelease={release}
                    editing={editing}
                    onEditingChange={setEditingAndFocus}
                    settings={<TouchSettings prefs={touchPrefs} />}
                />
            )}
        </div>
    )
}

export default TetrisWindow
