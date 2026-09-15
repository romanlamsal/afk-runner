import { describe, expect, it } from "vitest"
import { progressOutput } from "../../src/cli/progress-output.ts"

describe("progressOutput", () => {
    it.each([
        [
            "only tickets an implementer got through",
            { implemented: [10, 11], failed: [], skipped: [] },
            ["implemented:  #10, #11"],
        ],
        [
            "what failed and what was skipped alongside it",
            { implemented: [10], failed: [11], skipped: [12] },
            ["implemented:  #10", "failed:       #11", "skipped:      #12"],
        ],
        ["nothing at all about a run that got nowhere", { implemented: [], failed: [], skipped: [] }, []],
    ] as const)("should report %s", (_name, progress, expected) => {
        // given — the progress from the table

        // when
        const lines = progressOutput(progress)

        // then
        expect(lines).toEqual(expected)
    })
})
