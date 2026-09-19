import { describe, expect, it } from "vitest"
import { painted } from "../../src/cli/board-paint.ts"
import { type Line, plain, ROLES, type Role, widthOf } from "../../src/cli/board-span.ts"

/**
 * The palette, and no layout: every assertion here is a span and what a terminal makes of it. No
 * column, no padding and no row of the board appears in one, so that changing a colour breaks this
 * suite and changing the layout does not (ADR-0031).
 */

const span = (text: string, role: Role): Line => [{ text, role }]

/**
 * What a terminal is left with once the sequences are taken back out of a painted line: each part
 * after an escape begins with the sequence's parameters, and those are what is dropped.
 */
const stripped = (drawn: string): string =>
    drawn
        .split("\u001b")
        .map(part => part.replace(/^\[[0-9;]*m/, ""))
        .join("")

/** Every parameter a painted line asks the terminal for, sequence by sequence. */
const codesOf = (drawn: string): readonly string[] =>
    drawn.split("\u001b").flatMap(part => part.match(/^\[([0-9;]*)m/)?.[1]?.split(";") ?? [])

/**
 * The weight ladder the board is forbidden from reaching for. `2` is unrendered by some terminals
 * and `1` is a hue the colour scheme chooses rather than a weight, which is the whole of ADR-0033.
 */
const INTENSITIES: readonly string[] = ["1", "2"]

describe("painted", () => {
    it.each([
        ["a step still ahead", "ahead", "\u001b[90mtext\u001b[0m"],
        ["a step the log started and has not ended", "running", "\u001b[4mtext\u001b[0m"],
        ["a running step that has gone quiet", "quiet", "\u001b[4;33mtext\u001b[0m"],
        ["a settled conflicted step", "conflicted", "\u001b[33mtext\u001b[0m"],
        ["a settled failed step", "failed", "\u001b[31mtext\u001b[0m"],
        ["a skipped ticket's verdict", "skipped", "\u001b[33mtext\u001b[0m"],
        ["a verified ticket's verdict", "verified", "\u001b[32mtext\u001b[0m"],
    ] as const)("should write %s as what its role is", (_case, role, expected) => {
        // given
        const line = span("text", role)

        // when
        const drawn = painted(line)

        // then
        expect(drawn).toBe(expected)
    })

    it.each(ROLES.map(role => [role] as const))("should carry %s without asking for an intensity", role => {
        // given
        const line = span("text", role)

        // when
        const drawn = painted(line)

        // then
        expect(codesOf(drawn).filter(code => INTENSITIES.includes(code))).toEqual([])
    })

    it("should leave a span with nothing to say as the text it is", () => {
        // given
        const line: Line = [plain("one"), plain("two")]

        // when
        const drawn = painted(line)

        // then
        expect(drawn).toBe("onetwo")
    })

    it("should cost a line none of its width", () => {
        // given
        const line: Line = [plain("one"), { text: "two", role: "verified" }, ...span("three", "ahead")]

        // when
        const drawn = painted(line)

        // then
        expect(stripped(drawn)).toHaveLength(widthOf(line))
    })

    it("should write nothing for a span that carries no text", () => {
        // given
        const line = span("", "running")

        // when
        const drawn = painted(line)

        // then
        expect(drawn).toBe("")
    })
})
