import { lazy, Suspense, useEffect, useState } from 'react'

import Menu from './Menu'
import TetrisWindow from './TetrisWindow'
import { useTetris } from '../hooks/useTetris'
import { useTetrisAchievements } from '../hooks/useTetrisAchievements'
import { levelGoal } from '../utils/engine'
import { MODES, formatTime } from '../utils/modes'
import { readBests, recordResult } from '../utils/storage'
import { useNet } from '../../network/NetContext'

// The online part (lobby, rooms, matches) loads when first needed
const Online = lazy(() => import('../online/Online'))

// What the left panel shows in each solo mode
const soloStats = (mode, game) => {
    switch (mode) {
        case "sprint":
            return [
                { label: "Time", value: formatTime(game.time) },
                { label: "Lines left", value: Math.max(0, 40 - game.lines) },
                { label: "Pieces/sec", value: game.time > 0 ? (game.pieces / (game.time / 1000)).toFixed(2) : "0.00" },
            ]
        case "ultra":
            return [
                { label: "Time left", value: formatTime(120_000 - game.time, false) },
                { label: "Score", value: game.score.toLocaleString() },
                { label: "Lines", value: game.lines },
            ]
        case "survival":
            return [
                { label: game.finale ? "Finale" : "Lines", value: game.finale ? `${Math.max(0, 220 - game.lines)} left` : `${game.lines}/200` },
                { label: "Level", value: game.level },
                { label: "Score", value: game.score.toLocaleString() },
            ]
        default:
            return [
                { label: "Score", value: game.score.toLocaleString() },
                { label: "Level", value: game.level },
                { label: "Goal", value: Math.max(0, levelGoal(game.level) - game.goal) },
            ]
    }
}

const SoloGame = ({ mode, editControls, onGameOver, onQuit }) => {
    const tetris = useTetris(mode)
    useTetrisAchievements(tetris.game, mode)
    return (
        <TetrisWindow
            tetris={tetris}
            stats={soloStats(mode, tetris.game)}
            editControls={editControls}
            onGameOver={onGameOver}
            onQuit={onQuit}
        />
    )
}

// Switches between the title menu (mode select), a solo game, its result, and Tetris Online
const Game = ({ fitWindow, mobile }) => {
    const net = useNet()
    const [screen, setScreen] = useState("menu")
    const [mode, setMode] = useState("marathon")
    const [bests, setBests] = useState(readBests)
    const [result, setResult] = useState(null)
    const [gameId, setGameId] = useState(0)
    const [editControls, setEditControls] = useState(false)

    // "Customize controls" starts a game paused in the controls editor
    const start = (nextMode = mode, edit = false) => {
        setMode(nextMode)
        setEditControls(edit === true)
        setGameId((id) => id + 1)
        setScreen("playing")
    }

    const finish = (game) => {
        const { value, isBest } = recordResult(mode, game)
        setBests(readBests())
        setResult({ mode, game, value, isBest })
        setScreen("over")
    }

    // Joining a room from elsewhere (an accepted invitation, Network Neighborhood) brings
    // up Tetris Online. Say hello once, when Tetris opens: saying it again on every screen
    // change made Back in Tetris Online jump straight back in while an invitation was pending.
    useEffect(() => {
        const socket = net?.socket
        if (!socket) return
        const onRoom = () => setScreen("online")
        const onInvited = () => setScreen("online")
        socket.on("tetris:room", onRoom)
        socket.on("tetris:invited", onInvited)
        net.request("tetris:hello")
        return () => {
            socket.off("tetris:room", onRoom)
            socket.off("tetris:invited", onInvited)
        }
    }, [net?.socket])

    return (
        <div className="tetrisGame">
            {screen === "playing" ? (
                <SoloGame key={gameId} mode={mode} editControls={editControls} onGameOver={finish} onQuit={() => setScreen("menu")} />
            ) : screen === "online" ? (
                <Suspense fallback={<div className="tetrisLoading">Connecting...</div>}>
                    <Online fitWindow={fitWindow} mobile={mobile} onExit={() => setScreen("menu")} />
                </Suspense>
            ) : (
                <Menu
                    onPlay={(m) => start(m)}
                    onCustomize={() => start("marathon", true)}
                    onOnline={() => setScreen("online")}
                    bests={bests}
                    result={screen === "over" ? result : null}
                />
            )}
        </div>
    )
}

export default Game
