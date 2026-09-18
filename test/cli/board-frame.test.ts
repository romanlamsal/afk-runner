import { describe, expect, it } from "vitest"
import { boardFrame } from "../../src/cli/board-frame.ts"
import type { BoardRow, BoardStep, BoardView, SettledOutcome, Track } from "../../src/domain/board.ts"
import type { Conclusion, Step } from "../../src/domain/events.ts"

/**
 * A trail written the short way: the steps of a track, each at the weight it is read at — `running`
 * or `ahead`, or what a settled step came to.
 */
const trail = (steps: Readonly<Record<string, SettledOutcome | "running" | "ahead">>): readonly BoardStep[] =>
    Object.entries(steps).map(([name, weight]) => {
        const step = name as Step
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

const MERGING = trail({
    rebase: "ok",
    resolve: "ahead",
    merge: "running",
    gate: "ahead",
    fix: "ahead",
    revert: "ahead",
})

/** A view with a row on each track, which is the shape the layout has to hold. */
const VIEW: BoardView = {
    at: undefined,
    rows: [
        row(7, "Implement the slate", "merge", MERGING),
        row(108, "Rebase onto the spec branch", "implement", IMPLEMENTING),
    ],
}

const WIDE = 120

describe("boardFrame", () => {
    it.each([["implement track"], ["merge track"]] as const)("should head its blocks with %s", heading => {
        // given
        const view = VIEW

        // when
        const lines = boardFrame(view, WIDE)

        // then
        expect(lines).toContain(heading)
    })

    it("should head both blocks even where one of them has no rows", () => {
        // given
        const view: BoardView = { at: undefined, rows: [row(7, "Implement the slate", "implement", IMPLEMENTING)] }

        // when
        const lines = boardFrame(view, WIDE)

        // then
        expect(lines).toEqual(["implement track", "  #7  setup\u2713 <implement>  Implement the slate", "merge track"])
    })

    it("should put a ticket's row under the heading of the track it is on", () => {
        // given
        const view = VIEW

        // when
        const lines = boardFrame(view, WIDE)

        // then
        expect(lines).toEqual([
            "implement track",
            "  #108  setup\u2713 <implement>  Rebase onto the spec branch",
            "merge track",
            "  #7    rebase\u2713 (resolve) <merge> (gate) (fix) (revert)  Implement the slate",
        ])
    })

    it.each([
        ["a settled step", "setup\u2713"],
        ["a step the log has not ended", "<implement>"],
        ["a step still ahead", "(rebase)"],
    ] as const)("should write %s as %s", (_case, written) => {
        // given
        const view: BoardView = {
            at: undefined,
            rows: [
                row(7, "A ticket", "implement", IMPLEMENTING),
                row(8, "Another ticket", "merge", trail({ rebase: "ahead", merge: "ahead" })),
            ],
        }

        // when
        const lines = boardFrame(view, WIDE)

        // then
        expect(lines.some(line => line.includes(written))).toBe(true)
    })

    it("should say that a ticket the merge track has not taken yet is waiting", () => {
        // given
        const waiting = row(7, "A ticket", "implement", trail({ setup: "ok", implement: "ok" }), { waiting: true })

        // when
        const lines = boardFrame({ at: undefined, rows: [waiting] }, WIDE)

        // then
        expect(lines).toContain("  #7  setup\u2713 implement\u2713 waiting  A ticket")
    })

    it.each([
        ["ok", "\u2713"],
        ["failed", "\u2717"],
        ["skipped", "\u00b7"],
        ["conflicted", "!"],
    ] as const)("should write a step that came to %s with the glyph %s", (outcome, glyph) => {
        // given
        const view: BoardView = { at: undefined, rows: [row(7, "A ticket", "implement", trail({ setup: outcome }))] }

        // when
        const lines = boardFrame(view, WIDE)

        // then
        expect(lines).toContain(`  #7  setup${glyph}  A ticket`)
    })

    it.each([
        [
            "a ticket whose implementer failed",
            row(7, "A ticket", "implement", trail({ setup: "ok", implement: "failed" }), { conclusion: "failed" }),
            "  #7  setup\u2713 implement\u2717 dead  A ticket",
        ],
        [
            "a ticket blocked by one that will not land",
            row(7, "A ticket", "implement", trail({ setup: "ahead", implement: "skipped" }), {
                conclusion: "skipped",
            }),
            "  #7  (setup) implement\u00b7 dead  A ticket",
        ],
    ] as const)("should mark %s dead where it died", (_case, dying, expected) => {
        // given
        const view: BoardView = { at: undefined, rows: [dying] }

        // when
        const lines = boardFrame(view, WIDE)

        // then
        expect(lines).toContain(expected)
    })

    it("should not mark a verified ticket dead", () => {
        // given
        const verified = row(7, "A ticket", "merge", trail({ gate: "ok" }), { conclusion: "verified" })

        // when
        const lines = boardFrame({ at: undefined, rows: [verified] }, WIDE)

        // then
        expect(lines).toContain("  #7  gate\u2713  A ticket")
    })

    it("should say nothing about repair beside a step the log left running", () => {
        // given: a revert no pass would pick up, which the trail now says nothing more about
        const stuck = row(7, "A ticket", "merge", trail({ rebase: "ok", revert: "running" }))

        // when
        const lines = boardFrame({ at: undefined, rows: [stuck] }, WIDE)

        // then
        expect(lines).toContain("  #7  rebase\u2713 <revert>  A ticket")
    })

    it("should be as tall as the row count plus one heading per track", () => {
        // given
        const view = VIEW

        // when
        const lines = boardFrame(view, WIDE)

        // then
        expect(lines).toHaveLength(VIEW.rows.length + 2)
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
        expect(lines.every(line => line.length <= width)).toBe(true)
    })

    it("should mark a truncated title as cut", () => {
        // given
        const view: BoardView = {
            at: undefined,
            rows: [row(7, "A title far longer than the terminal it is read on", "implement", IMPLEMENTING)],
        }

        // when
        const lines = boardFrame(view, 32)

        // then
        expect(lines).toContain("  #7  setup\u2713 <implement>  A t...")
    })
})

describe("boardFrame: the run's status line", () => {
    it("should put a notice under both blocks, where no row ever moves for it", () => {
        // given
        const view: BoardView = { at: undefined, rows: [row(7, "Implement the slate", "implement", IMPLEMENTING)] }

        // when
        const lines = boardFrame(view, WIDE, "afk: interrupted")

        // then
        expect(lines).toEqual([
            "implement track",
            "  #7  setup\u2713 <implement>  Implement the slate",
            "merge track",
            "afk: interrupted",
        ])
    })

    it("should leave the frame as it was where the run has said nothing", () => {
        // given
        const view = VIEW

        // when
        const lines = boardFrame(view, WIDE)

        // then
        expect(lines).toHaveLength(VIEW.rows.length + 2)
    })

    it("should truncate a notice too long for the terminal rather than wrap it", () => {
        // given
        const view = VIEW

        // when
        const lines = boardFrame(view, 20, "afk: interrupted — starting nothing new")

        // then
        expect(lines.at(-1)).toBe("afk: interrupted ...")
    })
})

describe("boardFrame: when the last thing happened", () => {
    const WHEN = "2026-09-15T11:18:38.314Z"

    it("should write the view's timestamp under the blocks", () => {
        // given
        const view: BoardView = { ...VIEW, at: WHEN }

        // when
        const lines = boardFrame(view, WIDE)

        // then
        expect(lines.at(-1)).toBe(`last event ${WHEN}`)
    })

    it("should write nothing where the view carries no timestamp", () => {
        // given
        const view: BoardView = { ...VIEW, at: undefined }

        // when
        const lines = boardFrame(view, WIDE)

        // then
        expect(lines.some(line => line.includes("last event"))).toBe(false)
    })

    it("should keep the notice the frame's last line", () => {
        // given
        const view: BoardView = { ...VIEW, at: WHEN }

        // when
        const lines = boardFrame(view, WIDE, "afk: interrupted")

        // then
        expect(lines.slice(-2)).toEqual([`last event ${WHEN}`, "afk: interrupted"])
    })

    it("should truncate a timestamp line too long for the terminal rather than wrap it", () => {
        // given
        const view: BoardView = { ...VIEW, at: WHEN }

        // when
        const lines = boardFrame(view, 20)

        // then
        expect(lines.at(-1)).toBe("last event 2026-0...")
    })
})
