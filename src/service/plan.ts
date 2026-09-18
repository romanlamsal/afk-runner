import type { AgentRunner } from "../domain/agent.ts"
import type { Clock } from "../domain/clock.ts"
import type { EventDetails, EventLog, Outcome } from "../domain/events.ts"
import type { Git } from "../domain/git.ts"
import { type Manifest, type ManifestStore, manifestJsonSchema, readPlannedManifest } from "../domain/manifest.ts"
import { transcriptPath } from "../domain/paths.ts"
import { PROFILES } from "../domain/profiles.ts"
import { plannerPrompt } from "../domain/prompts.ts"
import { attemptWithAgent } from "./attempt.ts"

/** The driving port: plan a spec in the target repository, leaving a manifest behind. */
export type PlanSpec = (root: string, spec: number, asked: { base: string | undefined }) => Promise<PlanResult>

export type PlanResult = { ok: true; manifest: Manifest } | { ok: false; reason: string }

export type PlanDeps = {
    agent: AgentRunner
    events: EventLog
    /** Read for one thing: what this spec is based on, where `--branch` did not say (ADR-0032). */
    git: Git
    manifests: ManifestStore
    now: Clock
}

/**
 * One action through a port and one write. Every rule it looks like it is applying — what a
 * manifest must be, what the planner is asked, where the transcript goes — is the domain's.
 *
 * Planning is where the base is decided, because it is where the manifest is made: the planner is
 * an agent and its output a claim (ADR-0003), so the one field afk states rather than believes is
 * written here, over whatever came back. Deciding it anywhere else would build the same manifest in
 * two places, and the two would drift (ADR-0032).
 *
 * It is resolved before the agent is spawned. A repository that names no base is a refusal the
 * operator can act on, and finding that out after a planner has run costs one for nothing.
 *
 * It does write to the log, as the `plan` step — a run-level one, so its events name no ticket, and
 * a log holding only these is not yet a run (ADR-0028).
 */
export const createPlanService =
    ({ agent, events, git, manifests, now }: PlanDeps): PlanSpec =>
    async (root, spec, asked) => {
        const transcript = transcriptPath(spec, "planner", now())

        const base = asked.base ?? (await git.defaultBase(root))
        if (base === undefined) {
            return {
                ok: false,
                reason:
                    "no branch to base this spec on: this repository has neither origin/HEAD nor a main branch. " +
                    "Name one with --branch",
            }
        }

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
        const recordFailure = async (reason: string): Promise<PlanResult> => {
            await record("failed", { sessionId, transcriptPath: transcript, usage, detail: reason })
            return { ok: false, reason }
        }

        if (attempt.outcome === "failed") {
            return recordFailure(`the planner failed: ${attempt.detail}`)
        }

        const read = readPlannedManifest(attempt.structuredOutput, spec)
        if (!read.ok) {
            return recordFailure(read.reason)
        }

        const manifest: Manifest = { ...read.manifest, base }
        await manifests.write(root, spec, manifest)
        await record("ok", { sessionId, transcriptPath: transcript, usage })
        return { ok: true, manifest }
    }
