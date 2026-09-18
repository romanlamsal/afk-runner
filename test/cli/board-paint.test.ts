import { describe, expect, it } from "vitest"
import { painted } from "../../src/cli/board-paint.ts"
import { type Hue, type Line, plain, type Tone, widthOf } from "../../src/cli/board-span.ts"

/**
 * The palette, and no layout: every assertion here is one span and what a terminal makes of it, so
 * that changing a colour breaks this suite and nothing else (ADR-0031).
 */

const span = (text: string, tone: Tone, hue?: Hue): Line => [hue === undefined ? { text, tone } : { text, tone, hue }]

/**
 * What a terminal is left with once the sequences are taken back out of a painted line: each part
 * after an escape begins with the sequence's parameters, and those are what is dropped.
 */
const stripped = (drawn: string): string =>
    drawn
        .split("\u001b")
        .map(part => part.replace(/^\[[0-9;]*m/, ""))
        .join("")

describe("painted", () => {
    it.each([
        ["a step still ahead", "dim", "\u001b[2msetup\u001b[0m"],
        ["a settled step", "normal", "setup"],
        ["a step that started and has not ended", "bright", "\u001b[1msetup\u001b[0m"],
    ] as const)("should write %s at its own weight", (_case, tone, expected) => {
        // given
        const line = span("setup", tone)

        // when
        const drawn = painted(line)

        // then
        expect(drawn).toBe(expected)
    })

    it.each([
        ["a settled conflicted step", "amber", "\u001b[33mresolve\u001b[0m"],
        ["a settled failed step", "red", "\u001b[31mresolve\u001b[0m"],
        ["a verified ticket's number", "green", "\u001b[32mresolve\u001b[0m"],
    ] as const)("should write %s in its own hue", (_case, hue, expected) => {
        // given
        const line = span("resolve", "normal", hue)

        // when
        const drawn = painted(line)

        // then
        expect(drawn).toBe(expected)
    })

    it("should carry a span's weight and its hue at once", () => {
        // given
        const line = span("revert", "dim", "red")

        // when
        const drawn = painted(line)

        // then
        expect(drawn).toBe("\u001b[2;31mrevert\u001b[0m")
    })

    it("should leave a span with nothing to say as the text it is", () => {
        // given
        const line: Line = [plain("  "), plain("#7")]

        // when
        const drawn = painted(line)

        // then
        expect(drawn).toBe("  #7")
    })

    it("should cost a line none of its width", () => {
        // given
        const line: Line = [
            plain("  "),
            { text: "#7", tone: "normal", hue: "green" },
            plain("  "),
            ...span("setup", "dim"),
        ]

        // when
        const drawn = painted(line)

        // then
        expect(stripped(drawn)).toHaveLength(widthOf(line))
    })

    it("should write nothing for a span that carries no text", () => {
        // given
        const line = span("", "bright")

        // when
        const drawn = painted(line)

        // then
        expect(drawn).toBe("")
    })
})
