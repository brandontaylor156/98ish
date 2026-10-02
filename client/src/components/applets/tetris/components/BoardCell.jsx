import React from "react"

const BoardCell = ({className}) => {
    return(
    <div className={`tetrisBoardCell ${className}`}>
    </div>
    )
}

export default React.memo(BoardCell)
