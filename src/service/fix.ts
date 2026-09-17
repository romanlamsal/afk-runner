import type { AgentRunner } from "../domain/agent.ts"
import type { Clock } from "../domain/clock.ts"
import { type EventDetails, type EventLog, type Outcome, statusOf } from "../domain/events.ts"
import { fixerFault } from "../domain/fix.ts"
import type { Git } from "../domain/git.ts"
import { ticketOf } from "../domain/manifest.ts"
import { transcriptPath } from "../domain/paths.ts"
import { PROFILES } from "../domain/profiles.ts"
import { fixerPrompt } from "../domain/prompts.ts"
import type { PreparedRun } from "../domain/run.ts"
import { attemptWithAgent, type StepResult } from "./attempt.ts"

/** The one attempt a red gate is worth, spent in the gate worktree (ADR-0009). */
export type FixTicket = (run: PreparedRun, action: { ticket: number }) => Promise<StepResult>

export type FixDeps = {
    agent: AgentRunner
    events: EventLog
    git: Git
    now: Clock
}

/**
 * The fix agent's single attempt at a red gate, and nothing else: one step, two events, no sequence.
 * What follows it — the gate again, and the revert once this budget is spent — is the decision
 * function's, so that a run killed here resumes into the same sequence a live one would have
 * carried on with (ADR-0023).
 *
 * What is written down is what the attempt came to, never what it proved: a session that died after
 * committing a fix that works leaves a green branch, and the branch is what afk proves. That is why
 * this ends at `fix: ok` or `fix: failed` and the gate is what asks the question (ADR-0009).
 *
 * The attempt is one because the budget is one, counted off the `fix` start events this writes
 * (ADR-0022). There is no loop here to bound.
 */
export const createFixService =
    ({ agent, events, git, now }: FixDeps): FixTicket =>
    async (run, { ticket }) => {
        const { root, spec, manifest } = run
        const listed = ticketOf(manifest, spec, ticket)
        if (!listed.ok) {
            return { outcome: "halted", reason: listed.reason }
        }

        const record = (outcome: Outcome, details: EventDetails = {}): Promise<void> =>
            events.append(root, spec, { ...details, ticket, step: "fix", outcome, at: now().toISOString() })

        // The commit the ticket landed as is the spec branch's tip, because the merge track is
        // serial and the gate worktree is the branch's sole writer: nothing can have landed after
        // it (ADR-0006). It is read *now*, before the fix agent commits on top of it, and carried
        // by the start event so that the revert undoes the squash and the fix together even when a
        // different process is the one that performs it (ADR-0009).
        const landed = await git.revision(root, run.branch)

        // One attempt, and never a second, so the transcript is named for the only one there is.
        const transcript = transcriptPath(spec, `t${ticket}-fix-1`, now())
        const attempted = await attemptWithAgent(
            agent,
            {
                prompt: fixerPrompt({
                    spec,
                    ticket,
                    title: listed.ticket.title,
                    branch: run.branch,
                    verify: manifest.verify,
                    // What the gate said when it went red, quoted for the agent that has to
                    // reproduce it. It is read back off the log rather than carried along, and like
                    // every detail nothing branches on it.
                    detail: statusOf(await events.read(root, spec), ticket)?.detail,
                }),
                root,
                cwd: run.gate,
                transcriptPath: transcript,
                resumeSessionId: undefined,
                outputSchema: undefined,
                profile: PROFILES.fixer,
            },
            sessionId => record("running", { sessionId, baseSha: landed, transcriptPath: transcript }),
        )
        const { sessionId, usage } = attempted
        const details: EventDetails = { sessionId, transcriptPath: transcript, usage }

        /**
         * An attempt the agent itself reported as failed. It is not the question the gate asks, so
         * it is carried as words rather than branched on — and it reaches the log beside whatever
         * afk can see for itself about what was left behind (ADR-0009).
         */
        const failure =
            attempted.outcome === "failed" ? `the fix agent for #${ticket} failed: ${attempted.detail}` : undefined

        const fault = fixerFault({
            clean: await git.isClean(root, run.gate),
            moved: (await git.revision(root, run.branch)) !== landed,
        })
        const said = [failure, fault].filter(word => word !== undefined).join(", and ")
        if (said !== "") {
            await record("failed", { ...details, detail: said })
            return { outcome: "failed" }
        }

        await record("ok", details)
        return { outcome: "ok" }
    }
