import { describe, expect, it } from "vitest"
import { boardFrame } from "../../src/cli/board-frame.ts"
import { textOf, widthOf } from "../../src/cli/board-span.ts"
import {
    type BoardRow,
    type BoardStep,
    type BoardView,
    type SettledOutcome,
    TRAIL_STEPS,
    type Track,
} from "../../src/domain/board.ts"
import type { Conclusion, Step } from "../../src/domain/events.ts"

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
    // Why a step came to what it did is the line adapter's to say: a frame has a glyph for it.
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

describe("boardFrame", () => {
    it("should hold every row in one block, with no headings", () => {
        // given
        const view = VIEW

        // when
        const lines = boardFrame(view, WIDE).map(textOf)

        // then
        expect(lines).toEqual([
            "  #7    setup✓ implement✓ rebase✓ (resolve) <merge> (gate) (fix) (revert)    Implement the slate",
            "  #108  setup✓ <implement> (rebase) (resolve) (merge) (gate) (fix) (revert)  Rebase onto the spec branch",
        ])
    })

    it.each([
        ["a ticket on the implement track", row(7, "A ticket", "implement", IMPLEMENTING)],
        ["a ticket the merge track has taken", row(7, "A ticket", "merge", MERGING)],
    ] as const)("should cover every step, in order, for %s", (_case, only) => {
        // given
        const view: BoardView = { at: undefined, rows: [only] }

        // when
        const [line] = boardFrame(view, WIDE).map(textOf)

        // then
        expect(TRAIL_STEPS.every(step => line?.includes(step))).toBe(true)
    })

    it("should keep a ticket that reached the merge track in the row it has always had", () => {
        // given: the same view twice, with its second ticket taken into the merge track
        const others = [row(7, "A ticket", "merge", MERGING)]
        const implementing: BoardView = {
            at: undefined,
            rows: [...others, row(108, "Another", "implement", IMPLEMENTING)],
        }
        const merging: BoardView = { at: undefined, rows: [...others, row(108, "Another", "merge", MERGING)] }
        const was = boardFrame(implementing, WIDE).findIndex(line => textOf(line).includes("#108"))

        // when
        const now = boardFrame(merging, WIDE).findIndex(line => textOf(line).includes("#108"))

        // then
        expect(now).toBe(was)
    })

    it.each([
        ["a settled step", "setup✓"],
        ["a step the log has not ended", "<implement>"],
        ["a step still ahead", "(rebase)"],
    ] as const)("should write %s as %s", (_case, written) => {
        // given
        const view: BoardView = {
            at: undefined,
            rows: [row(7, "A ticket", "implement", IMPLEMENTING), row(8, "Another ticket", "merge", MERGING)],
        }

        // when
        const lines = boardFrame(view, WIDE).map(textOf)

        // then
        expect(lines.some(line => line.includes(written))).toBe(true)
    })

    it("should say that a ticket the merge track has not taken yet is waiting", () => {
        // given
        const waiting = row(7, "A ticket", "implement", trail({ setup: "ok", implement: "ok" }), { waiting: true })

        // when
        const lines = boardFrame({ at: undefined, rows: [waiting] }, WIDE).map(textOf)

        // then
        expect(lines).toContain(
            "  #7  setup✓ implement✓ (rebase) (resolve) (merge) (gate) (fix) (revert) waiting  A ticket",
        )
    })

    it.each([
        ["ok", "✓"],
        ["failed", "✗"],
        ["skipped", "·"],
        ["conflicted", "!"],
    ] as const)("should write a step that came to %s with the glyph %s", (outcome, glyph) => {
        // given
        const view: BoardView = { at: undefined, rows: [row(7, "A ticket", "implement", trail({ setup: outcome }))] }

        // when
        const lines = boardFrame(view, WIDE).map(textOf)

        // then
        expect(lines).toContain(
            `  #7  setup${glyph} (implement) (rebase) (resolve) (merge) (gate) (fix) (revert)  A ticket`,
        )
    })

    it.each([
        [
            "a ticket whose implementer failed",
            row(7, "A ticket", "implement", trail({ setup: "ok", implement: "failed" }), { conclusion: "failed" }),
            "  #7  setup✓ implement✗ (rebase) (resolve) (merge) (gate) (fix) (revert) dead  A ticket",
        ],
        [
            "a ticket blocked by one that will not land",
            row(7, "A ticket", "implement", trail({ implement: "skipped" }), { conclusion: "skipped" }),
            "  #7  (setup) implement· (rebase) (resolve) (merge) (gate) (fix) (revert) dead  A ticket",
        ],
    ] as const)("should mark %s dead where it died", (_case, dying, expected) => {
        // given
        const view: BoardView = { at: undefined, rows: [dying] }

        // when
        const lines = boardFrame(view, WIDE).map(textOf)

        // then
        expect(lines).toContain(expected)
    })

    it("should not mark a verified ticket dead", () => {
        // given
        const verified = row(7, "A ticket", "merge", trail({ gate: "ok" }), { conclusion: "verified" })

        // when
        const lines = boardFrame({ at: undefined, rows: [verified] }, WIDE).map(textOf)

        // then
        expect(lines).toContain("  #7  (setup) (implement) (rebase) (resolve) (merge) gate✓ (fix) (revert)  A ticket")
    })

    it("should say nothing about repair beside a step the log left running", () => {
        // given: a revert no pass would pick up, which the trail now says nothing more about
        const stuck = row(7, "A ticket", "merge", trail({ rebase: "ok", revert: "running" }))

        // when
        const lines = boardFrame({ at: undefined, rows: [stuck] }, WIDE).map(textOf)

        // then
        expect(lines).toContain("  #7  (setup) (implement) rebase✓ (resolve) (merge) (gate) (fix) <revert>  A ticket")
    })

    it("should be as tall as the row count, because there is one block and no heading", () => {
        // given
        const view = VIEW

        // when
        const lines = boardFrame(view, WIDE).map(textOf)

        // then
        expect(lines).toHaveLength(VIEW.rows.length)
    })

    it.each([[WIDE], [24], [8], [2]] as const)("should truncate rather than wrap at a width of %i", width => {
        // given
        const view: BoardView = {
            at: undefined,
            rows: [row(7, "A title far longer than the terminal it is read on", "implement", IMPLEMENTING)],
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
        expect(lines).toContain("  #7  setup✓ <implement> (reb...")
    })
})

/**
 * The footer is what is about the run rather than about a ticket, and it sits under every row. It
 * may grow — a notice arrives, and a long one takes several lines — and growing moves nothing above
 * it, because the writer rewinds over the lines it last drew (ADR-0029).
 */
describe("boardFrame: the footer", () => {
    const AT = "2026-09-15T11:18:38.314Z"

    it("should put a notice under the rows, where no row ever moves for it", () => {
        // given
        const view: BoardView = { at: undefined, rows: [row(7, "Implement the slate", "implement", IMPLEMENTING)] }

        // when
        const lines = boardFrame(view, WIDE, "afk: interrupted").map(textOf)

        // then
        expect(lines).toEqual([
            "  #7  setup✓ <implement> (rebase) (resolve) (merge) (gate) (fix) (revert)  Implement the slate",
            "afk: interrupted",
        ])
    })

    it("should carry the last event's timestamp under every row", () => {
        // given
        const view: BoardView = { ...VIEW, at: AT }

        // when
        const lines = boardFrame(view, WIDE).map(textOf)

        // then
        expect(lines.at(-1)).toBe(`last event ${AT}`)
    })

    it("should say nothing about time where the log holds no event", () => {
        // given
        const view = VIEW

        // when
        const lines = boardFrame(view, WIDE).map(textOf)

        // then
        expect(lines.some(line => line.includes("last event"))).toBe(false)
    })

    it("should put the notice beneath the timestamp", () => {
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
 * The layout hands out spans, and this is the one place that reads them as spans rather than as the
 * text they carry. No assertion here holds an escape sequence: what colour makes of a span is the
 * colouring step's, and it is asserted beside it (ADR-0031).
 */
describe("boardFrame: the spans a line is made of", () => {
    it("should hand a row out as the parts it is made of, each in a span of its own", () => {
        // given
        const view: BoardView = { at: undefined, rows: [row(7, "A ticket", "implement", IMPLEMENTING)] }

        // when
        const [line] = boardFrame(view, WIDE)

        // then
        expect(line?.map(span => span.text)).toEqual([
            "  ",
            "#7",
            "  ",
            "setup✓",
            " ",
            "<implement>",
            " ",
            "(rebase)",
            " ",
            "(resolve)",
            " ",
            "(merge)",
            " ",
            "(gate)",
            " ",
            "(fix)",
            " ",
            "(revert)",
            "  ",
            "A ticket",
        ])
    })

    it("should ask for no treatment at all, while the trail's own text carries the state", () => {
        // given
        const view = VIEW

        // when
        const lines = boardFrame(view, WIDE)

        // then
        expect(lines.flat().every(span => span.tone === "normal" && span.hue === undefined)).toBe(true)
    })
})
