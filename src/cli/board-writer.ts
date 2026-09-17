import type { Board, BoardView } from "../domain/board.ts"
import { boardFrame } from "./board-frame.ts"

/**
 * The writer: the impure half of the board, and the only thing that owns the cursor. It redraws the
 * block in place — cursor up over what it drew last, clear the line, rewrite — which is all a board
 * with no animation and no clock needs.
 *
 * It never throws and it never clears on its way out: a terminal write must not be able to fail a
 * run, and the last frame is the run's summary, so it stays on screen once the run ends.
 */

export type TerminalBoardDeps = {
    /** Written verbatim, escape sequences and all. */
    write: (chunk: string) => void
    /** The terminal's width, asked for every frame: a window is resized mid-run as readily as not. */
    columns: () => number
}

const UP = "[A"
const CLEAR_LINE = "[2K"

export const createTerminalBoard = ({ write, columns }: TerminalBoardDeps): Board => {
    let drawn = 0
    /** The last view, kept so that a notice can be drawn without waiting for the run to move on. */
    let shown: BoardView | undefined
    let notice: string | undefined

    const draw = (view: BoardView): void => {
        try {
            const lines = boardFrame(view, columns(), notice)
            const rewound = `${UP}${CLEAR_LINE}`.repeat(drawn)
            write(`${rewound}${lines.map(line => `${line}\n`).join("")}`)
            drawn = lines.length
            shown = view
        } catch {
            // A terminal that went away is not a run that failed (ADR-0029).
        }
    }

    return {
        show: draw,
        notice: line => {
            notice = line
            // Redrawn on the spot rather than left for the next pass: a step can run for minutes,
            // and an operator who sees nothing for their interrupt sends the one that kills.
            if (shown !== undefined) {
                draw(shown)
            }
        },
    }
}

/**
 * No terminal to draw on. A run off one prints exactly what it printed before the board existed,
 * which is what keeps piped output and CI logs readable — the drain notice included, which off a
 * terminal keeps going to stderr rather than coming through here.
 */
export const silentBoard: Board = { show: () => undefined, notice: () => undefined }
