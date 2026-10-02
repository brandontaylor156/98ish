import React from "react"
import { cellClass, previewShape } from "../utils/tetrominoes"

// A single piece in its spawn orientation, centered in a sunken box (Next queue and Hold)
const PiecePreview = ({ type, small, dimmed }) => {
    const shape = type ? previewShape(type) : null
    const classes = ["tetrisPreview", small && "tetrisPreview--small", dimmed && "tetrisPreview--dimmed"]

    return (
        <div className={classes.filter(Boolean).join(" ")}>
            {shape && (
                <div
                    className="tetrisPreviewPiece"
                    style={{
                        gridTemplateColumns: `repeat(${shape[0].length}, var(--tetris-preview-cell))`,
                        gridTemplateRows: `repeat(${shape.length}, var(--tetris-preview-cell))`,
                    }}
                >
                    {shape.flatMap((row, y) =>
                        row.map((filled, x) => (
                            <div key={`${y}-${x}`} className={filled ? `tetrisBoardCell ${cellClass(type)}` : ""} />
                        ))
                    )}
                </div>
            )}
        </div>
    )
}

export default React.memo(PiecePreview)
