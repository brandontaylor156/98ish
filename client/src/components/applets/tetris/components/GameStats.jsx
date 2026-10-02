import React from "react"

const Stat = ({label, value}) => (
    <div>
        <div className="tetrisLabel">{label}</div>
        <div className="tetrisStatValue">{value}</div>
    </div>
)

const GameStats = ({gameStats}) => {
    const {level, points, linesCompleted, linesPerLevel} = gameStats;
    const linesToLevel = linesPerLevel - linesCompleted

    return (
        <>
            <Stat label="Score" value={points} />
            <Stat label="Level" value={level} />
            <Stat label="Lines to next" value={linesToLevel} />
            <ul className="tetrisKeys">
                <li><kbd>{"← →"}</kbd> Move</li>
                <li><kbd>{"↑"}</kbd> Rotate</li>
                <li><kbd>{"↓"}</kbd> Soft drop</li>
                <li><kbd>Space</kbd> Hard drop</li>
                <li><kbd>P</kbd> Pause</li>
                <li><kbd>Q</kbd> Quit</li>
            </ul>
        </>
    )

}

export default React.memo(GameStats)
