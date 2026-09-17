import type { AgentRunner } from "../domain/agent.ts"
import { ticketBranch } from "../domain/branches.ts"
import type { Clock } from "../domain/clock.ts"
import type { CommandRunner } from "../domain/commands.ts"
import type { CopyEnvironmentFiles } from "../domain/environment.ts"
import { type EventDetails, type EventLog, type Outcome, sessionOf } from "../domain/events.ts"
import type { Git } from "../domain/git.ts"
import { implementerFault } from "../domain/implementer.ts"
import { ticketOf } from "../domain/manifest.ts"
import { ticketWorktree, transcriptPath } from "../domain/paths.ts"
import { PROFILES } from "../domain/profiles.ts"
import { implementerPrompt } from "../domain/prompts.ts"
import type { PreparedRun } from "../domain/run.ts"
import type { Tracker } from "../domain/tracker.ts"
import { attemptWithAgent, type StepResult } from "./attempt.ts"

/** One ticket, from a worktree of its own to a settled lifecycle event. */
export type ImplementTicket = (run: PreparedRun, action: { ticket: number; attempt: number }) => Promise<StepResult>

export type ImplementDeps = {
    agent: AgentRunner
    /** The operator's own `setup`, run in the ticket's worktree before any agent is spawned. */
    commands: CommandRunner
    environment: CopyEnvironmentFiles
    events: EventLog
    git: Git
    now: Clock
    tracker: Tracker
}

/**
 * Give a ticket to an implementer: claim it, cut it a worktree, put the operator's environment and
 * dependencies in it, and let an agent commit on a branch of its own.
 *
 * Every rule it looks like it is applying is the domain's — what the implementer is asked, where
 * the worktree goes, what counts as work. What is here is the order the ports are called in.
 */
export const createImplementService =
    ({ agent, commands, environment, events, git, now, tracker }: ImplementDeps): ImplementTicket =>
    async (run, { ticket, attempt }) => {
        const { root, spec, manifest } = run
        const listed = ticketOf(manifest, spec, ticket)
        if (!listed.ok) {
            return { outcome: "halted", reason: listed.reason }
        }

        const branch = ticketBranch(spec, ticket)
        const worktree = ticketWorktree(spec, ticket)
        const transcript = transcriptPath(spec, `t${ticket}-implement-${attempt}`, now())

        const record = (outcome: Outcome, details: EventDetails = {}): Promise<void> =>
            events.append(root, spec, {
                ...details,
                ticket,
                step: "implement",
                outcome,
                at: now().toISOString(),
                transcriptPath: transcript,
            })

        // The claim is a collision guard and not bookkeeping, so it is made before anything is spent
        // on the ticket, and a refusal stops the run rather than this one step. It is never released:
        // an attempted-and-failed ticket should be findable, and an unassigned one looks untouched.
        const claim = await tracker.claim(root, ticket)
        if (!claim.ok) {
            return { outcome: "halted", reason: `ticket #${ticket} could not be claimed: ${claim.reason}` }
        }

        const baseSha = await git.revision(root, run.branch)

        /** A failure before the agent: the attempt still gets both its events. */
        const failed = async (detail: string): Promise<StepResult> => {
            await record("running", { baseSha })
            await record("failed", { baseSha, detail })
            return { outcome: "failed" }
        }

        if (baseSha === undefined) {
            return failed(`the spec branch ${run.branch} names no commit to cut a worktree from`)
        }

        const checkout = await git.checkoutWorktree(root, { path: worktree, branch, startPoint: baseSha })
        if (!checkout.ok) {
            return failed(`the worktree for #${ticket} could not be created: ${checkout.reason}`)
        }

        // Copied rather than symlinked, and before `setup`, which is the first thing that needs them.
        await environment(root, worktree)

        const prepared = await commands({ root, cwd: worktree, command: manifest.setup })
        if (!prepared.ok) {
            return failed(prepared.detail)
        }

        // The attempt a prepare pass bought continues the session the attempt before it was given,
        // and only where one was recorded: an id in the log was read out of a stream, so it is a
        // session that exists, and a first attempt has none to continue. afk never generates one
        // (ADR-0012, ADR-0017).
        const resumeSessionId =
            attempt === 1 ? undefined : sessionOf(await events.read(root, spec), ticket, "implement")

        const attempted = await attemptWithAgent(
            agent,
            {
                prompt: implementerPrompt({
                    spec,
                    ticket,
                    title: listed.ticket.title,
                    branch,
                    verify: manifest.verify,
                }),
                root,
                cwd: worktree,
                transcriptPath: transcript,
                resumeSessionId,
                outputSchema: undefined,
                profile: PROFILES.implementer,
            },
            sessionId => record("running", { sessionId, baseSha }),
        )
        const { sessionId, usage } = attempted

        if (attempted.outcome === "failed") {
            await record("failed", { sessionId, baseSha, usage, detail: attempted.detail })
            return { outcome: "failed" }
        }

        const tip = await git.revision(root, branch)
        const onBase = tip !== undefined && (await git.contains(root, { rev: branch, commit: baseSha }))
        const fault = implementerFault({ baseSha, tip, onBase })
        if (fault !== undefined) {
            await record("failed", { sessionId, baseSha, usage, detail: fault })
            return { outcome: "failed" }
        }

        await record("ok", { sessionId, baseSha, usage })
        return { outcome: "ok" }
    }
