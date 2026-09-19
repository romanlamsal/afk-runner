import { describe, expect, it } from "vitest"
import { createLineBoard, createTerminalBoard } from "../../src/cli/board-writer.ts"
import type { BoardView } from "../../src/domain/board.ts"

/**
 * The writer's own rules and none of the frame's: how far it rewinds before it draws again, that a
 * terminal which went away cannot fail a run, and that a notice arriving out of the loop's turn — a
 * signal handler is the caller — reaches the screen at once and stays on the frames after it
 * (ADR-0029). What a frame is made of is the frame's, and it is asserted there.
 */

/** Cursor up over one line and clear it, which is what rewinding over a drawn line costs. */
const REWIND = "\u001b[A\u001b[2K"

const VIEW: BoardView = {
    at: "2026-09-15T11:18:38.314Z",
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
            elapsed: undefined,
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

    it("should rewind over every line it last drew before it draws again", () => {
        // given
        const { written, board } = harness()
        board.show(VIEW)
        const drawn = written.at(-1)?.split("\n").length ?? 0

        // when
        board.show(VIEW)

        // then
        expect(written.at(-1)?.startsWith(REWIND.repeat(drawn - 1))).toBe(true)
    })

    it("should rewind over nothing before the first frame, where there is nothing drawn to rewind over", () => {
        // given
        const { written, board } = harness()

        // when
        board.show(VIEW)

        // then
        expect(written.at(-1)?.startsWith(REWIND)).toBe(false)
    })

    it("should swallow a write that fails, because a terminal that went away is not a run that failed", () => {
        // given
        const board = createTerminalBoard({
            write: () => {
                throw new Error("EPIPE")
            },
            columns: () => 80,
        })

        // when
        const drawing = () => board.show(VIEW)

        // then
        expect(drawing).not.toThrow()
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
        at: VIEW.at,
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
