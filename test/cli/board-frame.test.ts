import { describe, expect, it } from "vitest"
import { boardFrame, elapsedText } from "../../src/cli/board-frame.ts"
import { type Line, type Span, textOf, widthOf } from "../../src/cli/board-span.ts"
import {
    type BoardRow,
    type BoardStep,
    type BoardView,
    type SettledOutcome,
    TRAIL_STEPS,
    type Track,
} from "../../src/domain/board.ts"
import type { Conclusion, Step } from "../../src/domain/events.ts"

/**
 * The layout, and no palette: every assertion here is either the plain text of a line or the role a
 * span carries, and none of them holds an escape sequence. What a terminal makes of a role is the
 * colouring step's, and it is asserted beside it (ADR-0031, ADR-0033).
 *
 * Every rule of the frame has one test that is about it, and no rule has two. An expected line is
 * written out whole, because that is what makes a row readable as a row in a test; restating a
 * row's shape inside a test about something else is the row being read, not a second assertion of
 * it.
 */

/** Where one step of a trail stands: what it came to, or that it is running or still ahead. */
type Standing = SettledOutcome | "running" | "interrupted" | "ahead"

/**
 * A trail written the short way: every step of the run, in order, where it stands. A step left
 * unnamed is still ahead, because a row covers every step whatever track it is on.
 */
const trail = (steps: Partial<Record<Step, Standing>>): readonly BoardStep[] =>
    TRAIL_STEPS.map((step): BoardStep => {
        const standing = steps[step] ?? "ahead"
        return standing === "running" || standing === "interrupted" || standing === "ahead"
            ? { step, state: standing }
            : { step, state: "settled", outcome: standing }
    })

const row = (
    ticket: number,
    title: string,
    track: Track,
    steps: readonly BoardStep[],
    rest: { waiting?: boolean; conclusion?: Conclusion; elapsed?: number; quiet?: boolean } = {},
): BoardRow => ({
    ticket,
    title,
    track,
    steps,
    waiting: rest.waiting ?? false,
    conclusion: rest.conclusion,
    // Why a step came to what it did is the line adapter's to say: a row says it in a colour.
    detail: undefined,
    elapsed: rest.elapsed,
    quiet: rest.quiet ?? false,
})

const IMPLEMENTING = trail({ setup: "ok", implement: "running" })

const MERGING = trail({ setup: "ok", implement: "ok", rebase: "ok", merge: "running" })

/** A view with a row on each track, which is the shape the one block has to hold. */
const VIEW: BoardView = {
    at: undefined,
    rows: [
        row(7, "Implement the slate", "merge", MERGING),
        row(108, "Rebase onto the spec branch", "implement", IMPLEMENTING),
    ],
}

const WIDE = 120

/** The one text a trail ever has, which is what every row of every frame reads as. */
const TRAIL = "setup implement rebase resolve merge gate fix revert"

/** What a span of a given text asks to be read at, where the line carries one. */
const spanFor = (line: Line | undefined, text: string): Span | undefined => line?.find(span => span.text === text)

describe("boardFrame", () => {
    it("should hold every row in one block, one line each, with no heading between them", () => {
        // given
        const view = VIEW

        // when
        const lines = boardFrame(view, WIDE).map(textOf)

        // then
        expect(lines).toEqual([`    7  ${TRAIL}`, `  108  ${TRAIL}`])
    })

    it.each([
        ["a ticket on the implement track", row(7, "A ticket", "implement", IMPLEMENTING)],
        ["a ticket the merge track has taken", row(7, "A ticket", "merge", MERGING)],
    ] as const)("should write every step, in order, for %s, whatever track it is on", (_case, only) => {
        // given
        const view: BoardView = { at: undefined, rows: [only] }

        // when
        const [line] = boardFrame(view, WIDE).map(textOf)

        // then
        expect(line).toBe(`    7  ${TRAIL}`)
    })

    it.each([
        ["a settled step", trail({ setup: "ok" })],
        ["a step the log has not ended", trail({ setup: "running" })],
        ["a step still ahead", trail({})],
        ["a step that failed", trail({ setup: "failed" })],
    ] as const)("should write the same trail whatever %s is read at", (_case, steps) => {
        // given
        const view: BoardView = { at: undefined, rows: [row(7, "A ticket", "implement", steps)] }

        // when
        const [line] = boardFrame(view, WIDE).map(textOf)

        // then
        expect(line).toBe(`    7  ${TRAIL}`)
    })

    it("should keep a ticket that reached the merge track in the row it has always had", () => {
        // given: the same view twice, with its second ticket taken into the merge track
        const others = [row(7, "A ticket", "merge", MERGING)]
        const implementing: BoardView = {
            at: undefined,
            rows: [...others, row(108, "Another", "implement", IMPLEMENTING)],
        }
        const merging: BoardView = { at: undefined, rows: [...others, row(108, "Another", "merge", MERGING)] }
        const was = boardFrame(implementing, WIDE).findIndex(line => textOf(line).startsWith("  108"))

        // when
        const now = boardFrame(merging, WIDE).findIndex(line => textOf(line).startsWith("  108"))

        // then
        expect(now).toBe(was)
    })

    it("should say that a ticket the merge track has not taken yet is waiting", () => {
        // given
        const waiting = row(7, "A ticket", "implement", trail({ setup: "ok", implement: "ok" }), { waiting: true })

        // when
        const [line] = boardFrame({ at: undefined, rows: [waiting] }, WIDE).map(textOf)

        // then
        expect(line).toBe(`    7  ${TRAIL} waiting`)
    })

    it.each([
        ["a ticket whose implementer failed", trail({ setup: "ok", implement: "failed" }), "failed"],
        ["a ticket blocked by one that will not land", trail({ implement: "skipped" }), "skipped"],
    ] as const)("should mark %s dead where it died", (_case, steps, conclusion) => {
        // given
        const view: BoardView = { at: undefined, rows: [row(7, "A ticket", "implement", steps, { conclusion })] }

        // when
        const [line] = boardFrame(view, WIDE).map(textOf)

        // then
        expect(line).toBe(`    7  ${TRAIL} dead`)
    })

    it("should not mark a verified ticket dead", () => {
        // given
        const verified = row(7, "A ticket", "merge", trail({ gate: "ok" }), { conclusion: "verified" })

        // when
        const [line] = boardFrame({ at: undefined, rows: [verified] }, WIDE).map(textOf)

        // then
        expect(line).toBe(`    7  ${TRAIL}`)
    })

    it("should say nothing about repair beside a step the log left running", () => {
        // given: a revert no pass would pick up, which the trail now says nothing more about
        const stuck = row(7, "A ticket", "merge", trail({ rebase: "ok", revert: "running" }))

        // when
        const [line] = boardFrame({ at: undefined, rows: [stuck] }, WIDE).map(textOf)

        // then
        expect(line).toBe(`    7  ${TRAIL}`)
    })

    it.each([
        [7, "    7  "],
        [108, "  108  "],
        [12345, "12345  "],
    ] as const)("should write ticket %i right-aligned into five columns with no prefix", (ticket, written) => {
        // given
        const view: BoardView = { at: undefined, rows: [row(ticket, "A ticket", "implement", IMPLEMENTING)] }

        // when
        const [line] = boardFrame(view, WIDE).map(textOf)

        // then
        expect(line?.slice(0, written.length)).toBe(written)
    })

    it("should not render the issue title", () => {
        // given
        const view: BoardView = { at: undefined, rows: [row(7, "Implement the slate", "implement", IMPLEMENTING)] }

        // when
        const lines = boardFrame(view, WIDE).map(textOf)

        // then
        expect(lines.some(line => line.includes("Implement the slate"))).toBe(false)
    })

    it.each([
        ["a ticket being implemented", row(7, "A ticket", "implement", IMPLEMENTING)],
        ["a ticket being merged", row(108, "Another", "merge", MERGING)],
        ["a verified ticket", row(12345, "A third", "merge", trail({ gate: "ok" }), { conclusion: "verified" })],
    ] as const)("should hold %s within an eighty-column terminal, uncut", (_case, only) => {
        // given
        const view: BoardView = { at: undefined, rows: [only] }

        // when
        const [line] = boardFrame(view, 80).map(textOf)

        // then
        expect(line?.endsWith("...")).toBe(false)
    })

    it.each([[WIDE], [24], [8], [2]] as const)("should truncate rather than wrap at a width of %i", width => {
        // given
        const view: BoardView = {
            at: undefined,
            rows: [row(7, "A ticket", "implement", IMPLEMENTING)],
        }

        // when
        const lines = boardFrame(view, width)

        // then
        expect(lines.every(line => widthOf(line) <= width)).toBe(true)
    })

    it("should mark a truncated row as cut", () => {
        // given
        const view: BoardView = { at: undefined, rows: [row(7, "A ticket", "implement", IMPLEMENTING)] }

        // when
        const lines = boardFrame(view, 32).map(textOf)

        // then
        expect(lines).toContain("    7  setup implement rebase...")
    })
})

/**
 * The footer is what is about the run rather than about a ticket, and it sits under every row. It
 * may grow — a notice arrives, and a long one takes several lines — and growing moves nothing above
 * it, because the writer rewinds over the lines it last drew (ADR-0029).
 */
/** How long a running step has been going, at the end of its row and nowhere else (ADR-0034). */
describe("boardFrame: the elapsed figure", () => {
    it("should end a row with a running step in how long it has been going", () => {
        // given
        const busy = row(7, "A ticket", "implement", IMPLEMENTING, { elapsed: 58_000 })

        // when
        const [line] = boardFrame({ at: undefined, rows: [busy] }, WIDE).map(textOf)

        // then
        expect(line).toBe(`    7  ${TRAIL} | 58s`)
    })

    it("should end a row with nothing running in its trail", () => {
        // given
        const settled = row(7, "A ticket", "implement", trail({ setup: "ok", implement: "ok" }))

        // when
        const [line] = boardFrame({ at: undefined, rows: [settled] }, WIDE).map(textOf)

        // then
        expect(line).toBe(`    7  ${TRAIL}`)
    })

    it("should leave the trail's words where they were", () => {
        // given
        const busy = row(7, "A ticket", "implement", IMPLEMENTING, { elapsed: 3_600_000 })
        const idle = row(8, "A ticket", "implement", IMPLEMENTING)

        // when
        const lines = boardFrame({ at: undefined, rows: [busy, idle] }, WIDE).map(textOf)

        // then
        expect(lines.map(line => line.slice(0, 7 + TRAIL.length))).toEqual([`    7  ${TRAIL}`, `    8  ${TRAIL}`])
    })

    it.each([[0], [59_000], [3_600_000]] as const)(
        "should keep the frame's height the ticket count at %i ms",
        elapsed => {
            // given
            const rows = [7, 8, 9].map(ticket => row(ticket, "A ticket", "implement", IMPLEMENTING, { elapsed }))

            // when
            const lines = boardFrame({ at: undefined, rows }, WIDE)

            // then
            expect(lines).toHaveLength(3)
        },
    )
})

/** Whether the running step is still writing, carried by colour and never by the words (ADR-0031). */
describe("boardFrame: a step gone quiet", () => {
    it.each([
        ["still writing", false, "running"],
        ["gone quiet", true, "quiet"],
    ] as const)("should read the running step of a row %s as %s", (_case, quiet, role) => {
        // given
        const busy = row(7, "A ticket", "implement", IMPLEMENTING, { elapsed: 58_000, quiet })

        // when
        const [line] = boardFrame({ at: undefined, rows: [busy] }, WIDE)

        // then
        expect(spanFor(line, "implement")?.role).toBe(role)
    })

    it.each([
        ["still writing", false, "plain"],
        ["gone quiet", true, "quiet"],
    ] as const)("should read the elapsed figure of a row %s as %s", (_case, quiet, role) => {
        // given
        const busy = row(7, "A ticket", "implement", IMPLEMENTING, { elapsed: 58_000, quiet })

        // when
        const [line] = boardFrame({ at: undefined, rows: [busy] }, WIDE)

        // then
        expect(spanFor(line, "58s")?.role).toBe(role)
    })

    it("should write an interrupted row in the words a running one is written in", () => {
        // given
        const rows = [IMPLEMENTING, trail({ setup: "ok", implement: "interrupted" })].map(steps =>
            row(7, "A ticket", "implement", steps),
        )

        // when
        const [running, interrupted] = rows.map(one => boardFrame({ at: undefined, rows: [one] }, WIDE).map(textOf)[0])

        // then
        expect(interrupted).toBe(running)
    })

    it("should write a quiet row in the words a writing one is written in", () => {
        // given
        const rows = [false, true].map(quiet =>
            row(7, "A ticket", "implement", IMPLEMENTING, { elapsed: 58_000, quiet }),
        )

        // when
        const [writing, quiet] = rows.map(one => boardFrame({ at: undefined, rows: [one] }, WIDE).map(textOf)[0])

        // then
        expect(quiet).toBe(writing)
    })
})

describe("elapsedText", () => {
    it.each([
        [0, "0s"],
        [999, "0s"],
        [58_000, "58s"],
        [59_999, "59s"],
        [60_000, "1m00s"],
        [245_000, "4m05s"],
        [3_599_000, "59m59s"],
        [3_600_000, "1h00m"],
        [3_720_000, "1h02m"],
        [90_000_000, "25h00m"],
    ] as const)("should write %i ms as %s", (ms, written) => {
        // given
        const elapsed = ms

        // when
        const text = elapsedText(elapsed)

        // then
        expect(text).toBe(written)
    })
})

describe("boardFrame: the footer", () => {
    const AT = "2026-09-15T11:18:38.314Z"

    it("should say nothing about time where the log holds no event", () => {
        // given
        const view = VIEW

        // when
        const lines = boardFrame(view, WIDE).map(textOf)

        // then
        expect(lines.some(line => line.includes("last event"))).toBe(false)
    })

    it("should carry the last event's timestamp under the rows, with the notice beneath it", () => {
        // given
        const view: BoardView = { ...VIEW, at: AT }

        // when
        const lines = boardFrame(view, WIDE, "afk: interrupted").map(textOf)

        // then
        expect(lines.slice(-2)).toEqual([`last event ${AT}`, "afk: interrupted"])
    })

    it("should move no row when the footer grows", () => {
        // given
        const view: BoardView = { ...VIEW, at: AT }
        const before = boardFrame(view, WIDE).map(textOf)

        // when
        const after = boardFrame(view, WIDE, "afk: interrupted").map(textOf)

        // then
        expect(after.slice(0, before.length)).toEqual(before)
    })

    it("should wrap a notice too long for the terminal rather than truncate it", () => {
        // given
        const notice = "afk: interrupted — starting nothing new"

        // when
        const lines = boardFrame(VIEW, 20, notice).map(textOf)

        // then
        expect(lines.slice(VIEW.rows.length).join(" ")).toBe(notice)
    })

    it.each([[WIDE], [20], [8], [1]] as const)("should hold the footer within a width of %i", width => {
        // given
        const view: BoardView = { ...VIEW, at: AT }

        // when
        const lines = boardFrame(view, width, "afk: interrupted — starting nothing new")

        // then
        expect(lines.every(line => widthOf(line) <= width)).toBe(true)
    })

    it("should break a word no terminal of that width could hold", () => {
        // given
        const view: BoardView = { ...VIEW, at: AT }

        // when
        const lines = boardFrame(view, 8).map(textOf)

        // then
        expect(lines.slice(VIEW.rows.length)).toEqual(["last", "event", "2026-09-", "15T11:18", ":38.314Z"])
    })
})

/**
 * The layout hands out spans, and this is where they are read as spans rather than as the text they
 * carry: what each part of a row is, as the role it is given. No assertion here holds an escape
 * sequence — what a terminal makes of a role is the colouring step's (ADR-0031, ADR-0033).
 */
describe("boardFrame: what a row asks to be read at", () => {
    it("should hand a row out as the parts it is made of, each in a span of its own", () => {
        // given
        const view: BoardView = { at: undefined, rows: [row(7, "A ticket", "implement", IMPLEMENTING)] }

        // when
        const [line] = boardFrame(view, WIDE)

        // then
        expect(line?.map(span => span.text)).toEqual([
            "    ",
            "7",
            "  ",
            "setup",
            " ",
            "implement",
            " ",
            "rebase",
            " ",
            "resolve",
            " ",
            "merge",
            " ",
            "gate",
            " ",
            "fix",
            " ",
            "revert",
        ])
    })

    it.each([
        ["a step still ahead", "ahead", "ahead"],
        ["a step the log started and has not ended", "running", "running"],
        ["a step a run nothing holds left open", "interrupted", "interrupted"],
        ["a settled step that went well", "ok", "plain"],
        ["a settled conflicted step", "conflicted", "conflicted"],
        ["a settled failed step", "failed", "failed"],
        ["a settled skipped step", "skipped", "skipped"],
    ] as const)("should read %s as its own role", (_case, standing, role) => {
        // given
        const view: BoardView = {
            at: undefined,
            rows: [row(7, "A ticket", "implement", trail({ resolve: standing }))],
        }

        // when
        const [line] = boardFrame(view, WIDE)

        // then
        expect(spanFor(line, "resolve")?.role).toBe(role)
    })

    it.each([
        ["a ticket the gate has proven", "verified", "verified"],
        ["a ticket that broke", "failed", "failed"],
        ["a ticket a blocker took down with it", "skipped", "skipped"],
        ["a ticket that landed unproven", "unverified", "plain"],
    ] as const)("should read the number of %s as the run's verdict on it", (_case, conclusion, role) => {
        // given
        const view: BoardView = {
            at: undefined,
            rows: [row(7, "A ticket", "merge", trail({ gate: "ok" }), { conclusion })],
        }

        // when
        const [line] = boardFrame(view, WIDE)

        // then
        expect(spanFor(line, "7")?.role).toBe(role)
    })

    it("should read a ticket the run has brought to nothing yet as plain", () => {
        // given
        const view: BoardView = { at: undefined, rows: [row(7, "A ticket", "implement", IMPLEMENTING)] }

        // when
        const [line] = boardFrame(view, WIDE)

        // then
        expect(spanFor(line, "7")?.role).toBe("plain")
    })

    it("should mark a dead ticket at the verdict its number carries", () => {
        // given
        const skipped = row(7, "A ticket", "implement", trail({ setup: "ok" }), { conclusion: "skipped" })

        // when
        const [line] = boardFrame({ at: undefined, rows: [skipped] }, WIDE)

        // then
        expect(spanFor(line, "dead")?.role).toBe("skipped")
    })

    it("should give verified to nothing but the number of a ticket the gate proved", () => {
        // given: every row a run has, verified and unverified, alongside every settled outcome
        const view: BoardView = {
            at: undefined,
            rows: [
                row(7, "A ticket", "merge", trail({ gate: "ok" }), { conclusion: "verified" }),
                row(108, "Another", "merge", trail({ resolve: "conflicted", merge: "failed", fix: "skipped" })),
                row(12345, "A third", "implement", IMPLEMENTING),
            ],
        }

        // when
        const verified = boardFrame(view, WIDE).flatMap(line => line.filter(span => span.role === "verified"))

        // then
        expect(verified.map(span => span.text)).toEqual(["7"])
    })
})
