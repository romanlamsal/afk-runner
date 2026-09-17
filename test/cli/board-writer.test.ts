import { describe, expect, it } from "vitest"
import { createTerminalBoard } from "../../src/cli/board-writer.ts"
import type { BoardView } from "../../src/domain/board.ts"

/**
 * The cursor is the writer's and nothing here asserts about it: what is asserted is the one thing
 * the writer alone owns, which is that a notice arriving out of the loop's turn — a signal handler
 * is the caller — reaches the screen at once and stays on the frames after it (ADR-0029).
 */

const VIEW: BoardView = {
    rows: [
        {
            ticket: 7,
            title: "Implement the slate",
            track: "implement",
            steps: [
                { step: "setup", state: "settled", outcome: "ok" },
                { step: "implement", state: "live" },
            ],
            waiting: false,
            conclusion: undefined,
            beyondRepair: false,
        },
    ],
}

const DRAINING = "afk: interrupted — starting nothing new"

const harness = () => {
    const written: string[] = []
    return { written, board: createTerminalBoard({ write: chunk => written.push(chunk), columns: () => 80 }) }
}

describe("createTerminalBoard", () => {
    it("should redraw with the notice as soon as it is given one, rather than wait for the next frame", () => {
        // given
        const { written, board } = harness()
        board.show(VIEW)

        // when
        board.notice(DRAINING)

        // then
        expect(written.at(-1)).toContain(DRAINING)
    })

    it("should keep the notice on every frame after it", () => {
        // given
        const { written, board } = harness()
        board.show(VIEW)
        board.notice(DRAINING)

        // when
        board.show(VIEW)

        // then
        expect(written.at(-1)).toContain(DRAINING)
    })

    it("should write nothing for a notice that arrives before the first frame", () => {
        // given
        const { written, board } = harness()

        // when
        board.notice(DRAINING)

        // then
        expect(written).toEqual([])
    })
})
