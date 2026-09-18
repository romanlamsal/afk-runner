import { type BoardRow, type BoardStep, type BoardView, dead, type SettledOutcome } from "../domain/board.ts"
import { type Hue, type Line, plain, type Span, type Tone, widthOf } from "./board-span.ts"

/**
 * The board's frame: a pure mapping from a view and a terminal width to the lines that view is. It
 * holds the layout and nothing else — where the cursor goes is the writer's, what the run is doing
 * is the domain's, and what a line looks like is the colouring's.
 *
 * A line is a sequence of spans rather than a string, so that every width here is computed on plain
 * text before any colour exists. Colour is applied after the layout, never inside it: an escape
 * sequence is characters to `padEnd` and to a length check (ADR-0031).
 *
 * The trail's text is written once and never changes: every row carries the same step names in the
 * same columns for the whole run, and what a step is read at is a tone and an outcome worth noticing
 * is a hue. The board therefore needs a colour terminal and consults nothing about whether it has
 * one — with colour off, every row reads as the same eight words, which is the price ADR-0031 takes
 * for a row that never moves while it is being read. Off a terminal there is no board at all, and
 * `boardLines` is what runs.
 *
 * There is one block and no headings: a row spans every step in order, whatever track its ticket is
 * on, so a ticket reaching the merge track changes what its trail says rather than where its row is
 * (ADR-0031). The rows are the manifest's, in the manifest's order, and nothing here groups, filters
 * or sorts by a row's track.
 *
 * The block's height is therefore the row count, whatever the view says, so it never grows or
 * shrinks while somebody is reading it. That is also why a row is cut rather than wrapped on a
 * terminal too narrow to hold it: a wrapped row would break the one property the layout rests on.
 *
 * Under the block sits the footer, which carries what is about the run rather than about a ticket:
 * when the last thing happened, and beneath that the drain notice when there is one. The footer may
 * grow, and growing costs nothing — the writer rewinds over the lines it last drew, so a line
 * appended at the bottom moves no row above it.
 *
 * A footer line too wide for the terminal is wrapped here rather than truncated or left to the
 * terminal: half an interrupt acknowledgement is the wrong thing to show, and a line the terminal
 * wrapped would occupy two rows while counting as one, which puts every later redraw out by a line.
 */

/**
 * Where a step stands in the run, as the tone it is read at. A step still ahead is dim, a settled
 * one is normal, and a step the log started and has not ended is the brightest thing on its row,
 * which is what makes the live edge of the run findable at a glance (ADR-0031).
 */
const toneOf = (entry: BoardStep): Tone => {
    switch (entry.state) {
        case "settled":
            return "normal"
        case "running":
            return "bright"
        case "ahead":
            return "dim"
    }
}

/**
 * What a settled step came to, where it came to something worth a colour of its own. A conflicted
 * step is amber rather than red, because the board does not call a state git drew a failure, and a
 * step that settled on anything else is the run working and needs no hue to say so.
 */
const HUES: Partial<Record<SettledOutcome, Hue>> = {
    conflicted: "amber",
    failed: "red",
}

/**
 * One step of a trail: its name, and nothing else ever. The brackets and the outcome glyph are gone
 * — they existed so a green step and a red one differed with colour off, and hue says it now — so a
 * step occupies the same columns from the first frame to the last (ADR-0031).
 */
const stepSpan = (entry: BoardStep): Span => {
    const hue = entry.state === "settled" ? HUES[entry.outcome] : undefined
    const span = { text: entry.step, tone: toneOf(entry) }

    return hue === undefined ? span : { ...span, hue }
}

/**
 * A row's ticket number, green once the gate has proven the ticket and plain until then. Green is
 * the board's one reward and nothing smaller than a verified ticket is ever given it, so that a
 * screen of green numbers is a count of what has landed (ADR-0031).
 */
const numberSpan = (row: BoardRow): Span => {
    const text = `${row.ticket}`

    return row.conclusion === "verified" ? { text, tone: "normal", hue: "green" } : plain(text)
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

/**
 * How wide the ticket number is written, whatever number it is: right-aligned into five columns and
 * carrying no prefix, which covers every issue number this repository will realistically see. It is
 * a constant rather than the widest number the view holds, so that the trail starts in the same
 * column on every board and not merely on every row of one (ADR-0031).
 */
const LABEL = 5

/** What a cut line ends in, so that a cut row reads as a cut row. */
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

/**
 * A footer line as the lines the terminal can hold it in: broken between words where it can be, and
 * through a word no terminal of this width could hold whole. Nothing is dropped, because what the
 * footer carries is what the operator asked for an answer to.
 */
const wrapped = (text: string, width: number): readonly Line[] => {
    // A terminal claiming no width at all still gets a line each, rather than an endless one.
    const room = Math.max(1, width)
    const lines: string[] = []
    let current = ""

    for (const word of text.split(" ")) {
        if (current !== "" && `${current} ${word}`.length <= room) {
            current = `${current} ${word}`
            continue
        }
        if (current !== "") {
            lines.push(current)
        }
        let rest = word
        while (rest.length > room) {
            lines.push(rest.slice(0, room))
            rest = rest.slice(room)
        }
        current = rest
    }

    return [...lines, current].map(line => [plain(line)])
}

/**
 * A row's trail: every step of the run, in the same order and the same columns on every row, and
 * then what the ticket is rather than what has been done to it. `waiting` and `dead` come last,
 * where there is nothing after them to push around (ADR-0031).
 */
const trail = (row: BoardRow): Line =>
    [...row.steps.map(stepSpan), ...(row.waiting ? [plain(WAITING)] : []), ...(dead(row) ? [plain(DEAD)] : [])]
        // A separator of its own between two steps, so that the step spans hold nothing but a step
        // and the tone a step is read at reaches no space beside it.
        .flatMap((span, index): Span[] => (index === 0 ? [span] : [plain(" "), span]))

/** A column's worth of padding, and no span at all where a column needs none. */
const padding = (columns: number): Span[] => (columns > 0 ? [plain(" ".repeat(columns))] : [])

/**
 * One ticket's line: its number and its trail, and nothing else. The issue title is not on it — a
 * fixed trail leaves it twenty-one columns on an eighty-column terminal, which is enough for
 * `refactor: one cl...` and nothing worth reading, and the number already identifies the row
 * (ADR-0031).
 *
 * Every column of padding is a span of its own, because padding says nothing and a span that says
 * nothing is what keeps the number and each step treatable on their own.
 */
const rowLine = (row: BoardRow, width: number): Line => {
    const number = numberSpan(row)

    return fitted([...padding(LABEL - number.text.length), number, plain("  "), ...trail(row)], width)
}

/**
 * @param notice What the run has to say about itself, if anything. It is not part of the view
 * because it is not derived from the run's state: it arrives from whoever had something to say.
 */
export const boardFrame = (view: BoardView, width: number, notice?: string): readonly Line[] => {
    const rows = view.rows.map(row => rowLine(row, width))

    const footer = [...(view.at === undefined ? [] : [`${WHEN} ${view.at}`]), ...(notice === undefined ? [] : [notice])]

    return [...rows, ...footer.flatMap(line => wrapped(line, width))]
}
