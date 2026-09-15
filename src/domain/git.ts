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

/** What a git invocation that moves a ref came to. Nothing afk asks for goes unchecked (ADR-0005). */
export type GitResult = { ok: true } | { ok: false; reason: string }

export type RebaseRequest = {
    /** The worktree the branch is checked out in, relative to the repository root. */
    path: string
    /** What the branch is rebased onto: the spec branch, always at its tip (ADR-0005). */
    onto: string
}

export type RebaseResult =
    /** The branch's commits sit on the tip it was rebased onto. */
    | { outcome: "landed" }
    /** git stopped part-way: the rebase is in progress and the tree needs resolving. */
    | { outcome: "conflicted" }
    /** It never got as far as a conflict — there was nothing to rebase, or git refused. */
    | { outcome: "failed"; reason: string }

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
    checkoutWorktree: (root: string, request: WorktreeRequest) => Promise<GitResult>
    /** The commit `rev` names, or undefined when the repository has no such rev. */
    revision: (root: string, rev: string) => Promise<string | undefined>
    /**
     * Whether `commit` is an ancestor of `rev` — a question about where a branch is, which is the
     * only kind afk asks. Nothing measures what moved while an agent ran (ADR-0011).
     */
    contains: (root: string, query: { rev: string; commit: string }) => Promise<boolean>
    /**
     * Whether the worktree at `path` has nothing uncommitted in it. Asked before every rebase:
     * rebasing over uncommitted work buries it (ADR-0005).
     */
    isClean: (root: string, path: string) => Promise<boolean>
    /** Rebase the branch checked out at `path`, in that worktree and no other (ADR-0005). */
    rebase: (root: string, request: RebaseRequest) => Promise<RebaseResult>
    /**
     * Whether a rebase is still under way at `path` — paths git could not merge, or a rebase it was
     * never told to finish. This is what the script asks after the conflict resolver exits.
     */
    conflicted: (root: string, path: string) => Promise<boolean>
    /**
     * Put the worktree at `path` back on its branch. The resolver never aborts; the script does
     * (ADR-0005). Asking for one where there is no rebase is not a failure.
     */
    abortRebase: (root: string, path: string) => Promise<GitResult>
}
