import type { Board, BoardView } from "../domain/board.ts"
import { boardFrame } from "./board-frame.ts"
import { boardLines } from "./board-lines.ts"

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
 * No terminal to draw on: the second adapter of the one port. It keeps the view it was last shown
 * and prints a line for every row the next one changed, which is what makes piped output and a CI
 * log readable — nothing is redrawn, and nothing has to be.
 *
 * The drain notice is not one of its lines. Off a terminal there is no frame for it to tear, so it
 * keeps stderr, which is where a thing said about the run rather than about a ticket belongs
 * (ADR-0029).
 */
export const createLineBoard = ({ print }: { print: (line: string) => void }): Board => {
    let shown: BoardView | undefined

    return {
        show: view => {
            try {
                for (const line of boardLines(shown, view)) {
                    print(line)
                }
            } catch {
                // A pipe that closed is not a run that failed (ADR-0029).
            }
            shown = view
        },
        notice: () => undefined,
    }
}
