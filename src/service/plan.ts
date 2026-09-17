import type { AgentRunner } from "../domain/agent.ts"
import type { Clock } from "../domain/clock.ts"
import type { EventDetails, EventLog, Outcome } from "../domain/events.ts"
import { type Manifest, type ManifestStore, manifestJsonSchema, readPlannedManifest } from "../domain/manifest.ts"
import { transcriptPath } from "../domain/paths.ts"
import { PROFILES } from "../domain/profiles.ts"
import { plannerPrompt } from "../domain/prompts.ts"
import { attemptWithAgent } from "./attempt.ts"

/** The driving port: plan a spec in the target repository, leaving a manifest behind. */
export type PlanSpec = (root: string, spec: number) => Promise<PlanResult>

export type PlanResult = { ok: true; manifest: Manifest } | { ok: false; reason: string }

export type PlanDeps = {
    agent: AgentRunner
    events: EventLog
    manifests: ManifestStore
    now: Clock
}

/**
 * One action through a port and one write. Every rule it looks like it is applying — what a
 * manifest must be, what the planner is asked, where the transcript goes — is the domain's.
 *
 * Planning touches neither git nor the tracker: it reads the repository and returns a claim.
 *
 * It does write to the log, as the `plan` step — a run-level one, so its events name no ticket, and
 * a log holding only these is not yet a run (ADR-0028).
 */
export const createPlanService =
    ({ agent, events, manifests, now }: PlanDeps): PlanSpec =>
    async (root, spec) => {
        const transcript = transcriptPath(spec, "planner", now())

        const record = (outcome: Outcome, details: EventDetails = {}): Promise<void> =>
            events.append(root, spec, { step: "plan", outcome, at: now().toISOString(), ...details })

        const attempt = await attemptWithAgent(
            agent,
            {
                prompt: plannerPrompt(spec),
                root,
                cwd: ".",
                transcriptPath: transcript,
                resumeSessionId: undefined,
                outputSchema: manifestJsonSchema(),
                profile: PROFILES.planner,
            },
            sessionId => record("running", { sessionId, transcriptPath: transcript }),
        )
        const { sessionId, usage } = attempt

        /** The planner failing, or returning something a manifest cannot be read out of. */
        const failed = async (reason: string): Promise<PlanResult> => {
            await record("failed", { sessionId, transcriptPath: transcript, usage, detail: reason })
            return { ok: false, reason }
        }

        if (attempt.outcome === "failed") {
            return failed(`the planner failed: ${attempt.detail}`)
        }

        const read = readPlannedManifest(attempt.structuredOutput, spec)
        if (!read.ok) {
            return failed(read.reason)
        }

        await manifests.write(root, spec, read.manifest)
        await record("ok", { sessionId, transcriptPath: transcript, usage })
        return { ok: true, manifest: read.manifest }
    }
