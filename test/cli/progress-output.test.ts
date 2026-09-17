import { describe, expect, it } from "vitest"
import { progressOutput } from "../../src/cli/progress-output.ts"

describe("progressOutput", () => {
    it.each([
        [
            "only the tickets whose gate went green",
            { verified: [10, 11], unverified: [], failed: [], skipped: [] },
            ["verified:     #10, #11"],
        ],
        [
            "what failed and what was skipped alongside it",
            { verified: [10], unverified: [], failed: [11], skipped: [12] },
            ["verified:     #10", "failed:       #11", "skipped:      #12"],
        ],
        [
            "a ticket that got somewhere without being proven",
            { verified: [], unverified: [10], failed: [], skipped: [] },
            ["unverified:   #10"],
        ],
        ["nothing at all about a run that got nowhere", { verified: [], unverified: [], failed: [], skipped: [] }, []],
    ] as const)("should report %s", (_name, progress, expected) => {
        // given — the progress from the table

        // when
        const lines = progressOutput(progress)

        // then
        expect(lines).toEqual(expected)
    })
})
