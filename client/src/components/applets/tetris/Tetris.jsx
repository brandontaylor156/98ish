import { useEffect, useState } from 'react'
import Game from './components/Game'
import GameChat from '../../shared/GameChat'
import './Tetris.css'

// fitWindow (desktop only): Tetris Online widens the window for the opponents' boards
const Tetris = ({ fitWindow = null, mobile = false }) => {
    // during a Tetris Online match the chat is that match's room, otherwise the Tetris lobby
    const [matchRoom, setMatchRoom] = useState(null)
    useEffect(() => {
        const onMatch = (e) => setMatchRoom(e.detail || null)
        window.addEventListener('98ish:tetris-match', onMatch)
        return () => window.removeEventListener('98ish:tetris-match', onMatch)
    }, [])
    return (
        <div className="tetrisApp">
            <Game fitWindow={fitWindow} mobile={mobile} />
            <GameChat game="tetris" title={matchRoom ? 'Match' : 'Tetris'} room={matchRoom ? `match:${matchRoom}` : undefined} />
        </div>
    )
}

export default Tetris
