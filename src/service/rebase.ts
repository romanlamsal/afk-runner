import type { Clock } from "../domain/clock.ts"
import type { EventLog, Outcome } from "../domain/events.ts"
import type { Git } from "../domain/git.ts"
import { ticketOf } from "../domain/manifest.ts"
import { ticketWorktree } from "../domain/paths.ts"
import type { PreparedRun } from "../domain/run.ts"
import type { StepResult } from "./attempt.ts"

/** Put a ticket's work on the spec branch's tip, in that ticket's own worktree. */
export type RebaseTicket = (run: PreparedRun, action: { ticket: number }) => Promise<StepResult>

export type RebaseDeps = {
    events: EventLog
    git: Git
    now: Clock
}

/**
 * The head of the merge track, and one step: every ticket is rebased, always, without probing first
 * (ADR-0005). It ends at `rebase: ok`, at `rebase: conflicted` or at `rebase: failed`, and what each
 * of those is worth is the decision function's to say — a conflict is a state with a `resolve` out
 * of it, and nothing here calls an agent (ADR-0025, ADR-0026).
 *
 * The rebase happens in the ticket's **own** worktree: the branch is checked out there, and git will
 * not check one branch out twice. It is also the warm one, which is what lets the resolver that may
 * follow run the repository's checks on what it produced.
 *
 * The one rule the script keeps for itself is the abort. Where the rebase cannot go on, afk aborts
 * and leaves the spec branch exactly as it found it — no squash, no revert, no gate.
 */
export const createRebaseService =
    ({ events, git, now }: RebaseDeps): RebaseTicket =>
    async (run, { ticket }) => {
        const { root, spec, manifest } = run
        const listed = ticketOf(manifest, spec, ticket)
        if (!listed.ok) {
            return { outcome: "halted", reason: listed.reason }
        }

        const worktree = ticketWorktree(spec, ticket)

        const record = (outcome: Outcome, detail?: string): Promise<void> =>
            events.append(root, spec, { ticket, step: "rebase", outcome, at: now().toISOString(), detail })

        /**
         * The end of a rebase that did not land. The abort is asked for unconditionally because it
         * is a no-op where there is nothing to abort, and because every other way of deciding
         * whether to abort is a second reading of a tree that has already moved.
         */
        const abandon = async (detail: string): Promise<StepResult> => {
            const aborted = await git.abortRebase(root, worktree)
            const reported = aborted.ok ? detail : `${detail}, and the rebase could not be aborted: ${aborted.reason}`
            await record("failed", reported)
            return { outcome: "failed" }
        }

        await record("running")

        if (!(await git.isClean(root, worktree))) {
            return abandon(`the worktree for #${ticket} is not a clean checkout, and a rebase would bury what is in it`)
        }

        // Read before the rebase, so that a spec branch that names no commit is a repository fault
        // with its own words rather than something the resolver gets blamed for afterwards. Nothing
        // moves it in the meantime: the merge track is serial and the gate worktree is its only
        // writer (ADR-0006).
        if ((await git.revision(root, run.branch)) === undefined) {
            return abandon(`the spec branch ${run.branch} names no commit to rebase #${ticket} onto`)
        }

        const rebased = await git.rebase(root, { path: worktree, onto: run.branch })
        if (rebased.outcome === "failed") {
            return abandon(`#${ticket} could not be rebased onto ${run.branch}: ${rebased.reason}`)
        }
        if (rebased.outcome === "conflicted") {
            // A rebase git stopped part-way, written down as what git distinguished rather than as a
            // failure (ADR-0025). The step settled and the log says how: the resolve that comes out
            // of it is an action the decision function gives, mid-run and after a kill alike.
            await record("conflicted")
            return { outcome: "ok" }
        }

        await record("ok")
        return { outcome: "ok" }
    }
