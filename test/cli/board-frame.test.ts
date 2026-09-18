import { describe, expect, it } from "vitest"
import { boardFrame } from "../../src/cli/board-frame.ts"
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
 * The layout, and no palette: every assertion here is either the plain text of a line or what a
 * span asks to be read at, and none of them holds an escape sequence. What a terminal makes of a
 * tone or a hue is the colouring step's, and it is asserted beside it (ADR-0031).
 *
 * Every rule of the frame has one test that is about it, and no rule has two. An expected line is
 * written out whole, because that is what makes a row readable as a row in a test; restating a
 * row's shape inside a test about something else is the row being read, not a second assertion of
 * it.
 */

/** The weight one step of a trail is read at: what it came to, or where it stands. */
type Weight = SettledOutcome | "running" | "ahead"

/**
 * A trail written the short way: every step of the run, in order, at the weight it is read at. A
 * step left unnamed is still ahead, because a row covers every step whatever track it is on.
 */
const trail = (steps: Partial<Record<Step, Weight>>): readonly BoardStep[] =>
    TRAIL_STEPS.map((step): BoardStep => {
        const weight = steps[step] ?? "ahead"
        return weight === "running" || weight === "ahead"
            ? { step, state: weight }
            : { step, state: "settled", outcome: weight }
    })

const row = (
    ticket: number,
    title: string,
    track: Track,
    steps: readonly BoardStep[],
    rest: { waiting?: boolean; conclusion?: Conclusion } = {},
): BoardRow => ({
    ticket,
    title,
    track,
    steps,
    waiting: rest.waiting ?? false,
    conclusion: rest.conclusion,
    // Why a step came to what it did is the line adapter's to say: a row says it in a hue.
    detail: undefined,
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
 * carry: where a step stands in the run is a tone, and an outcome worth noticing is a hue. No
 * assertion here holds an escape sequence — what colour makes of a tone is the colouring step's
 * (ADR-0031).
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
        ["a step still ahead", "ahead", "dim"],
        ["a settled step", "ok", "normal"],
        ["a step the log started and has not ended", "running", "bright"],
    ] as const)("should read %s at its own weight", (_case, weight, tone) => {
        // given
        const view: BoardView = {
            at: undefined,
            rows: [row(7, "A ticket", "implement", trail({ setup: weight }))],
        }

        // when
        const [line] = boardFrame(view, WIDE)

        // then
        expect(spanFor(line, "setup")?.tone).toBe(tone)
    })

    it.each([
        ["a settled conflicted step", "conflicted", "amber"],
        ["a settled failed step", "failed", "red"],
        ["a settled step that went well", "ok", undefined],
        ["a settled skipped step", "skipped", undefined],
    ] as const)("should give %s its hue", (_case, outcome, hue) => {
        // given
        const view: BoardView = {
            at: undefined,
            rows: [row(7, "A ticket", "implement", trail({ resolve: outcome }))],
        }

        // when
        const [line] = boardFrame(view, WIDE)

        // then
        expect(spanFor(line, "resolve")?.hue).toBe(hue)
    })

    it("should turn a verified ticket's number green", () => {
        // given
        const verified = row(7, "A ticket", "merge", trail({ gate: "ok" }), { conclusion: "verified" })

        // when
        const [line] = boardFrame({ at: undefined, rows: [verified] }, WIDE)

        // then
        expect(spanFor(line, "7")?.hue).toBe("green")
    })

    it("should give green to nothing but a verified ticket's number", () => {
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
        const green = boardFrame(view, WIDE).flatMap(line => line.filter(span => span.hue === "green"))

        // then
        expect(green.map(span => span.text)).toEqual(["7"])
    })
})
