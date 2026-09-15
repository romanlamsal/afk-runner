import type { AgentRunner } from "../domain/agent.ts"
import { ticketBranch } from "../domain/branches.ts"
import type { Clock } from "../domain/clock.ts"
import type { EventLog, LifecycleEvent, Outcome, Step } from "../domain/events.ts"
import type { Git } from "../domain/git.ts"
import { ticketWorktree, transcriptPath } from "../domain/paths.ts"
import { resolverPrompt } from "../domain/prompts.ts"
import { readResolutionNote, resolutionJsonSchema, resolverFault } from "../domain/resolution.ts"
import type { PreparedRun } from "../domain/run.ts"
import { attemptWithAgent, type StepResult } from "./attempt.ts"

/** One ticket through the merge track: onto the spec branch's tip, conflicts and all. */
export type MergeTicket = (run: PreparedRun, action: { ticket: number; attempt: number }) => Promise<StepResult>

export type MergeDeps = {
    agent: AgentRunner
    events: EventLog
    git: Git
    now: Clock
}

/** Everything an event carries beyond what every event of this step carries. */
type Details = Pick<LifecycleEvent, "sessionId" | "transcriptPath" | "detail">

/**
 * Put a ticket on the spec branch's tip.
 *
 * Every ticket is rebased, always, and in the ticket's **own** worktree — the branch is checked out
 * there, and git will not check one branch out twice, so a resolver with a worktree of its own is a
 * path that could never work. It is also the warm one, which is what lets the resolver run the
 * repository's checks on what it produced (ADR-0005).
 *
 * The one rule the script keeps for itself is the abort. The resolver is told never to abort, and
 * this is what happens when it does anyway or gets nowhere: afk aborts, fails the ticket, and
 * leaves the spec branch exactly as it found it — no revert, no gate.
 */
export const createMergeService =
    ({ agent, events, git, now }: MergeDeps): MergeTicket =>
    async (run, { ticket, attempt }) => {
        const { root, spec, manifest } = run
        const listed = manifest.tickets.find(one => one.number === ticket)
        if (listed === undefined) {
            return { outcome: "halted", reason: `#${ticket} is not a ticket of spec #${spec}` }
        }

        const branch = ticketBranch(spec, ticket)
        const worktree = ticketWorktree(spec, ticket)

        const record = (step: Step, outcome: Outcome, details: Details = {}): Promise<void> =>
            events.append(root, spec, { ticket, step, outcome, at: now().toISOString(), ...details })

        /**
         * The end of a rebase that did not land. The abort is asked for unconditionally because it
         * is a no-op where there is nothing to abort, and because every other way of deciding
         * whether to abort is a second reading of a tree that has already moved.
         */
        const abandon = async (detail: string): Promise<StepResult> => {
            const aborted = await git.abortRebase(root, worktree)
            const said = aborted.ok ? detail : `${detail}, and the rebase could not be aborted: ${aborted.reason}`
            await record("rebase", "failed", { detail: said })
            return { outcome: "failed" }
        }

        await record("rebase", "running")

        if (!(await git.isClean(root, worktree))) {
            return abandon(`the worktree for #${ticket} is not a clean checkout, and a rebase would bury what is in it`)
        }

        // Read before the rebase, so that a spec branch that names no commit is a repository fault
        // with its own words rather than something the resolver gets blamed for afterwards. Nothing
        // moves it in the meantime: the merge track is serial and the gate worktree is its only
        // writer (ADR-0006).
        const tip = await git.revision(root, run.branch)
        if (tip === undefined) {
            return abandon(`the spec branch ${run.branch} names no commit to rebase #${ticket} onto`)
        }

        const rebased = await git.rebase(root, { path: worktree, onto: run.branch })
        if (rebased.outcome === "failed") {
            return abandon(`#${ticket} could not be rebased onto ${run.branch}: ${rebased.reason}`)
        }
        if (rebased.outcome === "landed") {
            await record("rebase", "ok")
            return { outcome: "ok" }
        }

        const transcript = transcriptPath(spec, `t${ticket}-resolve-${attempt}`, now())

        const attempted = await attemptWithAgent(
            agent,
            {
                prompt: resolverPrompt({
                    spec,
                    ticket,
                    title: listed.title,
                    branch,
                    onto: run.branch,
                    verify: manifest.verify,
                }),
                root,
                cwd: worktree,
                transcriptPath: transcript,
                resumeSessionId: undefined,
                outputSchema: resolutionJsonSchema(),
            },
            sessionId => record("resolve", "running", { sessionId, transcriptPath: transcript }),
        )
        const { sessionId } = attempted

        if (attempted.outcome === "failed") {
            await record("resolve", "failed", { sessionId, transcriptPath: transcript, detail: attempted.detail })
            return abandon(`the conflict resolver for #${ticket} failed: ${attempted.detail}`)
        }

        const landed = await git.revision(root, branch)
        const fault = resolverFault({
            conflicted: await git.conflicted(root, worktree),
            onTip: await git.contains(root, { rev: branch, commit: tip }),
            ahead: landed !== undefined && landed !== tip,
        })
        if (fault !== undefined) {
            await record("resolve", "failed", { sessionId, transcriptPath: transcript, detail: fault })
            return abandon(fault)
        }

        // The note is kept as the resolve event's detail, which is where the squash body reads it
        // from: the reasoning belongs to the commit that lands this ticket, not to a log nobody
        // opens. A resolver that reported none leaves none, rather than a sentence afk made up.
        await record("resolve", "ok", {
            sessionId,
            transcriptPath: transcript,
            detail: readResolutionNote(attempted.structuredOutput),
        })
        await record("rebase", "ok")
        return { outcome: "ok" }
    }
