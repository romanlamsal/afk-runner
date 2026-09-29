import { describe, expect, it } from "vitest"
import { createLineBoard, createTerminalBoard } from "../../src/cli/board-writer.ts"
import type { BoardRow, BoardView } from "../../src/domain/board.ts"

/**
 * The writer's own rules and none of the frame's: how far it rewinds before it draws again, that a
 * terminal which went away cannot fail a run, and that a notice arriving out of the loop's turn — a
 * signal handler is the caller — reaches the screen at once and stays on the frames after it
 * (ADR-0029). What a frame is made of is the frame's, and it is asserted there.
 */

/** Where a frame begins and ends: synchronized output, so the terminal shows it at once or not yet. */
const BEGIN = "\u001b[?2026h"
const END = "\u001b[?2026l"

/** What a line is written with after its text: cleared to its end, never cleared before it. */
const CLEAR_TO_END = "\u001b[K"

/** What clears a whole line, which a frame never does before writing it. */
const CLEAR_LINE = "\u001b[2K"

/** What clears everything below the cursor, once a frame's lines are down. */
const ERASE_DOWN = "\u001b[J"

/** Cursor up by that many lines. */
const up = (lines: number): string => `\u001b[${lines}A`

/** Cursor up, by however many lines. */
const UP = new RegExp(String.raw`\u001b\[\d+A`)

const ROW: BoardRow = {
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
    quiet: false,
    blockedBy: [],
}

const VIEW: BoardView = { at: "2026-09-15T11:18:38.314Z", rows: [ROW] }

const DRAINING = "afk: interrupted — starting nothing new"

/** Thirteen tickets, which is the spec whose board leaked into scrollback (#66). */
const TALL: BoardView = {
    at: VIEW.at,
    rows: Array.from({ length: 13 }, (_, index) => ({ ...ROW, ticket: 21 + index })),
}

/** A frame's lines, with the synchronized-output wrapping and the trailing erase taken off. */
const linesOf = (chunk: string | undefined): readonly string[] =>
    (chunk ?? "").replace(BEGIN, "").replace(END, "").split("\n").slice(0, -1)

const harness = ({ rows = 40, columns = 80 }: { rows?: number; columns?: number } = {}) => {
    const written: string[] = []
    return {
        written,
        board: createTerminalBoard({ write: chunk => written.push(chunk), columns: () => columns, rows: () => rows }),
    }
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
        const drawn = linesOf(written.at(-1)).length

        // when
        board.show(VIEW)

        // then
        expect(written.at(-1)?.startsWith(`${BEGIN}${up(drawn)}`)).toBe(true)
    })

    it("should rewind over nothing before the first frame, where there is nothing drawn to rewind over", () => {
        // given
        const { written, board } = harness()

        // when
        board.show(VIEW)

        // then
        expect(written.at(-1)).not.toMatch(UP)
    })

    it("should draw no frame taller than one line fewer than the window, however often it redraws", () => {
        // given
        const { written, board } = harness({ rows: 13 })
        for (let frame = 0; frame < 20; frame++) {
            board.show(TALL)
        }

        // when
        board.show(TALL)

        // then
        expect(linesOf(written.at(-1)).length).toBeLessThanOrEqual(12)
    })

    it.each([
        ["begin", (chunk: string) => chunk.startsWith(BEGIN)],
        ["end", (chunk: string) => chunk.endsWith(END)],
    ] as const)("should %s every frame's synchronized output", (_, wrapping) => {
        // given
        const { written, board } = harness()

        // when
        board.show(VIEW)

        // then
        expect(wrapping(written.at(-1) ?? "")).toBe(true)
    })

    it("should overwrite each line and then clear it to its end", () => {
        // given
        const { written, board } = harness()
        board.show(TALL)

        // when
        board.show(TALL)

        // then
        expect(linesOf(written.at(-1)).every(line => line.endsWith(CLEAR_TO_END))).toBe(true)
    })

    it("should never clear a line before it is written", () => {
        // given
        const { written, board } = harness()
        board.show(TALL)

        // when
        board.show(TALL)

        // then
        expect(written.at(-1)).not.toContain(CLEAR_LINE)
    })

    it("should not clear after a line as wide as the terminal, whose last character it would erase", () => {
        // given
        const { written, board } = harness({ columns: 12 })

        // when
        board.show(VIEW)

        // then
        expect(linesOf(written.at(-1))[0]?.endsWith(CLEAR_TO_END)).toBe(false)
    })

    it("should erase what a taller last frame left below the new one", () => {
        // given
        const { written, board } = harness()
        board.show(TALL)

        // when
        board.show(VIEW)

        // then
        expect(written.at(-1)?.endsWith(`${ERASE_DOWN}${END}`)).toBe(true)
    })

    it("should swallow a write that fails, because a terminal that went away is not a run that failed", () => {
        // given
        const board = createTerminalBoard({
            write: () => {
                throw new Error("EPIPE")
            },
            columns: () => 80,
            rows: () => 40,
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
