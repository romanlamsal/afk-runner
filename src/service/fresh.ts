import { specBranch, specBranchPrefix } from "../domain/branches.ts"
import type { Git } from "../domain/git.ts"
import { type Holder, type RunLock, refusalToShare } from "../domain/lock.ts"
import { runDirectory } from "../domain/paths.ts"
import type { RunRecordStore } from "../domain/records.ts"
import type { Tracker } from "../domain/tracker.ts"
import type { TakeOver } from "./takeover.ts"

export type FreshResult =
    /** Nothing of this spec's run is left. `pullRequest` is whether there was one to close. */
    | { outcome: "cleared"; pullRequest: boolean }
    /** Something would not go. Nothing after it was attempted, and the operator is told which. */
    | { outcome: "failed"; reason: string }

/** The driving port: throw one spec's run away, so that the next invocation starts from nothing. */
export type StartFresh = (spec: number) => Promise<FreshResult>

export type FreshDeps = {
    /** Where afk was invoked. The target repository is this directory's git top level. */
    cwd: string
    git: Git
    /** Starting over is the most destructive thing afk does, so it never happens under a live run. */
    lock: RunLock
    /** This process, as the lock names it. */
    self: Holder
    records: RunRecordStore
    tracker: Tracker
    /** The takeover service's driving port: a live holder is an offer on a terminal (ADR-0035). */
    takeOver: TakeOver
}

const failed = (reason: string): FreshResult => ({ outcome: "failed", reason })

/**
 * Starting over. The flag is the consent, so nothing here asks — but nothing here guesses either:
 * every step names what it removes, and a step that fails stops the ones after it rather than
 * reporting a clean slate over a repository that still holds half a run.
 *
 * The order is not arbitrary. Worktrees go first, because git refuses to delete a branch one still
 * has checked out. The pull request is closed before its head branch is deleted: deleting the head
 * closes the pull request behind afk's back, which would leave afk reporting there was none. And
 * the run directory goes last, after everything that can be retried: it holds the event log and
 * every transcript, and a run thrown half away by an unauthenticated `gh` should still be a run
 * somebody can read.
 *
 * That the worktrees go before the directory holding them is the one ordering the ticket states
 * outright: a worktree whose directory vanishes stays registered in the repository afk was invoked
 * against, which is exactly the leak this flag exists to clean up.
 *
 * One thing is never undone: a claim. An unassigned ticket looks unattempted, and what the operator
 * wants to find afterwards is the record that it was tried (ADR-0013).
 */
export const createFreshService =
    ({ cwd, git, lock, self, records, tracker, takeOver }: FreshDeps): StartFresh =>
    async spec => {
        const root = await git.topLevel(cwd)
        if (root === undefined) {
            return failed("this is not a git worktree: run afk from inside the repository whose spec this is")
        }

        // Taken before the first thing goes, and gone with the run directory at the end: what starts
        // next in this process takes it again (ADR-0036).
        const acquired = await lock.acquire(root, spec, self)
        if (!acquired.ok) {
            const taken = await takeOver(root, spec, acquired.holder)
            if (taken.outcome === "refused") {
                return failed(taken.reason)
            }

            // Asked again rather than assumed: a third afk may have taken what the holder let go of.
            const retaken = await lock.acquire(root, spec, self)
            if (!retaken.ok) {
                return failed(refusalToShare(spec, retaken.holder))
            }
        }

        const worktrees = await git.removeWorktreesUnder(root, runDirectory(spec))
        if (!worktrees.ok) {
            return failed(`the run's worktrees could not be removed: ${worktrees.reason}`)
        }

        const branch = specBranch(spec)
        const closed = await tracker.closePullRequest(root, branch)
        if (!closed.ok) {
            return failed(`the pull request for ${branch} could not be closed: ${closed.reason}`)
        }

        const prefix = specBranchPrefix(spec)
        const local = await git.deleteBranchesUnder(root, prefix)
        if (!local.ok) {
            return failed(`this spec's branches could not be deleted: ${local.reason}`)
        }

        const remote = await git.deleteRemoteBranchesUnder(root, prefix)
        if (!remote.ok) {
            return failed(`this spec's branches could not be deleted on the remote: ${remote.reason}`)
        }

        const directory = await records.remove(root, spec)
        if (!directory.ok) {
            return failed(`${runDirectory(spec)} could not be removed: ${directory.reason}`)
        }

        return { outcome: "cleared", pullRequest: closed.closed }
    }
