import { describe, expect, it } from "vitest"
import { createLineBoard, createTerminalBoard } from "../../src/cli/board-writer.ts"
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
                { step: "implement", state: "running" },
            ],
            waiting: false,
            conclusion: undefined,
            detail: undefined,
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

/**
 * The line board keeps one thing of its own — the view it was last shown — and everything else
 * about it is `boardLines`, which is asserted as the mapping it is beside this.
 */
describe("createLineBoard", () => {
    const harness = () => {
        const printed: string[] = []
        return { printed, board: createLineBoard({ print: line => printed.push(line) }) }
    }

    const IMPLEMENTED: BoardView = {
        rows: VIEW.rows.map(row => ({
            ...row,
            steps: [
                { step: "setup", state: "settled", outcome: "ok" },
                { step: "implement", state: "settled", outcome: "ok" },
            ],
        })),
    }

    it("should print what the view it was last shown made news of", () => {
        // given
        const { printed, board } = harness()
        board.show(VIEW)

        // when
        board.show(IMPLEMENTED)

        // then
        expect(printed).toEqual(["#7 implement ok"])
    })

    it("should print nothing for a notice, which off a terminal keeps stderr", () => {
        // given
        const { printed, board } = harness()
        board.show(VIEW)

        // when
        board.notice(DRAINING)

        // then
        expect(printed).toEqual([])
    })
})
