import { access, rm } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import type { Git, GitResult, RebaseResult, TrunkState } from "../domain/git.ts"
import { type Ran, run } from "./process.ts"

/**
 * The git port, against the git binary.
 *
 * Every command here either reads, or writes the one branch afk owns through the one worktree that
 * owns it. The fetch is the only thing that reaches the network, and it moves nothing the operator
 * can see: it updates `FETCH_HEAD`, which is what the comparison reads, and leaves the local trunk
 * and the working tree exactly where they were (ADR-0018).
 */

/** afk compares against one remote. A repository with none is simply not compared. */
const REMOTE = "origin"

/** Where a repository with no `origin/HEAD` is looked for, in the order git itself would guess. */
const TRUNK_CANDIDATES = ["main", "master"] as const

const git = (cwd: string, ...args: string[]): Promise<Ran> => run("git", args, { cwd })

const hasBranch = async (root: string, branch: string): Promise<boolean> =>
    (await git(root, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`)).ok

/**
 * What the repository itself says its trunk is, and only then what it is usually called. Nothing is
 * asked of the tracker: the branch afk cuts from is a local one, and a repository that has no remote
 * still has a trunk.
 */
const trunkBranch = async (root: string): Promise<string | undefined> => {
    const head = await git(root, "symbolic-ref", "--short", `refs/remotes/${REMOTE}/HEAD`)
    const named = head.ok && head.stdout.startsWith(`${REMOTE}/`) ? head.stdout.slice(REMOTE.length + 1) : undefined
    // What the remote calls trunk is only trunk here if this checkout has it: the spec branch is cut
    // from a local commit, so a name with no local branch behind it is not one afk can cut from.
    if (named !== undefined && (await hasBranch(root, named))) {
        return named
    }

    for (const candidate of TRUNK_CANDIDATES) {
        if (await hasBranch(root, candidate)) {
            return candidate
        }
    }

    return undefined
}

/** What git said went wrong, preferring what it said on stderr. */
const complaint = (ran: Ran): string => (ran.stderr === "" ? ran.stdout : ran.stderr)

const there = async (path: string): Promise<boolean> => {
    try {
        await access(path)
        return true
    } catch {
        return false
    }
}

/**
 * Whether a rebase is still under way in `cwd`. Two questions, because a rebase git stopped in is
 * still in progress after every conflicted path has been staged: the tree is the ticket's again
 * only once the rebase has been continued or aborted.
 */
const rebasing = async (cwd: string): Promise<boolean> => {
    const unmerged = await git(cwd, "ls-files", "--unmerged")
    if (unmerged.ok && unmerged.stdout !== "") {
        return true
    }

    for (const state of ["rebase-merge", "rebase-apply"]) {
        const named = await git(cwd, "rev-parse", "--git-path", state)
        // `--git-path` answers relative to the worktree it was asked in, unless the repository puts
        // its git directory somewhere else.
        const path = named.stdout
        if (named.ok && path !== "" && (await there(isAbsolute(path) ? path : resolve(cwd, path)))) {
            return true
        }
    }

    return false
}

/** The comparison against the remote trunk, or nothing to compare with. */
const compare = async (root: string, trunk: string): Promise<{ ahead: number; behind: number; compared: boolean }> => {
    const nothing = { ahead: 0, behind: 0, compared: false }

    const fetched = await git(root, "fetch", "--no-tags", "--quiet", REMOTE, trunk)
    if (!fetched.ok) {
        return nothing
    }

    const counted = await git(root, "rev-list", "--left-right", "--count", `refs/heads/${trunk}...FETCH_HEAD`)
    const [ahead, behind] = counted.stdout.split(/\s+/).map(Number)
    if (!counted.ok || ahead === undefined || behind === undefined || !Number.isInteger(ahead + behind)) {
        return nothing
    }

    return { ahead, behind, compared: true }
}

export const createGit = (): Git => ({
    topLevel: async cwd => {
        const top = await git(cwd, "rev-parse", "--show-toplevel")
        return top.ok && top.stdout !== "" ? top.stdout : undefined
    },

    inspectTrunk: async root => {
        const branch = await trunkBranch(root)
        if (branch === undefined) {
            return undefined
        }

        const status = await git(root, "status", "--porcelain")
        const state: TrunkState = { branch, dirty: status.stdout !== "", ...(await compare(root, branch)) }
        return state
    },

    checkoutWorktree: async (root, { path, branch, startPoint }): Promise<GitResult> => {
        // A run that was killed leaves its worktree registered, and a worktree git no longer knows
        // about leaves its directory behind. Both are ordinary, and neither may fail a start.
        const absolute = join(root, path)
        await git(root, "worktree", "remove", "--force", absolute)
        await git(root, "worktree", "prune")
        await rm(absolute, { recursive: true, force: true })

        const added = (await hasBranch(root, branch))
            ? await git(root, "worktree", "add", absolute, branch)
            : await git(root, "worktree", "add", "-b", branch, absolute, startPoint)

        return added.ok ? { ok: true } : { ok: false, reason: complaint(added) }
    },

    removeWorktree: async (root, path): Promise<GitResult> => {
        const absolute = join(root, path)
        const removed = await git(root, "worktree", "remove", "--force", absolute)
        await git(root, "worktree", "prune")
        return removed.ok ? { ok: true } : { ok: false, reason: complaint(removed) }
    },

    revision: async (root, rev) => {
        const resolved = await git(root, "rev-parse", "--verify", "--quiet", `${rev}^{commit}`)
        return resolved.ok && resolved.stdout !== "" ? resolved.stdout : undefined
    },

    contains: async (root, { rev, commit }) => (await git(root, "merge-base", "--is-ancestor", commit, rev)).ok,

    isClean: async (root, path) => {
        const status = await git(join(root, path), "status", "--porcelain")
        return status.ok && status.stdout === ""
    },

    // One NUL after each message, because a commit message contains blank lines and nothing else
    // separates them reliably.
    log: async (root, { rev, notIn }) => {
        const logged = await git(root, "log", "--reverse", "--format=%B%x00", `${notIn}..${rev}`)
        // A rev git cannot resolve is a refusal, not an empty range, and the caller must tell them
        // apart.
        if (!logged.ok) {
            return undefined
        }
        return logged.stdout
            .split("\0")
            .map(message => message.trim())
            .filter(message => message !== "")
    },

    rebase: async (root, { path, onto }): Promise<RebaseResult> => {
        const cwd = join(root, path)
        const rebased = await git(cwd, "rebase", onto)
        if (rebased.ok) {
            return { outcome: "landed" }
        }

        // git exits non-zero both for a conflict it wants resolved and for a rebase it refused to
        // start. Only the tree can tell them apart, and only one of them is worth an agent.
        return (await rebasing(cwd)) ? { outcome: "conflicted" } : { outcome: "failed", reason: complaint(rebased) }
    },

    squashMerge: async (root, { path, branch, message }): Promise<GitResult> => {
        const cwd = join(root, path)

        // `--squash` records no MERGE_HEAD, so there is no merge to abort: what a half-finished one
        // leaves is an index and a tree, and putting the worktree back means discarding both. HEAD
        // does not move, so nothing that already landed is at risk.
        const undo = async (ran: Ran): Promise<GitResult> => {
            await git(cwd, "reset", "--hard", "HEAD")
            return { ok: false, reason: complaint(ran) }
        }

        const merged = await git(cwd, "merge", "--squash", branch)
        if (!merged.ok) {
            return undo(merged)
        }

        const committed = await git(cwd, "commit", "-m", message)
        return committed.ok ? { ok: true } : undo(committed)
    },

    conflicted: async (root, path) => rebasing(join(root, path)),

    abortRebase: async (root, path): Promise<GitResult> => {
        const cwd = join(root, path)
        // Asking git to abort where there is no rebase is an error, and a worktree with nothing to
        // abort is the ordinary case on every failure that happened before the rebase started.
        if (!(await rebasing(cwd))) {
            return { ok: true }
        }

        const aborted = await git(cwd, "rebase", "--abort")
        return aborted.ok ? { ok: true } : { ok: false, reason: complaint(aborted) }
    },
})
