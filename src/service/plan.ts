import type { AgentRunner } from "../domain/agent.ts"
import type { Clock } from "../domain/clock.ts"
import { type Manifest, type ManifestStore, manifestJsonSchema, readPlannedManifest } from "../domain/manifest.ts"
import { transcriptPath } from "../domain/paths.ts"
import { plannerPrompt } from "../domain/prompts.ts"

/** The driving port: plan a spec, leaving a manifest behind. */
export type PlanSpec = (spec: number) => Promise<PlanResult>

export type PlanResult = { ok: true; manifest: Manifest } | { ok: false; reason: string }

export type PlanDeps = {
    agent: AgentRunner
    manifests: ManifestStore
    now: Clock
}

/**
 * One action through a port and one write. Every rule it looks like it is applying — what a
 * manifest must be, what the planner is asked, where the transcript goes — is the domain's.
 *
 * Planning touches neither git nor the tracker: it reads the repository and returns a claim.
 */
export const createPlanService =
    ({ agent, manifests, now }: PlanDeps): PlanSpec =>
    async spec => {
        const attempt = await agent({
            prompt: plannerPrompt(spec),
            cwd: ".",
            transcriptPath: transcriptPath(spec, "planner", now()),
            resumeSessionId: undefined,
            outputSchema: manifestJsonSchema(),
        })

        if (attempt.outcome === "failed") {
            return { ok: false, reason: `the planner failed: ${attempt.detail}` }
        }

        const read = readPlannedManifest(attempt.structuredOutput, spec)
        if (!read.ok) {
            return { ok: false, reason: read.reason }
        }

        await manifests.write(spec, read.manifest)
        return { ok: true, manifest: read.manifest }
    }
