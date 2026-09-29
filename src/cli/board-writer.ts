import type { Board, BoardView } from "../domain/board.ts"
import { boardWindow } from "./board-frame.ts"
import { boardLines } from "./board-lines.ts"
import { painted } from "./board-paint.ts"
import { widthOf } from "./board-span.ts"

/**
 * The writer: the impure half of the board, and the only thing that owns the cursor. It redraws the
 * block in place — cursor up over what it drew last, then every line overwritten and cleared to its
 * end — which is all a board with no animation and no clock needs.
 *
 * A frame is fitted to the window before it is drawn, one line shorter than the terminal, so that
 * cursor-up always reaches the frame's first line and no redraw pushes a line into scrollback
 * (ADR-0041). Each frame is one synchronized write and no line is cleared before it is rewritten, so
 * the terminal never shows a half-drawn board. A resize redraws the last view at once, fitted to the
 * new size.
 *
 * It never throws and it never clears on its way out: a terminal write must not be able to fail a
 * run, and the last frame is the run's summary, so it stays on screen once the run ends.
 */

export type TerminalBoardDeps = {
    /** Written verbatim, escape sequences and all. */
    write: (chunk: string) => void
    /** The terminal's width, asked for every frame: a window is resized mid-run as readily as not. */
    columns: () => number
    /** The terminal's height, asked for every frame for the same reason. */
    rows: () => number
    /** Where the writer hears that the window was resized: stdout's `'resize'`, on a terminal. */
    onResize: (listener: () => void) => void
}

const ESC = "\u001b"
const up = (lines: number): string => (lines > 0 ? `${ESC}[${lines}A` : "")
const CLEAR_TO_END = `${ESC}[K`
const ERASE_DOWN = `${ESC}[J`
const BEGIN_FRAME = `${ESC}[?2026h`
const END_FRAME = `${ESC}[?2026l`

export const createTerminalBoard = ({ write, columns, rows, onResize }: TerminalBoardDeps): Board => {
    let drawn = 0
    /** Where the window is scrolled to, clamped by every frame. It opens at the board's first row. */
    let offset = 0
    /** The last view, kept so that a notice can be drawn without waiting for the run to move on. */
    let shown: BoardView | undefined
    let notice: string | undefined

    /**
     * A resized frame starts from no higher than the new window reaches: a shortened window has
     * already pushed whatever was above that into scrollback, where it stays, once (ADR-0041). The
     * terminal may have rewrapped or moved what is left, so it is erased before the frame goes down
     * rather than overwritten line by line. The offset is re-clamped by the frame against the new
     * height.
     */
    const draw = (view: BoardView, { resized }: { resized: boolean }): void => {
        try {
            // The frame lays out plain text and says what each part is to be read at; the colour
            // goes on here, after every width has been computed (ADR-0031).
            const width = columns()
            const height = rows()
            const framed = boardWindow(view, { width, rows: height, offset, notice })
            // A line as wide as the terminal has overwritten all of the old one already, and leaves
            // the cursor waiting to wrap on its last column, where clearing to the end would erase
            // the line's own last character.
            const body = framed.lines
                .map(line => `${painted(line)}${widthOf(line) < width ? CLEAR_TO_END : ""}\n`)
                .join("")
            // A frame shorter than the last leaves the last one's tail below it, erased once the new
            // lines are down rather than before them.
            const rewind = resized ? `${up(Math.min(drawn, height - 1))}${ERASE_DOWN}` : up(drawn)
            write(`${BEGIN_FRAME}${rewind}${body}${ERASE_DOWN}${END_FRAME}`)
            drawn = framed.lines.length
            offset = framed.offset
            shown = view
        } catch {
            // A terminal that went away is not a run that failed (ADR-0029).
        }
    }

    // A resize redraws at once rather than on the next frame.
    onResize(() => {
        if (shown !== undefined) {
            draw(shown, { resized: true })
        }
    })

    return {
        show: view => draw(view, { resized: false }),
        notice: line => {
            notice = line
            // Redrawn on the spot rather than left for the next pass: a step can run for minutes,
            // and an operator who sees nothing for their interrupt sends the one that kills.
            if (shown !== undefined) {
                draw(shown, { resized: false })
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
