import BoardCell from './BoardCell'

// cells: rows of class names from engine.visibleCells
const Board = ({cells, children}) => {
    const boardStyles = {
        gridTemplateRows: `repeat(${cells.length}, 1fr)`,
        gridTemplateColumns: `repeat(${cells[0].length}, 1fr)`
    };

    return (
            <div className="tetrisBoard" style={boardStyles}>
                {cells.map((row, y) =>
                row.map((className, x) =>
                    <BoardCell key={y * row.length + x} className={className}/>
                    )
                )}
                {children}
            </div>
    )
}

export default Board
