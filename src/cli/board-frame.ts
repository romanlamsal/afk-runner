import {
    type BoardRow,
    type BoardStep,
    type BoardView,
    dead,
    type SettledOutcome,
    TRACKS,
    type Track,
} from "../domain/board.ts"
import { type Line, plain, type Span, widthOf } from "./board-span.ts"

/**
 * The board's frame: a pure mapping from a view and a terminal width to the lines that view is. It
 * holds the layout and nothing else — where the cursor goes is the writer's, what the run is doing
 * is the domain's, and what a line looks like is the colouring's.
 *
 * A line is a sequence of spans rather than a string, so that every width here is computed on plain
 * text before any colour exists. Colour is applied after the layout, never inside it: an escape
 * sequence is characters to `padEnd` and to a length check (ADR-0031).
 *
 * The height is the row count plus one header per track, whatever the view says, so the block never
 * grows or shrinks while somebody is reading it. That is also why a title is truncated rather than
 * wrapped: a wrapped line would break the one property the layout rests on.
 *
 * A footer sits under the blocks, where the things that are about the run rather than about a
 * ticket go: when the last thing happened, and then the drain notice. The notice stays the frame's
 * last line from the moment there is one, so the rows above it never move.
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
    ok: "✓",
    failed: "✗",
    skipped: "·",
    conflicted: "!",
}

/**
 * How a step is written at each of its three weights: what it came to, brackets, and nothing else.
 * What a step is read at has to survive `NO_COLOR`, so colour may repeat this and may never be the
 * only thing saying it.
 */
const written = (entry: BoardStep): string => {
    switch (entry.state) {
        case "settled":
            return `${entry.step}${OUTCOMES[entry.outcome]}`
        case "running":
            return `<${entry.step}>`
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

/**
 * When the last thing happened, written as the event carries it. It says whose time it is rather
 * than standing alone, because an instant on its own under a board reads as the time now — which is
 * the one thing it is not, and the whole reason it is read off the log instead of a clock.
 *
 * It is written only where the log has an event to have it from: a run nothing has happened in says
 * nothing, and never says it has been waiting since the epoch.
 */
const WHEN = "last event"

/** What a cut line ends in, so that a truncated title reads as a truncated title. */
const ELLIPSIS = "..."

/**
 * A line cut to the width it is read on, span by span. The cut is made on plain text, which is the
 * only text there is here: a span keeps whatever it said about itself for the part of it that fits.
 */
const fitted = (line: Line, width: number): Line => {
    if (widthOf(line) <= width) {
        return line
    }
    if (width <= ELLIPSIS.length) {
        return [plain(ELLIPSIS.slice(0, Math.max(width, 0)))]
    }

    const room = width - ELLIPSIS.length
    const kept: Span[] = []
    let taken = 0
    for (const span of line) {
        if (taken >= room) {
            break
        }
        const text = span.text.slice(0, room - taken)
        if (text !== "") {
            kept.push({ ...span, text })
            taken += text.length
        }
    }

    return [...kept, plain(ELLIPSIS)]
}

/** A row's trail, which is what has happened, what is happening and what is next, in that order. */
const trail = (row: BoardRow): Line =>
    [...row.steps.map(written), ...(row.waiting ? [WAITING] : []), ...(dead(row) ? [DEAD] : [])]
        // A separator of its own between two steps, so that the step spans hold nothing but a step.
        .flatMap((entry, index): Span[] => (index === 0 ? [plain(entry)] : [plain(" "), plain(entry)]))

/** A column's worth of padding, and no span at all where a column needs none. */
const padding = (columns: number): Span[] => (columns > 0 ? [plain(" ".repeat(columns))] : [])

/**
 * One ticket's line: its number, its trail, and its title. The title comes last because it is the
 * one part that may be cut — a trail a narrow terminal ate would lose the point of the row.
 *
 * Every column of padding is a span of its own, because padding says nothing and a span that says
 * nothing is what keeps the number, a step and a title each treatable on their own.
 */
const rowLine = (row: BoardRow, label: number, steps: number, width: number): Line => {
    const marked = trail(row)

    return fitted(
        [
            plain("  "),
            plain(`#${row.ticket}`),
            ...padding(label - `#${row.ticket}`.length),
            plain("  "),
            ...marked,
            ...padding(steps - widthOf(marked)),
            plain("  "),
            plain(row.title),
        ],
        width,
    )
}

/**
 * @param notice What the run has to say about itself, if anything. It is not part of the view
 * because it is not derived from the run's state: it arrives from whoever had something to say.
 */
export const boardFrame = (view: BoardView, width: number, notice?: string): readonly Line[] => {
    // One label column for the whole frame, so that the rows line up across both blocks.
    const label = Math.max(0, ...view.rows.map(row => `#${row.ticket}`.length))

    const blocks = TRACKS.flatMap(track => {
        const rows = view.rows.filter(row => row.track === track)
        // A trail column per block, because the two tracks are different lengths and a column wide
        // enough for the merge track would push every implement title off a narrow terminal.
        const steps = Math.max(0, ...rows.map(row => widthOf(trail(row))))

        return [fitted([plain(HEADINGS[track])], width), ...rows.map(row => rowLine(row, label, steps, width))]
    })

    const footer = [...(view.at === undefined ? [] : [`${WHEN} ${view.at}`]), ...(notice === undefined ? [] : [notice])]

    return [...blocks, ...footer.map(line => fitted([plain(line)], width))]
}
