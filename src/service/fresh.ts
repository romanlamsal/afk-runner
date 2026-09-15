import { specBranch, specBranchPrefix } from "../domain/branches.ts"
import type { Git } from "../domain/git.ts"
import { runDirectory } from "../domain/paths.ts"
import type { RunRecordStore } from "../domain/records.ts"
import type { Tracker } from "../domain/tracker.ts"

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
    records: RunRecordStore
    tracker: Tracker
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
    ({ cwd, git, records, tracker }: FreshDeps): StartFresh =>
    async spec => {
        const root = await git.topLevel(cwd)
        if (root === undefined) {
            return failed("this is not a git worktree: run afk from inside the repository whose spec this is")
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
