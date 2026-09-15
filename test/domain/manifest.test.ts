import { describe, expect, it } from "vitest"
import { manifestJsonSchema, readPlannedManifest } from "../../src/domain/manifest.ts"

const planned = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    spec: 4,
    setup: "npm ci",
    verify: "npm run check",
    tickets: [
        { number: 5, title: "Plan a spec", blockedBy: [] },
        { number: 6, title: "Prepare a run", blockedBy: [5] },
    ],
    ...overrides,
})

describe("readPlannedManifest", () => {
    it("should accept what the planner emitted for the spec it was asked about", () => {
        // given
        const raw = planned()

        // when
        const result = readPlannedManifest(raw, 4)

        // then
        expect(result).toEqual({ ok: true, manifest: raw })
    })

    it.each([
        ["nothing at all", undefined],
        ["a manifest with no tickets", planned({ tickets: [] })],
        ["a manifest with no setup command", planned({ setup: "" })],
        ["a manifest with no verify command", planned({ verify: "" })],
        ["a ticket with no title", planned({ tickets: [{ number: 5, title: "", blockedBy: [] }] })],
        ["a ticket that is not an issue number", planned({ tickets: [{ number: 0, title: "x", blockedBy: [] }] })],
        ["a ticket missing its blocked-by", planned({ tickets: [{ number: 5, title: "x" }] })],
    ] as const)("should refuse %s", (_name, raw) => {
        // given — the planner output from the table

        // when
        const result = readPlannedManifest(raw, 4)

        // then
        expect(result).toEqual({ ok: false, reason: expect.stringContaining("manifest") })
    })

    it("should refuse a manifest planned for another spec", () => {
        // given
        const raw = planned({ spec: 9 })

        // when
        const result = readPlannedManifest(raw, 4)

        // then
        expect(result).toEqual({ ok: false, reason: expect.stringContaining("#9") })
    })

    it("should refuse the same ticket twice", () => {
        // given
        const raw = planned({
            tickets: [
                { number: 5, title: "Plan a spec", blockedBy: [] },
                { number: 5, title: "Plan a spec again", blockedBy: [] },
            ],
        })

        // when
        const result = readPlannedManifest(raw, 4)

        // then
        expect(result).toEqual({ ok: false, reason: expect.stringContaining("#5") })
    })

    it("should refuse a schedule that cannot start", () => {
        // given
        const raw = planned({
            tickets: [
                { number: 5, title: "Plan a spec", blockedBy: [6] },
                { number: 6, title: "Prepare a run", blockedBy: [5] },
            ],
        })

        // when
        const result = readPlannedManifest(raw, 4)

        // then
        expect(result).toEqual({ ok: false, reason: expect.stringContaining("blocked by each other") })
    })
})

describe("manifestJsonSchema", () => {
    it("should describe every field the manifest carries", () => {
        // given — the schema the planner is handed inline

        // when
        const schema = manifestJsonSchema()

        // then
        expect(Object.keys(schema.properties ?? {})).toEqual(["spec", "setup", "verify", "tickets"])
    })

    it("should carry no meta-schema reference, which the agent's validator rejects", () => {
        // given — the schema the planner is handed inline

        // when
        const schema = manifestJsonSchema()

        // then
        expect(schema).not.toHaveProperty("$schema")
    })
})
