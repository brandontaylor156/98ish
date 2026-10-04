import { useTouchControlsMenuItem, useTouchControlsVisible } from '../../../shared/controls'
import { useGameChatMenuItem } from '../../../shared/GameChat'
import GameStart from '../../../shared/GameStart'
import { MODES, SOLO_MODES, formatBest, formatTime } from '../utils/modes'

// One tetromino color per letter
const TITLE_COLORS = ["__z", "__l", "__o", "__s", "__i", "__t"]

const Row = ({ label, value }) => (
    <div className="tetrisResultRow"><span>{label}</span><span>{value}</span></div>
)

// The last game's summary, by mode
const Result = ({ result }) => {
    const { mode, game, isBest } = result
    const finished = game.endReason === "goal"
    const title = {
        marathon: finished ? "Marathon Complete!" : "Game Over",
        sprint: finished ? "Sprint Complete!" : "Topped Out",
        ultra: game.endReason === "time" ? "Time's Up!" : "Topped Out",
        survival: finished ? "You Survived!" : "Game Over",
    }[mode]
    return (
        <fieldset className="tetrisResult">
            <legend>{MODES[mode].name}: {title}</legend>
            {isBest && <div className="tetrisNewHigh">{mode === "sprint" ? "New best time!" : mode === "marathon" ? "New high score!" : "New best!"}</div>}
            {mode === "sprint" ? (
                <>
                    <Row label="Time" value={finished ? formatTime(game.time) : "-"} />
                    <Row label="Lines" value={game.lines} />
                    {game.splits.length > 0 && (
                        <div className="tetrisSplits">
                            {game.splits.map((s) => <span key={s.lines}>{s.lines}L {formatTime(s.time)}</span>)}
                        </div>
                    )}
                </>
            ) : (
                <>
                    <Row label="Score" value={game.score.toLocaleString()} />
                    <Row label="Lines" value={game.lines} />
                    <Row label="Level" value={game.level} />
                </>
            )}
            <Row label="Max combo" value={Math.max(0, game.stats.maxCombo)} />
            <Row label="T-spins" value={Object.values(game.stats.tSpins).reduce((a, b) => a + b, 0)} />
        </fieldset>
    )
}

// Title screen: a big Play (Marathon, or the mode just played) and Play Online, with the other
// solo modes and the options tucked away (shared/GameStart, docs/simplicity.md). Shows the
// last game's summary when a result is passed.
const Menu = ({ onPlay, onCustomize, onOnline, bests, result }) => {
    const touchControls = useTouchControlsMenuItem()
    const showControls = useTouchControlsVisible()
    const chat = useGameChatMenuItem('tetris')
    const again = result?.mode
    const main = again || "marathon"
    return (
        <div className="tetrisMenu">
            <GameStart
                id="tetris"
                title={
                    <div className="tetrisTitle">
                        {"TETRIS".split("").map((letter, i) => (
                            <span key={i} className={`tetrisTitleLetter tetromino${TITLE_COLORS[i]}`}>{letter}</span>
                        ))}
                    </div>
                }
                play={{
                    label: again ? `${MODES[main].name} again` : "Play",
                    sub: `${MODES[main].name} · Best: ${formatBest(main, bests[main])}`,
                    title: MODES[main].blurb,
                    className: "gameStart-play tetrisStartButton",
                    "data-mode": main,
                    autoFocus: true,
                    onClick: () => onPlay(main),
                }}
                online={{ onClick: onOnline, label: "Play Tetris Online", sub: "Battle 2P, Arena, Sprint Race against people anywhere", className: "tetrisOnlineButton" }}
                modes={SOLO_MODES.filter((mode) => mode !== main).map((mode) => ({
                    key: mode,
                    label: MODES[mode].name,
                    sub: `Best: ${formatBest(mode, bests[mode])}`,
                    title: MODES[mode].blurb,
                    className: "gameStart-mode tetrisModeButton",
                    "data-mode": mode,
                    onClick: () => onPlay(mode),
                }))}
                optionsSummary={`On-screen controls ${touchControls.checked ? "on" : "off"} · Game chat ${chat.checked ? "on" : "off"}`}
                options={
                    <div className="tetrisMenuControls">
                        <span>
                            <input id="tetris-touch-controls" type="checkbox" checked={touchControls.checked} onChange={touchControls.onClick} />
                            <label htmlFor="tetris-touch-controls">On-screen controls</label>
                        </span>
                        {showControls && <button type="button" onClick={onCustomize}>Customize controls...</button>}
                        <span>
                            <input id="tetris-game-chat" type="checkbox" checked={chat.checked} onChange={chat.onClick} />
                            <label htmlFor="tetris-game-chat">Game chat</label>
                        </span>
                    </div>
                }
            >
                {result && <Result result={result} />}
            </GameStart>
        </div>
    )
}

export default Menu
