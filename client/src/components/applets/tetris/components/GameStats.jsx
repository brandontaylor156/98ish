import React from "react"

const Stat = ({label, value}) => (
    <div>
        <div className="tetrisLabel">{label}</div>
        <div className="tetrisStatValue">{value}</div>
    </div>
)

// stats: [{ label, value }], picked by the mode (score/level/lines, a timer...)
const GameStats = ({ stats }) => (
    <>
        {stats.map((s) => <Stat key={s.label} label={s.label} value={s.value} />)}
    </>
)

export const KeyHints = React.memo(() => (
    <ul className="tetrisKeys">
        <li><kbd>{"←"}</kbd><kbd>{"→"}</kbd> Move</li>
        <li><kbd>{"↓"}</kbd> Soft drop</li>
        <li><kbd>Space</kbd> Hard drop</li>
        <li><kbd>{"↑"}</kbd><kbd>X</kbd> Rotate</li>
        <li><kbd>Z</kbd> Rotate left</li>
        <li><kbd>Shift</kbd><kbd>C</kbd> Hold</li>
        <li><kbd>P</kbd><kbd>Esc</kbd> Pause</li>
    </ul>
))

export default GameStats
