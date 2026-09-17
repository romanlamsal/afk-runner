import { describe, expect, it } from "vitest"
import { planOutput } from "../../src/cli/plan-output.ts"
import type { Manifest } from "../../src/domain/manifest.ts"

const MANIFEST: Manifest = {
    spec: 4,
    setup: "npm ci",
    verify: "npm run check",
    tickets: [
        { number: 5, title: "Plan a spec", blockedBy: [] },
        { number: 6, title: "Prepare a run", blockedBy: [5] },
        { number: 7, title: "Implement the slate", blockedBy: [6] },
        { number: 15, title: "Documentation", blockedBy: [] },
    ],
}

describe("planOutput", () => {
    it("should name the spec, its tickets and the slots they run in", () => {
        // given
        const manifest = MANIFEST

        // when
        const lines = planOutput(manifest, 3)

        // then
        expect(lines[0]).toBe("spec #4: 4 tickets, 3 at a time")
    })

    it("should show the commands the planner derived", () => {
        // given
        const manifest = MANIFEST

        // when
        const lines = planOutput(manifest, 3)

        // then
        expect(lines).toEqual(expect.arrayContaining(["setup:  npm ci", "verify: npm run check"]))
    })

    it("should print the execution order, grouped by what runs at once", () => {
        // given
        const manifest = MANIFEST

        // when
        const lines = planOutput(manifest, 3)

        // then
        expect(lines.filter(line => line.startsWith(" "))).toEqual([
            "  1. #5 Plan a spec",
            "     #15 Documentation",
            "  2. #6 Prepare a run",
            "  3. #7 Implement the slate",
        ])
    })
})
