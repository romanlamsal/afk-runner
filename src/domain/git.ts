/**
 * The git port. afk reads the operator's repository and writes one branch through one worktree: it
 * never pulls, never moves trunk, and never touches the working tree (ADR-0018).
 */

export type TrunkState = {
    /** The local branch a spec branch is cut from. */
    branch: string
    /** Commits the local trunk has that its remote does not. */
    ahead: number
    /** Commits the remote trunk has that the local one does not. */
    behind: number
    /** Whether there was a remote to compare against at all. Without one, nothing is behind anything. */
    compared: boolean
    /** Uncommitted changes in the operator's working tree, which no implementer will see. */
    dirty: boolean
}

export type WorktreeRequest = {
    /** Where the worktree goes, relative to the repository root. */
    path: string
    branch: string
    /** What the branch is created from, and only when it does not exist yet. */
    startPoint: string
}

export type WorktreeResult = { ok: true } | { ok: false; reason: string }

export type Git = {
    /** The git top level of `cwd`, or undefined when `cwd` is not inside a worktree. */
    topLevel: (cwd: string) => Promise<string | undefined>
    /**
     * Trunk as it stands: its name, a read-only fetch of its remote, the comparison against it, and
     * whether the working tree is dirty. Undefined when the repository names no trunk to cut from.
     */
    inspectTrunk: (root: string) => Promise<TrunkState | undefined>
    /**
     * Check `branch` out at `path`, creating the branch from `startPoint` when it does not exist and
     * replacing whatever is at `path` — the gate worktree is re-created at every process start.
     */
    checkoutWorktree: (root: string, request: WorktreeRequest) => Promise<WorktreeResult>
    /** The commit `rev` names, or undefined when the repository has no such rev. */
    revision: (root: string, rev: string) => Promise<string | undefined>
    /**
     * Whether `commit` is an ancestor of `rev` — a question about where a branch is, which is the
     * only kind afk asks. Nothing measures what moved while an agent ran (ADR-0011).
     */
    contains: (root: string, query: { rev: string; commit: string }) => Promise<boolean>
}
