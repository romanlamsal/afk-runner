import {
    type BoardRow,
    type BoardStep,
    type BoardView,
    dead,
    type SettledOutcome,
    TRACKS,
    type Track,
} from "../domain/board.ts"

/**
 * The board's frame: a pure mapping from a view and a terminal width to the lines that view is. It
 * holds the layout and nothing else — where the cursor goes is the writer's, and what the run is
 * doing is the domain's.
 *
 * The height is the row count plus one header per track, whatever the view says, so the block never
 * grows or shrinks while somebody is reading it. That is also why a title is truncated rather than
 * wrapped: a wrapped line would break the one property the layout rests on.
 *
 * A run status line — the drain notice, and so far nothing else — sits under the blocks, where it
 * is the one thing that is about the run rather than about a ticket. It is the frame's last line
 * from the moment there is one, so the rows above it never move.
 */

const HEADINGS: Record<Track, string> = {
    implement: "implement track",
    merge: "merge track",
}

/**
 * What a settled step came to, in one character each. A glyph rather than a word, because telling a
 * green step from a red one is the thing the row is read for, and because it has to survive
 * `NO_COLOR`: colour may repeat these and may never be the only thing saying them.
 */
const OUTCOMES: Record<SettledOutcome, string> = {
    ok: "\u2713",
    failed: "\u2717",
    skipped: "\u00b7",
    conflicted: "!",
}

/**
 * How a step is written at each of its four weights: what it came to, brackets, and nothing else.
 * What a step is read at has to survive `NO_COLOR`, so colour may repeat this and may never be the
 * only thing saying it.
 *
 * An interrupted step is written differently from a live one because it is a different thing: the
 * process that began it is gone, and the step is where a resume picks the ticket back up rather than
 * something that is happening now.
 */
const written = (entry: BoardStep): string => {
    switch (entry.state) {
        case "settled":
            return `${entry.step}${OUTCOMES[entry.outcome]}`
        case "live":
            return `<${entry.step}>`
        case "interrupted":
            return `[${entry.step}]`
        case "ahead":
            return `(${entry.step})`
    }
}

/** What a ticket the merge track has not taken yet reads as. It is a state, never a position. */
const WAITING = "waiting"

/**
 * What a ticket nothing more will happen to reads as. It is written at the end of the trail the
 * ticket died on rather than in a block of its own, so that a dead ticket stays where it died and
 * the frame's height stays the ticket count.
 */
const DEAD = "dead"

/** What a ticket a resume has nothing to try on reads as, beside the step it was interrupted at. */
const BEYOND_REPAIR = "beyond repair"

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
    [
        ...row.steps.map(written),
        ...(row.waiting ? [WAITING] : []),
        ...(row.beyondRepair ? [BEYOND_REPAIR] : []),
        ...(dead(row) ? [DEAD] : []),
    ].join(" ")

/**
 * One ticket's line: its number, its trail, and its title. The title comes last because it is the
 * one part that may be cut — a trail a narrow terminal ate would lose the point of the row.
 */
const rowLine = (row: BoardRow, label: number, steps: number, width: number): string =>
    fitted(`  ${`#${row.ticket}`.padEnd(label)}  ${trail(row).padEnd(steps)}  ${row.title}`, width)

/**
 * @param notice What the run has to say about itself, if anything. It is not part of the view
 * because it is not derived from the run's state: it arrives from whoever had something to say.
 */
export const boardFrame = (view: BoardView, width: number, notice?: string): string[] => {
    // One label column for the whole frame, so that the rows line up across both blocks.
    const label = Math.max(0, ...view.rows.map(row => `#${row.ticket}`.length))

    const blocks = TRACKS.flatMap(track => {
        const rows = view.rows.filter(row => row.track === track)
        // A trail column per block, because the two tracks are different lengths and a column wide
        // enough for the merge track would push every implement title off a narrow terminal.
        const steps = Math.max(0, ...rows.map(row => trail(row).length))

        return [fitted(HEADINGS[track], width), ...rows.map(row => rowLine(row, label, steps, width))]
    })

    return notice === undefined ? blocks : [...blocks, fitted(notice, width)]
}
