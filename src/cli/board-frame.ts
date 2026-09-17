import { type BoardRow, type BoardView, TRACKS, type Track } from "../domain/board.ts"

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

/** One ticket's line: its number, its title, and nothing more yet. */
const rowLine = (row: BoardRow, label: number, width: number): string =>
    fitted(`  ${`#${row.ticket}`.padEnd(label)}  ${row.title}`, width)

export const boardFrame = (view: BoardView, width: number): string[] => {
    // One label column for the whole frame, so that the titles line up across both blocks.
    const label = Math.max(0, ...view.rows.map(row => `#${row.ticket}`.length))

    return TRACKS.flatMap(track => [
        fitted(HEADINGS[track], width),
        ...view.rows.filter(row => row.track === track).map(row => rowLine(row, label, width)),
    ])
}
