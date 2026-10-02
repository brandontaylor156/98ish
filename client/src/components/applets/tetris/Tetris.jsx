import Game from './components/Game'
import GameChat from '../../shared/GameChat'

const Tetris = () => {
    return (
        <div className="tetrisApp">
            <Game />
            <GameChat game="tetris" title="Tetris" />
        </div>
    )
}

export default Tetris
