import { describe, expect, it } from "vitest"
import { boardFrame } from "../../src/cli/board-frame.ts"
import type { BoardRow, BoardStep, BoardView, StepState, Track } from "../../src/domain/board.ts"
import type { Step } from "../../src/domain/events.ts"

/** A trail written the short way: the steps of a track, each at the weight it is read at. */
const trail = (steps: Readonly<Record<string, StepState>>): readonly BoardStep[] =>
    Object.entries(steps).map(([step, state]) => ({ step: step as Step, state }))

const row = (ticket: number, title: string, track: Track, steps: readonly BoardStep[], waiting = false): BoardRow => ({
    ticket,
    title,
    track,
    steps,
    waiting,
})

const IMPLEMENTING = trail({ setup: "settled", implement: "live" })

const MERGING = trail({
    rebase: "settled",
    resolve: "ahead",
    merge: "live",
    gate: "ahead",
    fix: "ahead",
    revert: "ahead",
})

/** A view with a row on each track, which is the shape the layout has to hold. */
const VIEW: BoardView = {
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
        const view: BoardView = { rows: [row(7, "Implement the slate", "implement", IMPLEMENTING)] }

        // when
        const lines = boardFrame(view, WIDE)

        // then
        expect(lines).toEqual(["implement track", "  #7  setup <implement>  Implement the slate", "merge track"])
    })

    it("should put a ticket's row under the heading of the track it is on", () => {
        // given
        const view = VIEW

        // when
        const lines = boardFrame(view, WIDE)

        // then
        expect(lines).toEqual([
            "implement track",
            "  #108  setup <implement>  Rebase onto the spec branch",
            "merge track",
            "  #7    rebase (resolve) <merge> (gate) (fix) (revert)  Implement the slate",
        ])
    })

    it.each([
        ["a settled step", "setup"],
        ["the live step", "<implement>"],
        ["a step still ahead", "(rebase)"],
    ] as const)("should write %s as %s", (_case, written) => {
        // given
        const view: BoardView = {
            rows: [
                row(7, "A ticket", "implement", IMPLEMENTING),
                row(8, "Another ticket", "merge", trail({ rebase: "ahead" })),
            ],
        }

        // when
        const lines = boardFrame(view, WIDE)

        // then
        expect(lines.some(line => line.includes(written))).toBe(true)
    })

    it("should say that a ticket the merge track has not taken yet is waiting", () => {
        // given
        const waiting = row(7, "A ticket", "implement", trail({ setup: "settled", implement: "settled" }), true)

        // when
        const lines = boardFrame({ rows: [waiting] }, WIDE)

        // then
        expect(lines).toContain("  #7  setup implement waiting  A ticket")
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
            rows: [row(7, "A title far longer than the terminal it is read on", "implement", IMPLEMENTING)],
        }

        // when
        const lines = boardFrame(view, 32)

        // then
        expect(lines).toContain("  #7  setup <implement>  A ti...")
    })
})

describe("boardFrame: the run's status line", () => {
    it("should put a notice under both blocks, where no row ever moves for it", () => {
        // given
        const view: BoardView = { rows: [row(7, "Implement the slate", "implement", IMPLEMENTING)] }

        // when
        const lines = boardFrame(view, WIDE, "afk: interrupted")

        // then
        expect(lines).toEqual([
            "implement track",
            "  #7  setup <implement>  Implement the slate",
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
