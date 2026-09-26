import { describe, expect, it } from "vitest"
import { baseOf, type Manifest, manifestJsonSchema, readPlannedManifest } from "../../src/domain/manifest.ts"

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

describe("readPlannedManifest, with commands pinned", () => {
    it.each([
        [{ setup: "pnpm install" }, { setup: "pnpm install", verify: "npm run check" }],
        [{ verify: "pnpm check" }, { setup: "npm ci", verify: "pnpm check" }],
        [
            { setup: "pnpm install", verify: "pnpm check" },
            { setup: "pnpm install", verify: "pnpm check" },
        ],
    ] as const)("should carry %o over whatever the planner said", (pinned, commands) => {
        // given
        const raw = planned()

        // when
        const result = readPlannedManifest(raw, 4, pinned)

        // then
        expect(result).toEqual({ ok: true, manifest: { ...raw, ...commands } })
    })

    it("should accept a manifest missing the commands the planner was not asked for", () => {
        // given
        const { setup, verify, ...raw } = planned()

        // when
        const result = readPlannedManifest(raw, 4, { setup: "pnpm install", verify: "pnpm check" })

        // then
        expect(result).toEqual({ ok: true, manifest: { ...raw, setup: "pnpm install", verify: "pnpm check" } })
    })

    it("should still refuse a manifest missing a command that is not pinned", () => {
        // given
        const { verify, ...raw } = planned()

        // when
        const result = readPlannedManifest(raw, 4, { setup: "pnpm install" })

        // then
        expect(result).toEqual({ ok: false, reason: expect.stringContaining("verify") })
    })
})

describe("manifestJsonSchema", () => {
    it.each([
        [{ setup: "pnpm install" }, ["spec", "verify", "tickets"]],
        [{ verify: "pnpm check" }, ["spec", "setup", "tickets"]],
        [{ setup: "pnpm install", verify: "pnpm check" }, ["spec", "tickets"]],
    ] as const)("should not ask the planner for what %o pins", (pinned, fields) => {
        // given — the schema the planner is handed inline

        // when
        const schema = manifestJsonSchema(pinned)

        // then
        expect(Object.keys(schema.properties ?? {})).toEqual(fields)
    })

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

describe("baseOf", () => {
    const manifest: Manifest = {
        spec: 4,
        setup: "npm ci",
        verify: "npm run check",
        tickets: [{ number: 5, title: "Plan a spec", blockedBy: [] }],
    }

    it.each([
        [{ base: "release" }, "release"],
        [{ base: "main" }, "main"],
        [{}, "main"],
    ] as const)("should read %o as the branch the spec is based on", (carried, expected) => {
        // given
        const read: Manifest = { ...manifest, ...carried }

        // when
        const base = baseOf(read)

        // then
        expect(base).toBe(expected)
    })
})
