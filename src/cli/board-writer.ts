import type { Key } from "node:readline"
import type { Board, BoardNotice, BoardView } from "../domain/board.ts"
import { boardWhole, boardWindow, printedLines } from "./board-frame.ts"
import { boardLines } from "./board-lines.ts"
import { painted } from "./board-paint.ts"
import { type Line, widthOf } from "./board-span.ts"

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
 * Every line afk prints in the process goes through it too. Before the first frame a line is written
 * through and remembered; at the first frame, the ones cursor-up still reaches are rewound over and
 * drawn as the window's content above the board, and from then on a printed line is drawn under
 * the notices rather than written into the middle of a frame, and an error line becomes a notice
 * (ADR-0041).
 *
 * From the first frame it takes the operator's keys, where stdin is a terminal: ↑/↓ scroll a line and
 * Home/End jump to either end, redrawn at once. Raw mode keeps Ctrl-C from being a signal, so it is
 * forwarded as the process's own, and the interrupt handling stays as it is (ADR-0016). The cursor
 * is hidden from the first frame, and shown again at the end or on an exit however it comes.
 *
 * It never throws and it never clears on its way out: a terminal write must not be able to fail a
 * run, and the last frame is the run's summary. `end` paints it once more, whole and unclipped, and
 * it stays on screen once the run ends.
 */

export type TerminalBoardDeps = {
    /** Written verbatim, escape sequences and all. */
    write: (chunk: string) => void
    /** Where an error line goes that is not drawn: stderr, verbatim. */
    writeError: (chunk: string) => void
    /**
     * Whether stderr is somewhere else than this terminal. Where it is, an error line drawn under the
     * board is kept there too, so a log the operator redirected it to still has it (ADR-0041).
     */
    errorsElsewhere: boolean
    /** The terminal's width, asked for every frame: a window is resized mid-run as readily as not. */
    columns: () => number
    /** The terminal's height, asked for every frame for the same reason. */
    rows: () => number
    /** Where the writer hears that the window was resized: stdout's `'resize'`, on a terminal. */
    onResize: (listener: () => void) => void
    /**
     * The operator's keys, where stdin is a terminal. Nothing where it is not: the board is still
     * fitted to the window, there is just no scrolling it.
     */
    keys: KeySource | undefined
    /** Raises the process's own interrupt, which Ctrl-C is not once stdin is in raw mode. */
    interrupt: () => void
    /** Runs a hook as the process exits, whichever way: an end, a kill's `process.exit`, a crash. */
    onExit: (hook: () => void) => void
}

/** Stdin as a keyboard, taken by the board from its first frame and given back at its end. */
export type KeySource = {
    /**
     * Raw mode on, and every key from now on to the listener. Only ever called once every prompt's
     * readline is closed, since both would consume the keys otherwise.
     */
    take: (listener: (key: Key) => void) => void
    /** Raw mode off, and stdin paused and unref'd, so that it no longer holds the process. */
    release: () => void
}

/**
 * The terminal, for the whole process: the board's port, and everything else afk has to say while it
 * owns the screen. Every line goes through it, so none can land in the middle of a frame (ADR-0041).
 */
export type TerminalBoard = Board & {
    /** A line for stdout. Before the first frame it is written through; from it, drawn with the board. */
    print: (line: string) => void
    /**
     * A line for stderr. While the board is showing it is a notice under the rows instead, and sets
     * the footer's `Error` prefix; it stays on stderr too where stderr is not this terminal.
     */
    error: (line: string) => void
    /**
     * A line a prompt drew itself, as it stands once its readline has closed: `setup:  pnpm i`. It is
     * on screen already, so nothing is written; it is remembered as a printed line in its place, so
     * the first frame rewinds over it and scrolls it with the rest (ADR-0041).
     */
    answered: (line: string) => void
    /**
     * The board's last paint, whole and unclipped, and the terminal given back. A process that never
     * showed a board has nothing to paint, and every line after it is written through again.
     */
    end: () => void
}

const ESC = "\u001b"
const up = (lines: number): string => (lines > 0 ? `${ESC}[${lines}A` : "")
const CLEAR_TO_END = `${ESC}[K`
const ERASE_DOWN = `${ESC}[J`
const BEGIN_FRAME = `${ESC}[?2026h`
const END_FRAME = `${ESC}[?2026l`
const HIDE_CURSOR = `${ESC}[?25l`
const SHOW_CURSOR = `${ESC}[?25h`

/** Where a scroll key moves the offset, which the frame clamps into range: Home and End go past either end. */
const scrolled = (key: Key, offset: number): number | undefined => {
    switch (key.name) {
        case "up":
            return offset - 1
        case "down":
            return offset + 1
        case "home":
            return 0
        case "end":
            return Number.MAX_SAFE_INTEGER
        default:
            return undefined
    }
}

/** Where the adapter is in the process: before the first frame, drawing the board, or done with it. */
type Phase = "before" | "showing" | "ended"

export const createTerminalBoard = ({
    write,
    writeError,
    errorsElsewhere,
    columns,
    rows,
    onResize,
    keys,
    interrupt,
    onExit,
}: TerminalBoardDeps): TerminalBoard => {
    let phase: Phase = "before"
    /** Hidden by the first frame, and shown again only once. */
    let cursorHidden = false
    let drawn = 0
    /**
     * Where the window is scrolled to, clamped by every frame. Nothing until the first, which opens
     * at the board's first row.
     */
    let offset: number | undefined
    /** The last view, kept so that a notice can be drawn without waiting for the run to move on. */
    let shown: BoardView | undefined
    /** Every notice given, oldest first. Each stays, and so does the footer prefix it set. */
    const notices: BoardNotice[] = []
    /** Everything printed before the first frame, until it; then only what cursor-up could still reach. */
    let before: string[] = []
    const after: string[] = []

    /** A write that fails is swallowed: a terminal that went away is not a run that failed (ADR-0029). */
    const safely = (writing: () => void): void => {
        try {
            writing()
        } catch {
            // Nothing to do: there is nobody to tell.
        }
    }

    /**
     * The lines printed before the board that the first frame can take back, and the rows they take:
     * the last of them, as many as fit in the rows cursor-up reaches. The rest are in real scrollback
     * already, and drawing them again would say them twice.
     */
    const reachable = (width: number): { lines: string[]; rows: number } => {
        const reach = Math.max(rows() - 1, 0)
        let taken = 0
        let from = before.length
        while (from > 0) {
            const height = printedLines(before[from - 1] ?? "", width).length
            if (taken + height > reach) {
                break
            }
            taken += height
            from -= 1
        }
        return { lines: before.slice(from), rows: taken }
    }

    /**
     * One frame, replacing what is above it: rewound over, every line overwritten, and what is left
     * erased.
     *
     * A resized frame starts from no higher than the new window reaches: a shortened window has
     * already pushed whatever was above that into scrollback, where it stays, once (ADR-0041). The
     * terminal may have rewrapped or moved what is left, so it is erased before the frame goes down
     * rather than overwritten line by line.
     */
    const frame = (
        lines: readonly Line[],
        width: number,
        {
            rewind,
            resized,
            first = false,
            last = false,
        }: { rewind: number; resized: boolean; first?: boolean; last?: boolean },
    ): void => {
        // A line as wide as the terminal has overwritten all of the old one already, and leaves the
        // cursor waiting to wrap on its last column, where clearing to the end would erase the line's
        // own last character.
        const body = lines.map(line => `${painted(line)}${widthOf(line) < width ? CLEAR_TO_END : ""}\n`).join("")
        // A frame shorter than the last leaves the last one's tail below it, erased once the new lines
        // are down rather than before them.
        const back = resized ? `${up(Math.min(rewind, rows() - 1))}${ERASE_DOWN}` : up(rewind)
        // The cursor is hidden and shown as part of the frame it goes with, so that it is one write.
        write(
            `${BEGIN_FRAME}${back}${first ? HIDE_CURSOR : ""}${body}${ERASE_DOWN}${last ? SHOW_CURSOR : ""}${END_FRAME}`,
        )
        drawn = lines.length
    }

    /** The offset is re-clamped by the frame, against the new height where the window was resized. */
    const draw = (view: BoardView, { resized }: { resized: boolean }): void =>
        safely(() => {
            // The frame lays out plain text and says what each part is to be read at; the colour
            // goes on here, after every width has been computed (ADR-0031).
            const width = columns()
            // The first frame takes back what it rewinds over, and only once it is down: a frame that
            // failed to write rewound over nothing, and the lines before it are still where they were.
            const first = phase === "before"
            const taken = first ? reachable(width) : { lines: before, rows: drawn }
            const framed = boardWindow(view, { width, rows: rows(), offset, notices, before: taken.lines, after })
            frame(framed.lines, width, { rewind: taken.rows, resized, first })
            before = taken.lines
            phase = "showing"
            offset = framed.offset
            shown = view
            if (first) {
                cursorHidden = true
                onExit(restoreCursor)
                keys?.take(pressed)
            }
        })

    /** The cursor back, on an exit that came before the end could show it: a kill, or a crash. */
    const restoreCursor = (): void => {
        if (cursorHidden) {
            safely(() => write(SHOW_CURSOR))
            cursorHidden = false
        }
    }

    const pressed = (key: Key): void => {
        if (phase !== "showing" || shown === undefined) {
            return
        }
        if (key.ctrl === true && key.name === "c") {
            interrupt()
            return
        }
        const to = scrolled(key, offset ?? 0)
        if (to !== undefined) {
            offset = to
            draw(shown, { resized: false })
        }
    }

    /** A line said while the board is showing joins what is drawn under it, at once. */
    const append = (line: string): void => {
        after.push(line)
        if (shown !== undefined) {
            draw(shown, { resized: false })
        }
    }

    /**
     * A notice joins the ones under the rows and is drawn on the spot rather than left for the next
     * pass: a step can run for minutes, and an operator who sees nothing for their interrupt sends
     * the one that kills.
     */
    const addNotice = (given: BoardNotice): void => {
        notices.push(given)
        if (phase === "showing" && shown !== undefined) {
            draw(shown, { resized: false })
        }
    }

    // A resize redraws at once rather than on the next frame. Once the board has ended, its whole
    // last paint is what stays on screen, and nothing redraws over it.
    onResize(() => {
        if (phase === "showing" && shown !== undefined) {
            draw(shown, { resized: true })
        }
    })

    return {
        show: view => {
            if (phase !== "ended") {
                draw(view, { resized: false })
            }
        },
        notice: addNotice,
        print: line => {
            if (phase === "showing") {
                append(line)
                return
            }
            if (phase === "before") {
                before.push(line)
            }
            safely(() => write(`${line}\n`))
        },
        answered: line => {
            // Every prompt is closed before the board's first frame, so only then is there one to count.
            if (phase === "before") {
                before.push(line)
            }
        },
        error: line => {
            if (phase !== "showing") {
                // An error on this terminal before the board takes a row above it like a printed line
                // does, so the first frame rewinds over it too rather than falling a row short.
                if (phase === "before" && !errorsElsewhere) {
                    before.push(line)
                }
                safely(() => writeError(`${line}\n`))
                return
            }
            // A notice rather than a printed line: it sets the footer's `Error` prefix, which is what
            // tells an operator scrolled away from it that there is something to scroll to.
            addNotice({ kind: "error", line })
            if (errorsElsewhere) {
                safely(() => writeError(`${line}\n`))
            }
        },
        end: () => {
            if (phase === "showing" && shown !== undefined) {
                const view = shown
                safely(() => {
                    const width = columns()
                    frame(boardWhole(view, { width, notices, before, after }), width, {
                        rewind: drawn,
                        resized: false,
                        last: true,
                    })
                    cursorHidden = false
                })
                // Given back whether or not the last paint could be written, or stdin holds the
                // process open; a cursor that failed to show is tried again on the exit.
                safely(() => keys?.release())
            }
            phase = "ended"
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
