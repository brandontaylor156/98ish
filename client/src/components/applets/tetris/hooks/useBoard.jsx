import {useState, useEffect, useRef} from "react"
import {buildBoard, nextBoard} from "../utils/BoardLogic"

// This hook is first instance of using a separate "business logic" file to handle all of
// the logic related to the board. buildBoard takes in rows and columns as integers and returns
// a 2D array of defaultCells (from CellLogic) and the size in object format {rows, columns}

// PROPS DESTRUCTURED
export const useBoard = ({rows, columns, player, resetPlayer, addLinesCleared}) => {

    // The latest board lives in a ref so the effect below can read it directly. Computing the
    // next board inside a setBoard updater meant calling resetPlayer/addLinesCleared (other
    // state updates) from inside an updater, which React doesn't allow.
    const boardRef = useRef(null)
    if (boardRef.current === null) boardRef.current = buildBoard({ rows, columns })
    const [board, setBoard] = useState(boardRef.current);

    // Re-compute the board whenever the player moves
    useEffect(() => {
        const { board: next, linesCleared, pieceLocked } = nextBoard({
            board: boardRef.current,
            player
        })
        boardRef.current = next
        setBoard(next)

        if (linesCleared > 0) addLinesCleared(linesCleared)
        if (pieceLocked) resetPlayer()
      }, [player, resetPlayer, addLinesCleared]);

    return [board]
}
