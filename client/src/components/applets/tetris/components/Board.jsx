import BoardCell from './BoardCell'

const Board = ({board, children}) => {
    const boardStyles = {
        gridTemplateRows: `repeat(${board.size.rows}, 1fr)`,
        gridTemplateColumns: `repeat(${board.size.columns}, 1fr)`
    };

    return (
            <div className="tetrisBoard" style={boardStyles}>
                {board.rows.map((row, y) =>
                row.map((cell, x) =>
                    <BoardCell key={y * board.size.columns + x} cell={cell}/>
                    )
                )}
                {children}
            </div>
    )
}

export default Board
