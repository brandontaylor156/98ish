import { useState } from 'react'

import Menu from './Menu'
import TetrisWindow from './TetrisWindow'

const HIGH_SCORE_KEY = "98ish.tetris.highScore"

const readHighScore = () => {
    try {
        return Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0
    } catch {
        return 0
    }
}

const saveHighScore = (score) => {
    try {
        localStorage.setItem(HIGH_SCORE_KEY, String(score))
    } catch {
        // Storage unavailable (private mode etc.): keep it for this session only
    }
}

// Switches between the title menu, a running game, and the game-over summary
const Game = () => {
    const [screen, setScreen] = useState("menu")
    const [highScore, setHighScore] = useState(readHighScore)
    const [result, setResult] = useState(null)
    const [gameId, setGameId] = useState(0)

    const start = () => {
        setGameId((id) => id + 1)
        setScreen("playing")
    }

    const finish = ({ score, lines, level }) => {
        const isHighScore = score > highScore
        if (isHighScore) {
            setHighScore(score)
            saveHighScore(score)
        }
        setResult({ score, lines, level, isHighScore })
        setScreen("over")
    }

    return (
        <div className="tetrisGame">
            {screen === "playing" ? (
                <TetrisWindow key={gameId} onGameOver={finish} onQuit={() => setScreen("menu")} />
            ) : (
                <Menu onPlay={start} highScore={highScore} result={screen === "over" ? result : null} />
            )}
        </div>
    )
}

export default Game
