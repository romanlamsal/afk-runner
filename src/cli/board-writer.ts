import type { Key } from "node:readline"
import type { Board, BoardNotice, BoardView } from "../domain/board.ts"
import { type BoardWindow, boardWhole, boardWindow, offsetAbove } from "./board-frame.ts"
import { boardLines } from "./board-lines.ts"
import { painted } from "./board-paint.ts"
import { type Line, widthOf } from "./board-span.ts"

/**
 * The writer: the impure half of the board, and the only thing that owns the cursor. It draws the
 * board on the alternate screen, every frame from its top-left corner with every line overwritten and
 * cleared to its end, which is all a board with no animation and no clock needs. That screen has no
 * scrollback, so neither a redraw nor a resize can push a line into the operator's (ADR-0042).
 *
 * A frame is fitted to the window before it is drawn, one line shorter than the terminal, so that the
 * newline after its last line never scrolls it (ADR-0041). Each frame is one synchronized write and
 * no line is cleared before it is rewritten, so the terminal never shows a half-drawn board. A resize
 * redraws the last view at once, fitted to the new size.
 *
 * Every line afk prints in the process goes through it too. Before the first frame a line is written
 * through to the main screen and remembered, and from the first frame on it is drawn as the window's
 * content above the board. A line printed after it is drawn under the notices rather than written
 * into the middle of a frame, and an error line becomes a notice (ADR-0041).
 *
 * From the first frame it takes the operator's keys, where stdin is a terminal: ↑/↓ scroll a line and
 * Home/End jump to either end, redrawn at once. Raw mode keeps Ctrl-C from being a signal, so it is
 * forwarded as the process's own, and the interrupt handling stays as it is (ADR-0016). The cursor
 * is hidden from the first frame, and shown again at the end or on an exit however it comes.
 *
 * It never throws: a terminal write must not be able to fail a run. The last frame is the run's
 * summary, so `end` goes back to the main screen, where the lines printed before the board still are,
 * and paints the rest under them once more, whole and unclipped; an exit before the end does the same.
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
     * the window scrolls it with the rest (ADR-0041).
     */
    answered: (line: string) => void
    /**
     * The board's last paint, whole and unclipped, and the terminal given back. A process that never
     * showed a board has nothing to paint, and every line after it is written through again.
     */
    end: () => void
}

const ESC = "\u001b"
const CLEAR_TO_END = `${ESC}[K`
const ERASE_DOWN = `${ESC}[J`
const BEGIN_FRAME = `${ESC}[?2026h`
const END_FRAME = `${ESC}[?2026l`
const HIDE_CURSOR = `${ESC}[?25l`
const SHOW_CURSOR = `${ESC}[?25h`
const ALTERNATE_SCREEN = `${ESC}[?1049h`
const MAIN_SCREEN = `${ESC}[?1049l`
const HOME = `${ESC}[H`

/**
 * Lines as they are written: each overwrites what was there and clears the rest of its row. A line
 * as wide as the terminal has overwritten all of the old one already, and leaves the cursor waiting
 * to wrap on its last column, where clearing to the end would erase the line's own last character.
 */
const bodyOf = (lines: readonly Line[], width: number): string =>
    lines.map(line => `${painted(line)}${widthOf(line) < width ? CLEAR_TO_END : ""}\n`).join("")

/**
 * Where a scroll key moves the offset, which the frame clamps into range: Home and End go past either
 * end. One line up is the frame's to say, since a wrapped line is one stop rather than several.
 */
const scrolled = (key: Key, offset: number, lineUp: () => number): number | undefined => {
    switch (key.name) {
        case "up":
            return lineUp()
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
    /**
     * Where the window is scrolled to, clamped by every frame. Nothing until the first, which opens
     * at the board's first row.
     */
    let offset: number | undefined
    /** The last view, kept so that a notice can be drawn without waiting for the run to move on. */
    let shown: BoardView | undefined
    /** Every notice given, oldest first. Each stays, and so does the footer prefix it set. */
    const notices: BoardNotice[] = []
    /** Everything printed before the first frame, which stays on the main screen under the board. */
    const before: string[] = []
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
     * One frame, on the alternate screen and from its top-left corner: every line overwritten and
     * cleared to its end, and what is left below erased. The first one switches to that screen and
     * hides the cursor, in the same write.
     *
     * The alternate screen has no scrollback, so no frame — and no resize, however many rows it
     * takes away at a time — can push a line of it into the operator's (ADR-0042). The lines printed
     * before the board stay where they are on the main screen, which the last paint returns to.
     */
    const frame = (lines: readonly Line[], width: number, { first }: { first: boolean }): void =>
        paint(`${first ? `${ALTERNATE_SCREEN}${HIDE_CURSOR}` : ""}${HOME}`, lines, width, "")

    /**
     * Lines written in one synchronized write, what switches the screen or moves the cursor before
     * them, and what shows the cursor after, so that none of it is a write of its own.
     */
    const paint = (lead: string, lines: readonly Line[], width: number, trail: string): void =>
        write(`${BEGIN_FRAME}${lead}${bodyOf(lines, width)}${ERASE_DOWN}${trail}${END_FRAME}`)

    /** The window as it is now, scrolled to `at`. */
    const windowOf = (at: number | undefined): BoardWindow => ({
        width: columns(),
        rows: rows(),
        offset: at,
        notices,
        before,
        after,
    })

    /** The offset is re-clamped by the frame, against the new size where the window was resized. */
    const draw = (view: BoardView): void =>
        safely(() => {
            // The frame lays out plain text and says what each part is to be read at; the colour
            // goes on here, after every width has been computed (ADR-0031).
            const width = columns()
            // A first frame that failed to write switched to nothing, and the board is not showing.
            const first = phase === "before"
            const framed = boardWindow(view, windowOf(offset))
            frame(framed.lines, width, { first })
            phase = "showing"
            offset = framed.offset
            shown = view
            if (first) {
                onExit(leave)
                keys?.take(pressed)
            }
        })

    /**
     * Back to the main screen, where the lines printed before the board still are, and the board's
     * last paint under them: everything else, unclipped, and the cursor shown again (ADR-0042). The
     * end does it, and so does an exit that came before the end, however it came: a kill, a crash.
     */
    const leave = (): void => {
        if (phase !== "showing" || shown === undefined) {
            return
        }
        phase = "ended"
        const view = shown
        safely(() => {
            const width = columns()
            paint(MAIN_SCREEN, boardWhole(view, { width, notices, after }), width, SHOW_CURSOR)
        })
    }

    const pressed = (key: Key): void => {
        if (phase !== "showing" || shown === undefined) {
            return
        }
        if (key.ctrl === true && key.name === "c") {
            interrupt()
            return
        }
        const view = shown
        const to = scrolled(key, offset ?? 0, () => offsetAbove(view, windowOf(offset)))
        if (to !== undefined) {
            offset = to
            draw(shown)
        }
    }

    /** A line said while the board is showing joins what is drawn under it, at once. */
    const append = (line: string): void => {
        after.push(line)
        if (shown !== undefined) {
            draw(shown)
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
            draw(shown)
        }
    }

    // A resize redraws at once rather than on the next frame. Once the board has ended, its whole
    // last paint is what stays on screen, and nothing redraws over it.
    onResize(() => {
        if (phase === "showing" && shown !== undefined) {
            draw(shown)
        }
    })

    return {
        show: view => {
            if (phase !== "ended") {
                draw(view)
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
                // An error on this terminal before the board is a line on it like a printed one, so the
                // window draws it among them.
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
            if (phase === "showing") {
                leave()
                // Given back whether or not the last paint could be written, or stdin holds the
                // process open.
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
