import { describe, expect, it } from "vitest"
import type { Mode } from "../../src/domain/mode.ts"
import { type Records, refusalToStart } from "../../src/domain/records.ts"

const records = (overrides: Partial<Records> = {}): Records => ({ manifest: false, started: false, ...overrides })

const refusal = (mode: Mode, present: Partial<Records> = {}, consented = false): string | undefined =>
    refusalToStart({ spec: 4, mode, records: records(present), consented })

describe("refusalToStart", () => {
    it.each([
        ["plan-and-implement", {}],
        ["plan-only", {}],
        ["implement-only", { manifest: true }],
    ] as const satisfies readonly (readonly [Mode, Partial<Records>])[])(
        "should let %s start against a repository with nothing in its way",
        (mode, present) => {
            // given — the records that mode expects to find, from the table above

            // when
            const refused = refusal(mode, present)

            // then
            expect(refused).toBeUndefined()
        },
    )

    it("should refuse a bare invocation when a manifest already exists, naming the mode that runs it", () => {
        // given
        const planned = { manifest: true }

        // when
        const refused = refusal("plan-and-implement", planned)

        // then
        expect(refused).toContain("--implement-only")
    })

    it("should refuse a bare invocation when a run already exists, naming the consent it needs", () => {
        // given
        const underWay = { manifest: true, started: true }

        // when
        const refused = refusal("plan-and-implement", underWay)

        // then
        expect(refused).toContain("--resume")
    })

    it("should let --plan-only replace a manifest a run is already using", () => {
        // given
        const underWay = { manifest: true, started: true }

        // when
        const refused = refusal("plan-only", underWay)

        // then
        expect(refused).toBeUndefined()
    })

    it("should refuse --implement-only when there is no manifest to implement", () => {
        // given
        const nothing = {}

        // when
        const refused = refusal("implement-only", nothing)

        // then
        expect(refused).toContain("no manifest to implement")
    })

    it("should refuse --implement-only against an existing run without consent", () => {
        // given
        const underWay = { manifest: true, started: true }

        // when
        const refused = refusal("implement-only", underWay)

        // then
        expect(refused).toContain("--resume")
    })

    it("should let --implement-only continue an existing run once consent was given", () => {
        // given
        const underWay = { manifest: true, started: true }

        // when
        const refused = refusal("implement-only", underWay, true)

        // then
        expect(refused).toBeUndefined()
    })
})
