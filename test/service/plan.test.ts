import { describe, expect, it } from "vitest"
import type { AgentResult } from "../../src/domain/agent.ts"
import { started } from "../../src/domain/events.ts"
import { type Manifest, manifestJsonSchema } from "../../src/domain/manifest.ts"
import { PROFILES } from "../../src/domain/profiles.ts"
import { createPlanService, type PlanSpec } from "../../src/service/plan.ts"
import { createFakeAgent, type FakeAgent } from "../fakes/agent.ts"
import { createFakeEventLog } from "../fakes/event-log.ts"
import { createFakeGit } from "../fakes/git.ts"
import { createFakeManifestStore, type FakeManifestStore } from "../fakes/manifest-store.ts"

const MANIFEST: Manifest = {
    spec: 4,
    setup: "npm ci",
    verify: "npm run check",
    tickets: [
        { number: 5, title: "Plan a spec", blockedBy: [] },
        { number: 6, title: "Prepare a run", blockedBy: [5] },
    ],
}

const AT = new Date("2026-09-15T11:18:38.314Z")

const ROOT = "/repo"

type Harness = {
    plan: PlanSpec
    agent: FakeAgent
    manifests: FakeManifestStore
    events: ReturnType<typeof createFakeEventLog>
}

const harness = (
    reply: Partial<AgentResult> = { structuredOutput: MANIFEST },
    repository: Parameters<typeof createFakeGit>[0] = {},
): Harness => {
    const agent = createFakeAgent(reply)
    const manifests = createFakeManifestStore()
    const events = createFakeEventLog()
    return {
        agent,
        manifests,
        events,
        plan: createPlanService({
            agent: agent.run,
            events: events.log,
            git: createFakeGit(repository).git,
            manifests: manifests.store,
            now: () => AT,
        }),
    }
}

describe("createPlanService", () => {
    it("should return the manifest the planner emitted", async () => {
        // given
        const { plan } = harness()

        // when
        const result = await plan(ROOT, 4, { base: undefined })

        // then
        expect(result).toEqual({ ok: true, manifest: { ...MANIFEST, base: "main" } })
    })

    it("should write the manifest it accepted", async () => {
        // given
        const { plan, manifests } = harness()

        // when
        await plan(ROOT, 4, { base: undefined })

        // then
        expect(manifests.written).toEqual([{ root: ROOT, spec: 4, manifest: { ...MANIFEST, base: "main" } }])
    })

    it("should hand the planner the manifest schema, generated at runtime", async () => {
        // given
        const { plan, agent } = harness()

        // when
        await plan(ROOT, 4, { base: undefined })

        // then
        expect(agent.invocations[0]?.outputSchema).toEqual(manifestJsonSchema())
    })

    it("should run the planner in the target repository", async () => {
        // given
        const { plan, agent } = harness()

        // when
        await plan(ROOT, 4, { base: undefined })

        // then
        expect(agent.invocations[0]?.root).toBe(ROOT)
    })

    it("should give the attempt its own transcript", async () => {
        // given
        const { plan, agent } = harness()

        // when
        await plan(ROOT, 4, { base: undefined })

        // then
        expect(agent.invocations[0]?.transcriptPath).toBe(".afk/4/transcripts/20260915T111838314Z-planner.jsonl")
    })

    it("should ask for no session to be resumed, having observed none", async () => {
        // given
        const { plan, agent } = harness()

        // when
        await plan(ROOT, 4, { base: undefined })

        // then
        expect(agent.invocations[0]?.resumeSessionId).toBeUndefined()
    })

    it("should fail when the planner failed", async () => {
        // given
        const { plan } = harness({ outcome: "failed", detail: "timed out after 60m" })

        // when
        const result = await plan(ROOT, 4, { base: undefined })

        // then
        expect(result).toEqual({ ok: false, reason: expect.stringContaining("timed out after 60m") })
    })

    it("should fail when the planner emitted something that is not a manifest", async () => {
        // given
        const { plan } = harness({ structuredOutput: { spec: 4 } })

        // when
        const result = await plan(ROOT, 4, { base: undefined })

        // then
        expect(result).toEqual({ ok: false, reason: expect.stringContaining("manifest") })
    })

    it("should write nothing when it refused the planner's output", async () => {
        // given
        const { plan, manifests } = harness({ structuredOutput: { spec: 4 } })

        // when
        await plan(ROOT, 4, { base: undefined })

        // then
        expect(manifests.written).toEqual([])
    })

    it("should invoke the planner at its own profile, and no other role's", async () => {
        // given
        const { plan, agent } = harness()

        // when
        await plan(ROOT, 4, { base: undefined })

        // then
        expect(agent.invocations.at(0)?.profile).toBe(PROFILES.planner)
    })
})

/**
 * The `plan` step. A run-level one, so its events name no ticket — and a log holding only these is
 * not yet a run, which is what keeps `--plan-only` then `--implement-only` from refusing itself
 * (ADR-0028).
 */
describe("createPlanService: the plan step", () => {
    it("should write one start event and one end event", async () => {
        // given
        const { plan, events } = harness()

        // when
        await plan(ROOT, 4, { base: undefined })

        // then
        expect(events.appended.map(event => `${event.step} ${event.outcome}`)).toEqual(["plan running", "plan ok"])
    })

    it("should name no ticket, the step being about the run", async () => {
        // given
        const { plan, events } = harness()

        // when
        await plan(ROOT, 4, { base: undefined })

        // then
        expect(events.appended.every(event => event.ticket === undefined)).toBe(true)
    })

    it("should leave a log that is not yet a run", async () => {
        // given
        const { plan, events } = harness()

        // when
        await plan(ROOT, 4, { base: undefined })

        // then
        expect(started(events.appended)).toBe(false)
    })

    it("should record what the planner consumed on the end event", async () => {
        // given
        const usage = { inputTokens: 434, outputTokens: 33, cacheReadInputTokens: 1500, cacheCreationInputTokens: 121 }
        const { plan, events } = harness({ structuredOutput: MANIFEST, usage })

        // when
        await plan(ROOT, 4, { base: undefined })

        // then
        expect(events.appended.at(-1)?.usage).toEqual(usage)
    })

    it("should record the planner's failure, and why", async () => {
        // given
        const { plan, events } = harness({ outcome: "failed", detail: "the session died" })

        // when
        await plan(ROOT, 4, { base: undefined })

        // then
        expect(events.appended.at(-1)).toMatchObject({
            outcome: "failed",
            detail: "the planner failed: the session died",
        })
    })

    it("should record a failure for output no manifest could be read out of", async () => {
        // given
        const { plan, events } = harness({ structuredOutput: { nonsense: true } })

        // when
        await plan(ROOT, 4, { base: undefined })

        // then
        expect(events.appended.at(-1)?.outcome).toBe("failed")
    })

    it("should record the branch it was asked to base the spec on", async () => {
        // given
        const { plan, manifests } = harness()

        // when
        await plan(ROOT, 4, { base: "release" })

        // then
        expect(manifests.written[0]?.manifest.base).toBe("release")
    })

    it("should record the repository's default branch where it was asked for none", async () => {
        // given
        const { plan, manifests } = harness()

        // when
        await plan(ROOT, 4, { base: undefined })

        // then
        expect(manifests.written[0]?.manifest.base).toBe("main")
    })

    it("should refuse when nothing was named and the repository has no default branch", async () => {
        // given
        const { plan } = harness({ structuredOutput: MANIFEST }, { defaultBase: undefined })

        // when
        const result = await plan(ROOT, 4, { base: undefined })

        // then
        expect(result).toEqual({ ok: false, reason: expect.stringContaining("no branch to base this spec on") })
    })

    it("should spawn no planner where there is no branch to base the spec on", async () => {
        // given
        const { plan, agent } = harness({ structuredOutput: MANIFEST }, { defaultBase: undefined })

        // when
        await plan(ROOT, 4, { base: undefined })

        // then
        expect(agent.invocations).toEqual([])
    })

    it("should overwrite a base the planner put in its own output", async () => {
        // given
        const { plan, manifests } = harness({ structuredOutput: { ...MANIFEST, base: "whatever-it-claimed" } })

        // when
        await plan(ROOT, 4, { base: "release" })

        // then
        expect(manifests.written[0]?.manifest.base).toBe("release")
    })
})
