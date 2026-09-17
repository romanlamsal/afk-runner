import type { AgentRunner } from "../domain/agent.ts"
import { ticketBranch } from "../domain/branches.ts"
import type { Clock } from "../domain/clock.ts"
import type { EventDetails, EventLog, Outcome } from "../domain/events.ts"
import type { Git } from "../domain/git.ts"
import { ticketOf } from "../domain/manifest.ts"
import { ticketWorktree, transcriptPath } from "../domain/paths.ts"
import { PROFILES } from "../domain/profiles.ts"
import { resolverPrompt } from "../domain/prompts.ts"
import { readResolutionNote, resolutionJsonSchema, resolverFault } from "../domain/resolution.ts"
import type { PreparedRun } from "../domain/run.ts"
import { attemptWithAgent, type StepResult } from "./attempt.ts"

/** The conflict resolver's one pass at the rebase git stopped part-way. */
export type ResolveTicket = (run: PreparedRun, action: { ticket: number; attempt: number }) => Promise<StepResult>

export type ResolveDeps = {
    agent: AgentRunner
    events: EventLog
    git: Git
    now: Clock
}

/**
 * One step, two events, and an agent that is only ever sent where git said there is a conflict: the
 * decision function gives this out of a `rebase: conflicted` and out of nothing else, so the
 * resolver is never handed a worktree it has no move in (ADR-0025, ADR-0026).
 *
 * It runs in the ticket's own worktree, because that is where the rebase is and where the branch is
 * checked out — a resolver with a worktree of its own is a path that could never work (ADR-0005).
 *
 * The one rule the script keeps for itself is the abort. The resolver is told never to abort, and
 * this is what happens when it does anyway or gets nowhere: afk aborts, records `resolve: failed`
 * and leaves the spec branch exactly as it found it. What that failure is worth is the decision
 * function's, and it spends the **rebase's** budget: being a separate action does not make it a
 * separate trip through the merge track (ADR-0026).
 */
export const createResolveService =
    ({ agent, events, git, now }: ResolveDeps): ResolveTicket =>
    async (run, { ticket, attempt }) => {
        const { root, spec, manifest } = run
        const listed = ticketOf(manifest, spec, ticket)
        if (!listed.ok) {
            return { outcome: "halted", reason: listed.reason }
        }

        const branch = ticketBranch(spec, ticket)
        const worktree = ticketWorktree(spec, ticket)

        const record = (outcome: Outcome, details: EventDetails = {}): Promise<void> =>
            events.append(root, spec, { ...details, ticket, step: "resolve", outcome, at: now().toISOString() })

        /**
         * The end of a rebase the resolver did not land. The abort is asked for unconditionally
         * because it is a no-op where there is nothing to abort, and because every other way of
         * deciding whether to abort is a second reading of a tree that has already moved.
         */
        const abandon = async (detail: string, details: EventDetails): Promise<StepResult> => {
            const aborted = await git.abortRebase(root, worktree)
            const reported = aborted.ok ? detail : `${detail}, and the rebase could not be aborted: ${aborted.reason}`
            await record("failed", { ...details, detail: reported })
            return { outcome: "failed" }
        }

        const transcript = transcriptPath(spec, `t${ticket}-resolve-${attempt}`, now())

        const attempted = await attemptWithAgent(
            agent,
            {
                prompt: resolverPrompt({
                    spec,
                    ticket,
                    title: listed.ticket.title,
                    branch,
                    onto: run.branch,
                    verify: manifest.verify,
                }),
                root,
                cwd: worktree,
                transcriptPath: transcript,
                resumeSessionId: undefined,
                outputSchema: resolutionJsonSchema(),
                profile: PROFILES.resolver,
            },
            sessionId => record("running", { sessionId, transcriptPath: transcript }),
        )
        const { sessionId, usage } = attempted
        const details: EventDetails = { sessionId, transcriptPath: transcript, usage }

        if (attempted.outcome === "failed") {
            return abandon(`the conflict resolver for #${ticket} failed: ${attempted.detail}`, details)
        }

        // Where the branches stand, which is the only kind of question afk asks of git. The spec
        // branch has not moved while the resolver worked — the merge track is serial and the gate
        // worktree is the branch's only writer (ADR-0006).
        const tip = await git.revision(root, run.branch)
        const landed = await git.revision(root, branch)
        const fault = resolverFault({
            conflicted: await git.conflicted(root, worktree),
            onTip: tip !== undefined && (await git.contains(root, { rev: branch, commit: tip })),
            ahead: landed !== undefined && landed !== tip,
        })
        if (fault !== undefined) {
            return abandon(fault, details)
        }

        // The note is kept as this event's detail, which is where the squash body reads it from: the
        // reasoning belongs to the commit that lands this ticket, not to a log nobody opens. A
        // resolver that reported none leaves none, rather than a sentence afk made up (ADR-0007).
        await record("ok", { ...details, detail: readResolutionNote(attempted.structuredOutput) })
        return { outcome: "ok" }
    }
