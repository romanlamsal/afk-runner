import { describe, expect, it } from "vitest"
import { freshOutput } from "../../src/cli/fresh-output.ts"

describe("freshOutput", () => {
    it.each([
        ["what went", "spec #4: branches deleted, .afk/4 cleared, claims left alone"],
        ["what stayed, because a claim surviving is a decision", "claims left alone"],
    ] as const)("should say %s", (_what, said) => {
        // given
        const cleared = { pullRequest: false }

        // when
        const lines = freshOutput(4, cleared)

        // then
        expect(lines.join("\n")).toContain(said)
    })

    it("should say the pull request is closed when there was one to close", () => {
        // given
        const cleared = { pullRequest: true }

        // when
        const lines = freshOutput(4, cleared)

        // then
        expect(lines).toContain("spec #4: its pull request is closed")
    })

    it("should say nothing about a pull request there never was", () => {
        // given
        const cleared = { pullRequest: false }

        // when
        const lines = freshOutput(4, cleared)

        // then
        expect(lines).toHaveLength(1)
    })
})
