// One tetromino color per letter
const TITLE_COLORS = ["__z", "__l", "__o", "__s", "__i", "__t"]

const Menu =({onClick}) =>

    <div className="tetrisMenu">
        <div className="tetrisTitle">
            {"TETRIS".split("").map((letter, i) => (
                <span key={i} className={`tetrisTitleLetter tetromino${TITLE_COLORS[i]}`}>{letter}</span>
            ))}
        </div>
        <button className="tetrisStartButton" onClick={onClick} autoFocus>
            Play
        </button>
    </div>

export default Menu
