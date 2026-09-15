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

export type SquashRequest = {
    /** The worktree whose branch receives the commit: the gate worktree, always (ADR-0006). */
    path: string
    /** The ticket branch being folded in, already rebased onto that branch's tip (ADR-0005). */
    branch: string
    /** The whole commit message, composed in the domain. */
    message: string
}

export type RevertRequest = {
    /** The worktree whose branch is put back: the gate worktree, always (ADR-0006). */
    path: string
    /**
     * The first commit to undo — the ticket's squash. Everything from it to the tip goes, which is
     * the squash and whatever the fix agent committed on top of it trying to save it.
     */
    from: string
    /** The whole commit message, composed in the domain. */
    message: string
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
    /**
     * Take a worktree away, freeing the branch it held. Asked once a ticket is verified: what is in
     * a verified ticket's worktree is on the spec branch, and a failed one's is kept (ADR-0012).
     */
    removeWorktree: (root: string, path: string) => Promise<GitResult>
    /**
     * Whether a worktree is registered at `path`. A git question rather than a filesystem one: a
     * worktree is a git object, and a directory git does not know about is not one.
     *
     * Asked before the prepare agent is sent anywhere, because a ticket whose worktree was never
     * made has nothing in it to prepare (ADR-0012).
     */
    hasWorktree: (root: string, path: string) => Promise<boolean>
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
    /**
     * The messages of the commits `rev` carries that `notIn` does not, oldest first. Two callers:
     * the squash body, which quotes the implementer's own messages, and the spec branch's log, which
     * is the cross-check for what landed (ADR-0011).
     *
     * Undefined when the range could not be read at all. A range that is genuinely empty is an empty
     * list, and the two must not be confused: one is a ticket with nothing new on it, the other is a
     * question git refused, and answering the second with the first composes an empty squash body
     * and a cross-check that says nothing landed.
     */
    log: (root: string, range: { rev: string; notIn: string }) => Promise<readonly string[] | undefined>
    /** Rebase the branch checked out at `path`, in that worktree and no other (ADR-0005). */
    rebase: (root: string, request: RebaseRequest) => Promise<RebaseResult>
    /**
     * Fold everything `branch` carries that the worktree at `path` does not into one commit on the
     * branch checked out there. It cannot conflict: the ticket was rebased onto that tip and nothing
     * can land in between, because the merge track is serial and single-writer (ADR-0006).
     */
    squashMerge: (root: string, request: SquashRequest) => Promise<GitResult>
    /**
     * Undo everything from `from` to the tip of the branch checked out at `path`, as **one revert
     * commit** — never a reset and a force-push. Append-only history is the only thing compatible
     * with a pool of worktrees sitting off the tip, and the revert pair vanishes in the spec PR's
     * squash anyway (ADR-0009).
     */
    revert: (root: string, request: RevertRequest) => Promise<GitResult>
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
