import { useTouchControlsMenuItem, useTouchControlsVisible } from '../../../shared/controls'
import { useGameChatMenuItem } from '../../../shared/GameChat'

// One tetromino color per letter
const TITLE_COLORS = ["__z", "__l", "__o", "__s", "__i", "__t"]

// Title screen, or the game-over summary when a result is passed
const Menu = ({ onPlay, onCustomize, highScore, result }) => {
    const touchControls = useTouchControlsMenuItem()
    const showControls = useTouchControlsVisible()
    const chat = useGameChatMenuItem('tetris')
    return (
        <div className="tetrisMenu">
            <div className="tetrisTitle">
                {"TETRIS".split("").map((letter, i) => (
                    <span key={i} className={`tetrisTitleLetter tetromino${TITLE_COLORS[i]}`}>{letter}</span>
                ))}
            </div>

            {result && (
                <fieldset className="tetrisResult">
                    <legend>Game Over</legend>
                    {result.isHighScore && <div className="tetrisNewHigh">New high score!</div>}
                    <div className="tetrisResultRow"><span>Score</span><span>{result.score.toLocaleString()}</span></div>
                    <div className="tetrisResultRow"><span>Lines</span><span>{result.lines}</span></div>
                    <div className="tetrisResultRow"><span>Level</span><span>{result.level}</span></div>
                </fieldset>
            )}

            <button className="tetrisStartButton" onClick={onPlay} autoFocus>
                {result ? "Play again" : "Play"}
            </button>
            <div>High score: {highScore.toLocaleString()}</div>
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
        </div>
    )
}

export default Menu
