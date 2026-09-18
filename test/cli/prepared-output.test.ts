import { describe, expect, it } from "vitest"
import { preparedOutput } from "../../src/cli/prepared-output.ts"
import type { PreparedRun } from "../../src/domain/run.ts"

const RUN: PreparedRun = {
    root: "/repo",
    spec: 4,
    base: "main",
    branch: "afk/4/spec",
    gate: ".afk/4/gate",
    manifest: {
        spec: 4,
        setup: "npm ci",
        verify: "npm run check",
        tickets: [{ number: 5, title: "Plan a spec", blockedBy: [] }],
    },
}

describe("preparedOutput", () => {
    it("should say where the spec branch came from", () => {
        // given
        const run = RUN

        // when
        const lines = preparedOutput(run)

        // then
        expect(lines).toContain("spec #4: afk/4/spec cut from main")
    })

    it.each([["gate:   .afk/4/gate"], ["setup:  npm ci"], ["verify: npm run check"]] as const)(
        "should say %s",
        line => {
            // given
            const run = RUN

            // when
            const lines = preparedOutput(run)

            // then
            expect(lines).toContain(line)
        },
    )
})
