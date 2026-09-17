import { type BoardRow, type BoardView, type StepState, TRACKS, type Track } from "../domain/board.ts"

/**
 * The board's frame: a pure mapping from a view and a terminal width to the lines that view is. It
 * holds the layout and nothing else — where the cursor goes is the writer's, and what the run is
 * doing is the domain's.
 *
 * The height is the row count plus one header per track, whatever the view says, so the block never
 * grows or shrinks while somebody is reading it. That is also why a title is truncated rather than
 * wrapped: a wrapped line would break the one property the layout rests on.
 */

const HEADINGS: Record<Track, string> = {
    implement: "implement track",
    merge: "merge track",
}

/**
 * How a step is written at each of the three weights. Brackets and nothing else: what a step is read
 * at has to survive `NO_COLOR`, so colour may repeat this and may never be the only thing saying it.
 */
const WEIGHTS: Record<StepState, (step: string) => string> = {
    settled: step => step,
    live: step => `<${step}>`,
    ahead: step => `(${step})`,
}

/** What a ticket the merge track has not taken yet reads as. It is a state, never a position. */
const WAITING = "waiting"

/** What a cut line ends in, so that a truncated title reads as a truncated title. */
const ELLIPSIS = "..."

const fitted = (line: string, width: number): string => {
    if (line.length <= width) {
        return line
    }
    return width <= ELLIPSIS.length
        ? ELLIPSIS.slice(0, Math.max(width, 0))
        : `${line.slice(0, width - ELLIPSIS.length)}${ELLIPSIS}`
}

/** A row's trail, which is what has happened, what is happening and what is next, in that order. */
const trail = (row: BoardRow): string =>
    [...row.steps.map(({ step, state }) => WEIGHTS[state](step)), ...(row.waiting ? [WAITING] : [])].join(" ")

/**
 * One ticket's line: its number, its trail, and its title. The title comes last because it is the
 * one part that may be cut — a trail a narrow terminal ate would lose the point of the row.
 */
const rowLine = (row: BoardRow, label: number, steps: number, width: number): string =>
    fitted(`  ${`#${row.ticket}`.padEnd(label)}  ${trail(row).padEnd(steps)}  ${row.title}`, width)

export const boardFrame = (view: BoardView, width: number): string[] => {
    // One label column for the whole frame, so that the rows line up across both blocks.
    const label = Math.max(0, ...view.rows.map(row => `#${row.ticket}`.length))

    return TRACKS.flatMap(track => {
        const rows = view.rows.filter(row => row.track === track)
        // A trail column per block, because the two tracks are different lengths and a column wide
        // enough for the merge track would push every implement title off a narrow terminal.
        const steps = Math.max(0, ...rows.map(row => trail(row).length))

        return [fitted(HEADINGS[track], width), ...rows.map(row => rowLine(row, label, steps, width))]
    })
}
