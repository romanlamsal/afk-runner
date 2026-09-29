import {
    type BoardNotice,
    type BoardNoticeKind,
    type BoardRow,
    type BoardStep,
    type BoardView,
    dead,
    type SettledOutcome,
} from "../domain/board.ts"
import type { Conclusion } from "../domain/events.ts"
import { type Line, plain, type Role, type Span, widthOf } from "./board-span.ts"

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
 * same columns for the whole run, and what a step is is a role the colouring gives a treatment to.
 * The board therefore needs a colour terminal and consults nothing about whether it has one — with
 * colour off, every row reads as the same eight words, which is the price ADR-0031 takes for a row
 * that never moves while it is being read. Off a terminal there is no board at all, and `boardLines`
 * is what runs.
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
 * Under the block sit the notices, what the run says about itself rather than about a ticket, and
 * under those the footer: when the last thing happened. A notice appended under the rows moves no row
 * above it, and the writer redraws the whole frame every time, so the frame growing costs nothing.
 *
 * A notice or footer line too wide for the terminal is wrapped here rather than truncated or left to
 * the terminal: half an interrupt acknowledgement is the wrong thing to show, and a line the terminal
 * wrapped would occupy two rows while counting as one, which puts every later redraw out by a line.
 *
 * On a terminal too short for the frame, the frame is fitted to a window (`boardWindow`): the rows and
 * notices are scrolled with the lines afk printed before and after the board, and the footer is pinned
 * as the window's last line (ADR-0041). The last paint is `boardWhole`: all of it, unclipped.
 */

/** What a settled step came to, as the role it is read as. A step that simply worked is plain. */
const SETTLED_ROLES: Record<SettledOutcome, Role> = {
    ok: "plain",
    conflicted: "conflicted",
    failed: "failed",
    skipped: "skipped",
}

/**
 * Where a step stands in the run, as the role it is read as: a step not reached yet is ahead, a step
 * the log started and has not ended is running — or quiet, where its row says it has stopped writing,
 * or interrupted, where nothing holds the run it was started by — and a settled one is whatever it
 * settled on. The words stay the step's name in every case: the colour carries the liveness, and the
 * text keeps meaning what it always has (ADR-0031).
 */
const roleOf = (entry: BoardStep, quiet: boolean): Role => {
    switch (entry.state) {
        case "settled":
            return SETTLED_ROLES[entry.outcome]
        case "running":
            return quiet ? "quiet" : "running"
        case "interrupted":
            return "interrupted"
        case "ahead":
            return "ahead"
    }
}

/**
 * One step of a trail: its name, and nothing else ever. The brackets and the outcome glyph are gone
 * — they existed so a green step and a red one differed with colour off, and the palette says it now
 * — so a step occupies the same columns from the first frame to the last (ADR-0031).
 */
const stepSpan = (entry: BoardStep, quiet: boolean): Span => ({ text: entry.step, role: roleOf(entry, quiet) })

/**
 * What a ticket came to, as the role its number is read as. A run that has not brought the ticket to
 * anything, and one that has brought it no further than unverified, is plain: the number column
 * answers what landed, and a ticket still moving has not answered yet.
 */
const CONCLUSION_ROLES: Record<Conclusion, Role> = {
    verified: "verified",
    unverified: "plain",
    failed: "failed",
    skipped: "skipped",
}

/**
 * What the row's verdict is read as, and the reason the number column is worth reading on its own:
 * green landed, red broke, amber never got its chance, plain still going. A screen of numbers is
 * therefore the run's tally, and the trail is only consulted when one of them is odd (ADR-0033).
 */
const verdictOf = (row: BoardRow): Role => (row.conclusion === undefined ? "plain" : CONCLUSION_ROLES[row.conclusion])

/** A row's ticket number, at the verdict the run has reached about it. */
const numberSpan = (row: BoardRow): Span => ({ text: `${row.ticket}`, role: verdictOf(row) })

/** What a ticket the merge track has not taken yet reads as. It is a state, never a position. */
const WAITING = "waiting"

/**
 * What a ticket nothing more will happen to reads as. It is written at the end of the trail the
 * ticket died on rather than in a block of its own, so that a dead ticket stays where it died and
 * the frame's height stays the ticket count.
 *
 * It carries the row's verdict, like the number does: a ticket that broke and one that never got its
 * chance are both dead and are not the same news.
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
 * What the footer says before `last event` once a notice of that kind has been given, in the order
 * it says them: the words never move, whichever came first. A prefix stays for the rest of the run,
 * because the notice that set it does (ADR-0041).
 */
const PREFIXES: Record<BoardNoticeKind, Span> = {
    error: { text: "Error", role: "failed" },
    draining: { text: "Draining", role: "draining" },
}

/** The order the prefixes are said in, every kind once. */
const PREFIX_ORDER: readonly BoardNoticeKind[] = ["error", "draining"]

/** What sets the footer's parts off from one another. */
const FOOTER_SEPARATOR = "-"

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

/** A line's text as the words it is broken between, each of them plain. */
const wordsOf = (text: string): readonly Span[] => text.split(" ").map(plain)

/**
 * A notice or footer line as the lines the terminal can hold it in: broken between words where it
 * can be, and through a word no terminal of this width could hold whole. Nothing is dropped, because
 * what the footer carries is what the operator asked for an answer to. A word keeps its role on
 * whichever line it lands.
 */
const wrapped = (words: readonly Span[], width: number): readonly Line[] => {
    // A terminal claiming no width at all still gets a line each, rather than an endless one.
    const room = Math.max(1, width)
    const lines: Line[] = []
    let current: Span[] = []

    for (const word of words) {
        const taken = widthOf(current)
        const started = taken > 0
        if (started && taken + 1 + word.text.length <= room) {
            current = [...current, plain(" "), word]
            continue
        }
        if (started) {
            lines.push(current)
        }
        let rest = word.text
        while (rest.length > room) {
            lines.push([{ ...word, text: rest.slice(0, room) }])
            rest = rest.slice(room)
        }
        current = [{ ...word, text: rest }]
    }

    return [...lines, current]
}

/**
 * A row's trail: every step of the run, in the same order and the same columns on every row, and
 * then what the ticket is rather than what has been done to it. `waiting` and `dead` come last,
 * where there is nothing after them to push around (ADR-0031).
 */
const trail = (row: BoardRow): Line =>
    [
        ...row.steps.map(entry => stepSpan(entry, row.quiet)),
        ...(row.waiting ? [plain(WAITING)] : []),
        ...(dead(row) ? [{ text: DEAD, role: verdictOf(row) }] : []),
    ]
        // A separator of its own between two steps, so that the step spans hold nothing but a step
        // and what a step is read as reaches no space beside it.
        .flatMap((span, index): Span[] => (index === 0 ? [span] : [plain(" "), span]))

/** What sets a row's end — its elapsed figure, or its blockers — off from the trail it is about. */
const ROW_END = "|"

/**
 * How long a step has been going, in the fewest units that still count it: seconds under a minute,
 * minutes and seconds under an hour, hours and minutes past that. Seconds are whole and rounded down,
 * so the figure never reads a second the step has not had yet.
 */
export const elapsedText = (ms: number): string => {
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) {
        return `${seconds}s`
    }
    const two = (n: number): string => `${n}`.padStart(2, "0")
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) {
        return `${minutes}m${two(seconds % 60)}s`
    }
    return `${Math.floor(minutes / 60)}h${two(minutes % 60)}m`
}

/** What a row ends with, after the separator: a figure or its blockers, and no more than one. */
const rowEndSpan = (row: BoardRow): Span | undefined => {
    if (row.elapsed !== undefined) {
        return { text: elapsedText(row.elapsed), role: row.quiet ? "quiet" : "plain" }
    }
    // A blocked ticket has never been attempted, so it has no running step and no figure beside it
    // to give way to (CONTEXT.md, *Blocked*).
    return row.blockedBy.length === 0
        ? undefined
        : plain(`blocked by ${row.blockedBy.map(blocker => `#${blocker}`).join(" ")}`)
}

/**
 * The end of a row: how long its running step has been going, or what its ticket is blocked by, and
 * nothing at all where neither is so. It goes after everything else on the row, so that its width
 * changing as it counts moves nothing but itself, and the trail's words stay what they were
 * (ADR-0031, ADR-0034). A step gone quiet has its figure drawn at the same warning as its name,
 * since the figure is where the eye goes to ask whether the step is still alive.
 */
const rowEndSpans = (row: BoardRow): Span[] => {
    const end = rowEndSpan(row)
    return end === undefined ? [] : [plain(" "), plain(ROW_END), plain(" "), end]
}

/** A column's worth of padding, and no span at all where a column needs none. */
const padding = (columns: number): Span[] => (columns > 0 ? [plain(" ".repeat(columns))] : [])

/**
 * One ticket's line: its number, its trail, and how long its running step has been going or what it
 * is blocked by. The issue title is not on it — a fixed trail leaves it twenty-one columns on an
 * eighty-column terminal, which is enough for `refactor: one cl...` and nothing worth reading, and
 * the number already identifies the row (ADR-0031).
 *
 * Every column of padding is a span of its own, because padding says nothing and a span that says
 * nothing is what keeps the number and each step treatable on their own.
 */
const rowLine = (row: BoardRow, width: number): Line => {
    const number = numberSpan(row)

    return fitted(
        [...padding(LABEL - number.text.length), number, plain("  "), ...trail(row), ...rowEndSpans(row)],
        width,
    )
}

/** The rows and the notices under them, in the order they arrived: everything a window scrolls. */
const blocksOf = (view: BoardView, width: number, notices: readonly BoardNotice[]): readonly (readonly Line[])[] => [
    ...view.rows.map(row => [rowLine(row, width)]),
    ...notices.map(notice => wrapped(wordsOf(notice.line), width)),
]

const contentOf = (view: BoardView, width: number, notices: readonly BoardNotice[]): readonly Line[] =>
    blocksOf(view, width, notices).flat()

/**
 * The footer's words: a prefix for every kind of notice given so far, then when the last event
 * happened, each part set off from the next. Nothing at all where there is neither.
 */
const footerOf = (view: BoardView, notices: readonly BoardNotice[]): readonly Span[] | undefined => {
    const parts: (readonly Span[])[] = [
        ...PREFIX_ORDER.filter(kind => notices.some(notice => notice.kind === kind)).map(kind => [PREFIXES[kind]]),
        ...(view.at === undefined ? [] : [wordsOf(`${WHEN} ${view.at}`)]),
    ]
    return parts.length === 0
        ? undefined
        : parts.flatMap((part, index) => (index === 0 ? part : [plain(FOOTER_SEPARATOR), ...part]))
}

/**
 * The whole frame: every row, the notices under them, and the footer last.
 *
 * @param notices What the run has said about itself, oldest first. They are not part of the view
 * because they are not derived from the run's state: they arrive from whoever had something to say.
 */
export const boardFrame = (view: BoardView, width: number, notices: readonly BoardNotice[] = []): readonly Line[] => {
    const footer = footerOf(view, notices)
    return [...contentOf(view, width, notices), ...(footer === undefined ? [] : wrapped(footer, width))]
}

/**
 * A line afk printed, as the terminal lays it out: cut every `width` columns, because that is where
 * the terminal wraps it. Nothing is dropped and no leading space is lost, so that a line redrawn
 * inside the window reads as it did when it was printed, and takes the rows it took then.
 */
export const printedLines = (text: string, width: number): readonly Line[] => {
    const room = Math.max(1, width)
    // A line break inside a printed line starts a row of its own, as it does on the terminal.
    return text.split("\n").flatMap(part => {
        const lines: Line[] = []
        for (let from = 0; from < part.length; from += room) {
            lines.push([plain(part.slice(from, from + room))])
        }
        return lines.length === 0 ? [[plain("")]] : lines
    })
}

/** What else afk printed in this process: the lines before the board, and the lines after it. */
export type Printed = {
    /** The lines printed before the first frame. */
    before?: readonly string[] | undefined
    /** The lines printed since the first frame: the interrupted line, the pull request's. */
    after?: readonly string[] | undefined
}

const printed = (lines: readonly string[] | undefined, width: number): readonly Line[] =>
    (lines ?? []).flatMap(line => printedLines(line, width))

/** What the window is asked to be: the terminal's size, where the operator has scrolled to, and the notices. */
export type BoardWindow = Printed & {
    width: number
    /** The terminal's rows. The window is one fewer, so the cursor's trailing line never scrolls it. */
    rows: number
    /**
     * How many content lines are scrolled off the top, counted from the first line printed before
     * the board. Nothing yet says the board's first row, which is where the first view opens.
     */
    offset: number | undefined
    notices?: readonly BoardNotice[] | undefined
}

/** A fitted frame, and the offset it was drawn at once clamped into range, for the next one to start from. */
export type Windowed = {
    lines: readonly Line[]
    offset: number
}

/** What stands in for the lines hidden above or below, in the content line it takes. */
const marker = (arrow: "↑" | "↓", hidden: number, width: number): Line =>
    fitted([plain(`${arrow} ${hidden} more`)], width)

/**
 * The frame fitted to a window of `rows - 1` lines: the content sliced from `offset`, a marker
 * wherever some of it is hidden, and the footer pinned as the last line (ADR-0041). The content is
 * everything afk printed in this process with the board in the middle of it: the lines before it,
 * its rows, its notices, and the lines after it.
 *
 * The footer keeps its line before the log holds any event, so the window's height does not change
 * when the first one arrives. A marker stands on the first or the last line of the slice and hides
 * the line it stands on too, so that one offset further is always every line one further up — a
 * marker with a line of its own would make the first step down from the top move nothing.
 */
export const boardWindow = (
    view: BoardView,
    { width, rows, offset, notices = [], before, after }: BoardWindow,
): Windowed => {
    const room = Math.max(rows - 1, 0)
    // A window too short even for the footer keeps what of its end it can hold.
    const whole = wrapped(footerOf(view, notices) ?? [plain("")], width)
    const footer = whole.slice(Math.max(whole.length - room, 0))
    // Each block is one thing said — a printed line, a row, a notice — in the lines it wraps to.
    const above = (before ?? []).map(line => printedLines(line, width))
    const blocks = [
        ...above,
        ...blocksOf(view, width, notices),
        ...(after ?? []).map(line => printedLines(line, width)),
    ]
    const content = blocks.flat()
    const continues = blocks.flatMap(block => block.map((_, index) => index > 0))
    const space = room - footer.length

    if (content.length <= space) {
        return { lines: [...content, ...footer], offset: 0 }
    }

    // A window with room for one line has no room for a marker as well, and shows the line itself.
    const marked = space > 1
    // The first view opens on the board's first row, with the top marker on the last line before it.
    const last = content.length - Math.max(space, 1)
    const opening = above.flat().length - (marked ? 1 : 0)
    let from = Math.min(Math.max(offset ?? opening, 0), last)
    // The top marker hides the rest of a wrapped line along with the row it stands on, rather than
    // leave that line's tail showing under it as though it were a line of its own.
    while (marked && from > 0 && continues[from + 1] === true) {
        from += 1
    }
    const slice = content.slice(from, from + Math.max(space, 0))
    const hiddenBelow = content.length - from - slice.length
    const shown = slice.map((line, index) => {
        if (marked && index === 0 && from > 0) {
            return marker("↑", from + 1, width)
        }
        if (marked && index === slice.length - 1 && hiddenBelow > 0) {
            return marker("↓", hiddenBelow + 1, width)
        }
        return line
    })
    // Past the last offset the content runs out, and the footer keeps its line all the same.
    const lines = [...shown, ...Array.from({ length: Math.max(space - shown.length, 0) }, (): Line => [plain("")])]

    return { lines: [...lines, ...footer], offset: from }
}

/**
 * Where one line up from `offset` is: the first offset above it whose window is not the one it
 * shows. The top marker hides a wrapped line whole, so an offset inside one draws the window its end
 * does, and going up one would draw the same window again — a key press that moved nothing.
 */
export const offsetAbove = (view: BoardView, window: BoardWindow): number => {
    const from = boardWindow(view, window).offset
    let to = from - 1
    while (to > 0 && boardWindow(view, { ...window, offset: to }).offset === from) {
        to -= 1
    }
    return Math.max(to, 0)
}

/**
 * The last paint: everything, unclipped, and nothing floating (ADR-0041). The footer sits directly
 * under the rows rather than pinned to a window that is going away, and the lines printed after the
 * board come last, so the pull request's link is the last thing on screen.
 */
export const boardWhole = (
    view: BoardView,
    { width, notices = [], before, after }: Omit<BoardWindow, "rows" | "offset">,
): readonly Line[] => {
    const footer = footerOf(view, notices)
    return [
        ...printed(before, width),
        ...view.rows.map(row => rowLine(row, width)),
        ...(footer === undefined ? [] : wrapped(footer, width)),
        ...notices.flatMap(notice => wrapped(wordsOf(notice.line), width)),
        ...printed(after, width),
    ]
}
