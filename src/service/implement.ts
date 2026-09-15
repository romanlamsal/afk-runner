import type { AgentRunner } from "../domain/agent.ts"
import { ticketBranch } from "../domain/branches.ts"
import type { Clock } from "../domain/clock.ts"
import type { CommandRunner } from "../domain/commands.ts"
import type { CopyEnvironmentFiles } from "../domain/environment.ts"
import type { EventLog, LifecycleEvent, Outcome } from "../domain/events.ts"
import type { Git } from "../domain/git.ts"
import { implementerFault } from "../domain/implementer.ts"
import { ticketWorktree, transcriptPath } from "../domain/paths.ts"
import { implementerPrompt } from "../domain/prompts.ts"
import type { PreparedRun } from "../domain/run.ts"
import type { Tracker } from "../domain/tracker.ts"

/** One ticket, from a worktree of its own to a settled lifecycle event. */
export type ImplementTicket = (
    run: PreparedRun,
    action: { ticket: number; attempt: number },
) => Promise<ImplementResult>

export type ImplementResult =
    /** The step settled, for good or ill, and the log says which. */
    | { outcome: "ok" | "failed" }
    /** The run itself cannot continue. The driver drains and the process exits naming this. */
    | { outcome: "halted"; reason: string }

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

/** Everything an event carries beyond what every event of this step carries. */
type Details = Pick<LifecycleEvent, "sessionId" | "baseSha" | "detail">

/**
 * Give a ticket to an implementer: claim it, cut it a worktree, put the operator's environment and
 * dependencies in it, and let an agent commit on a branch of its own.
 *
 * Every rule it looks like it is applying is the domain's — what the implementer is asked, where
 * the worktree goes, what counts as work. What is here is the order the ports are called in, and
 * one property that is not a rule: **two events per attempt, a start and an end**, so that a run
 * killed mid-step leaves a record that the step began (ADR-0011).
 */
export const createImplementService =
    ({ agent, commands, environment, events, git, now, tracker }: ImplementDeps): ImplementTicket =>
    async (run, { ticket, attempt }) => {
        const { root, spec, manifest } = run
        const listed = manifest.tickets.find(one => one.number === ticket)
        if (listed === undefined) {
            return { outcome: "halted", reason: `#${ticket} is not a ticket of spec #${spec}` }
        }

        const branch = ticketBranch(spec, ticket)
        const worktree = ticketWorktree(spec, ticket)
        const transcript = transcriptPath(spec, `t${ticket}-implement-${attempt}`, now())

        const record = (outcome: Outcome, details: Details = {}): Promise<void> =>
            events.append(root, spec, {
                ticket,
                step: "implement",
                outcome,
                at: now().toISOString(),
                transcriptPath: transcript,
                ...details,
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
        const failed = async (detail: string): Promise<ImplementResult> => {
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

        let sessionId: string | undefined
        let started: Promise<void> | undefined

        const attempted = await agent({
            prompt: implementerPrompt({ spec, ticket, title: listed.title, branch, verify: manifest.verify }),
            root,
            cwd: worktree,
            transcriptPath: transcript,
            resumeSessionId: undefined,
            // The start event is written the moment the stream carries an id, which is before any
            // model work: what is recorded is a session that exists rather than one afk meant to
            // create (ADR-0017).
            onSessionId: observed => {
                sessionId = observed
                started = record("running", { sessionId: observed, baseSha })
            },
            outputSchema: undefined,
        })

        // A stream that carried no id never started, and the attempt still gets its start event.
        await (started ?? record("running", { baseSha }))

        if (attempted.outcome === "failed") {
            await record("failed", { sessionId, baseSha, detail: attempted.detail })
            return { outcome: "failed" }
        }

        const tip = await git.revision(root, branch)
        const onBase = tip !== undefined && (await git.contains(root, { rev: branch, commit: baseSha }))
        const fault = implementerFault({ baseSha, tip, onBase })
        if (fault !== undefined) {
            await record("failed", { sessionId, baseSha, detail: fault })
            return { outcome: "failed" }
        }

        await record("ok", { sessionId, baseSha })
        return { outcome: "ok" }
    }
