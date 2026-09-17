import { describe, expect, it } from "vitest"
import { boardFrame } from "../../src/cli/board-frame.ts"
import type { BoardView } from "../../src/domain/board.ts"

/** A view with a row on each track, which is the shape the layout has to hold. */
const VIEW: BoardView = {
    rows: [
        { ticket: 7, title: "Implement the slate", track: "merge" },
        { ticket: 108, title: "Rebase onto the spec branch", track: "implement" },
    ],
}

const WIDE = 80

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
        const view: BoardView = { rows: [{ ticket: 7, title: "Implement the slate", track: "implement" }] }

        // when
        const lines = boardFrame(view, WIDE)

        // then
        expect(lines).toEqual(["implement track", "  #7  Implement the slate", "merge track"])
    })

    it("should put a ticket's row under the heading of the track it is on", () => {
        // given
        const view = VIEW

        // when
        const lines = boardFrame(view, WIDE)

        // then
        expect(lines).toEqual([
            "implement track",
            "  #108  Rebase onto the spec branch",
            "merge track",
            "  #7    Implement the slate",
        ])
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
            rows: [{ ticket: 7, title: "A title far longer than the terminal it is read on", track: "implement" }],
        }

        // when
        const lines = boardFrame(view, width)

        // then
        expect(lines.every(line => line.length <= width)).toBe(true)
    })

    it("should mark a truncated title as cut", () => {
        // given
        const view: BoardView = {
            rows: [{ ticket: 7, title: "A title far longer than the terminal it is read on", track: "implement" }],
        }

        // when
        const lines = boardFrame(view, 20)

        // then
        expect(lines).toContain("  #7  A title far...")
    })
})
