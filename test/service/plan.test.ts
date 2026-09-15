import { describe, expect, it } from "vitest"
import type { AgentResult } from "../../src/domain/agent.ts"
import { type Manifest, manifestJsonSchema } from "../../src/domain/manifest.ts"
import { createPlanService, type PlanSpec } from "../../src/service/plan.ts"
import { createFakeAgent, type FakeAgent } from "../fakes/agent.ts"
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

type Harness = { plan: PlanSpec; agent: FakeAgent; manifests: FakeManifestStore }

const harness = (reply: Partial<AgentResult> = { structuredOutput: MANIFEST }): Harness => {
    const agent = createFakeAgent(reply)
    const manifests = createFakeManifestStore()
    return {
        agent,
        manifests,
        plan: createPlanService({ agent: agent.run, manifests: manifests.store, now: () => AT }),
    }
}

describe("createPlanService", () => {
    it("should return the manifest the planner emitted", async () => {
        // given
        const { plan } = harness()

        // when
        const result = await plan(ROOT, 4)

        // then
        expect(result).toEqual({ ok: true, manifest: MANIFEST })
    })

    it("should write the manifest it accepted", async () => {
        // given
        const { plan, manifests } = harness()

        // when
        await plan(ROOT, 4)

        // then
        expect(manifests.written).toEqual([{ root: ROOT, spec: 4, manifest: MANIFEST }])
    })

    it("should hand the planner the manifest schema, generated at runtime", async () => {
        // given
        const { plan, agent } = harness()

        // when
        await plan(ROOT, 4)

        // then
        expect(agent.invocations[0]?.outputSchema).toEqual(manifestJsonSchema())
    })

    it("should run the planner in the target repository", async () => {
        // given
        const { plan, agent } = harness()

        // when
        await plan(ROOT, 4)

        // then
        expect(agent.invocations[0]?.root).toBe(ROOT)
    })

    it("should give the attempt its own transcript", async () => {
        // given
        const { plan, agent } = harness()

        // when
        await plan(ROOT, 4)

        // then
        expect(agent.invocations[0]?.transcriptPath).toBe(".afk/4/transcripts/20260915T111838314Z-planner.jsonl")
    })

    it("should ask for no session to be resumed, having observed none", async () => {
        // given
        const { plan, agent } = harness()

        // when
        await plan(ROOT, 4)

        // then
        expect(agent.invocations[0]?.resumeSessionId).toBeUndefined()
    })

    it("should fail when the planner failed", async () => {
        // given
        const { plan } = harness({ outcome: "failed", detail: "timed out after 60m" })

        // when
        const result = await plan(ROOT, 4)

        // then
        expect(result).toEqual({ ok: false, reason: expect.stringContaining("timed out after 60m") })
    })

    it("should fail when the planner emitted something that is not a manifest", async () => {
        // given
        const { plan } = harness({ structuredOutput: { spec: 4 } })

        // when
        const result = await plan(ROOT, 4)

        // then
        expect(result).toEqual({ ok: false, reason: expect.stringContaining("manifest") })
    })

    it("should write nothing when it refused the planner's output", async () => {
        // given
        const { plan, manifests } = harness({ structuredOutput: { spec: 4 } })

        // when
        await plan(ROOT, 4)

        // then
        expect(manifests.written).toEqual([])
    })
})
