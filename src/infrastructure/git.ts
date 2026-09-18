import { access, rm } from "node:fs/promises"
import { isAbsolute, join, resolve, sep } from "node:path"
import type { BaseState, Git, GitResult, RebaseResult } from "../domain/git.ts"
import { DEFAULT_BASE } from "../domain/manifest.ts"
import { INVOCATION_TIMEOUT_MS } from "../domain/timeout.ts"
import { complaint, type Ran, run } from "./process.ts"

/**
 * The git port, against the git binary.
 *
 * Every command here either reads, or writes the one branch afk owns through the one worktree that
 * owns it. The fetch is the only thing that reaches the network, and it moves nothing the operator
 * can see: it updates `FETCH_HEAD`, which is what the comparison reads, and leaves the local base
 * and the working tree exactly where they were (ADR-0018).
 */

/** afk compares against one remote. A repository with none is simply not compared. */
const REMOTE = "origin"

/** What `worktree list --porcelain` puts in front of every path it lists. */
const WORKTREE_LINE = "worktree "

const git = (cwd: string, ...args: string[]): Promise<Ran> => run("git", args, { cwd })

/** What a command that prints one thing per line said, with the empty output being nothing at all. */
const lines = (stdout: string): string[] => stdout.split("\n").filter(line => line !== "")

const hasBranch = async (root: string, branch: string): Promise<boolean> =>
    (await git(root, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`)).ok

/**
 * What the repository itself says its default branch is, and only then what one is usually called.
 * Nothing is asked of the tracker: the branch afk cuts from is a local one, and a repository that
 * has no remote still has a default branch.
 */
const defaultBaseBranch = async (root: string): Promise<string | undefined> => {
    const head = await git(root, "symbolic-ref", "--short", `refs/remotes/${REMOTE}/HEAD`)
    const named = head.ok && head.stdout.startsWith(`${REMOTE}/`) ? head.stdout.slice(REMOTE.length + 1) : undefined
    // What the remote calls its default branch is only a base here if this checkout has it: the spec
    // branch is cut from a local commit, so a name with no local branch behind it is not one afk can
    // cut from.
    if (named !== undefined && (await hasBranch(root, named))) {
        return named
    }

    // The same name a manifest written before ADR-0032 reads as, because they are the same guess:
    // what a default branch is called where nothing in the repository says otherwise.
    return (await hasBranch(root, DEFAULT_BASE)) ? DEFAULT_BASE : undefined
}

const exists = async (path: string): Promise<boolean> => {
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
        if (named.ok && path !== "" && (await exists(isAbsolute(path) ? path : resolve(cwd, path)))) {
            return true
        }
    }

    return false
}

/** The comparison against the remote base, or nothing to compare with. */
const compare = async (root: string, base: string): Promise<{ ahead: number; behind: number; compared: boolean }> => {
    const nothing = { ahead: 0, behind: 0, compared: false }

    const fetched = await git(root, "fetch", "--no-tags", "--quiet", REMOTE, base)
    if (!fetched.ok) {
        return nothing
    }

    const counted = await git(root, "rev-list", "--left-right", "--count", `refs/heads/${base}...FETCH_HEAD`)
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

    hasLocalBranch: hasBranch,

    defaultBase: defaultBaseBranch,

    inspectBase: async (root, branch) => {
        if (!(await hasBranch(root, branch))) {
            return undefined
        }

        const status = await git(root, "status", "--porcelain")
        const state: BaseState = { branch, dirty: status.stdout !== "", ...(await compare(root, branch)) }
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

    // git lists what it administers, which is the question: a directory it no longer knows about is
    // not a worktree, and neither is one a killed run left behind after its administration was
    // pruned.
    hasWorktree: async (root, path) => {
        const listed = await git(root, "worktree", "list", "--porcelain")
        return listed.ok && listed.stdout.split("\n").includes(`worktree ${join(root, path)}`)
    },

    // Pruned first, so that a worktree whose directory the operator already deleted is administration
    // git has forgotten rather than a removal it refuses. What is left is listed and removed one by
    // one, because git takes one worktree per call.
    removeWorktreesUnder: async (root, path): Promise<GitResult> => {
        await git(root, "worktree", "prune")
        const listed = await git(root, "worktree", "list", "--porcelain")
        if (!listed.ok) {
            return { ok: false, reason: complaint(listed) }
        }

        const under = `${join(root, path)}${sep}`
        const registered = lines(listed.stdout)
            .filter(line => line.startsWith(WORKTREE_LINE))
            .map(line => line.slice(WORKTREE_LINE.length))
            .filter(worktree => worktree.startsWith(under))

        for (const worktree of registered) {
            const removed = await git(root, "worktree", "remove", "--force", worktree)
            if (!removed.ok) {
                return { ok: false, reason: complaint(removed) }
            }
        }

        await git(root, "worktree", "prune")
        return { ok: true }
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

    revert: async (root, { path, from, message }): Promise<GitResult> => {
        const cwd = join(root, path)

        // A revert git refused leaves a staged half of one behind, and putting the worktree back
        // means discarding both the index and the tree. HEAD does not move, so nothing that already
        // landed is at risk.
        const undo = async (ran: Ran): Promise<GitResult> => {
            await git(cwd, "revert", "--quit")
            await git(cwd, "reset", "--hard", "HEAD")
            return { ok: false, reason: complaint(ran) }
        }

        // The whole range, which git reverts newest first — the only order that applies — and
        // `--no-commit` is what makes it one commit rather than one per commit being undone.
        const reverted = await git(cwd, "revert", "--no-commit", `${from}^..HEAD`)
        if (!reverted.ok) {
            return undo(reverted)
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

    // `--force`, because a branch afk owns is deleted on its own say-so: an unmerged ticket branch
    // is the ordinary case, and being asked to confirm it is what starting over exists to avoid.
    // A prefix nothing is named under deletes nothing, which is not a failure.
    deleteBranchesUnder: async (root, prefix): Promise<GitResult> => {
        const listed = await git(root, "for-each-ref", "--format=%(refname:short)", `refs/heads/${prefix}*`)
        if (!listed.ok) {
            return { ok: false, reason: complaint(listed) }
        }

        // The pattern keeps the listing small; the prefix is what decides. Neither side of this pair
        // leans on what a `*` means to the command it was handed, so both mean the same thing.
        const named = lines(listed.stdout).filter(branch => branch.startsWith(prefix))
        if (named.length === 0) {
            return { ok: true }
        }

        const deleted = await git(root, "branch", "--delete", "--force", ...named)
        return deleted.ok ? { ok: true } : { ok: false, reason: complaint(deleted) }
    },

    // The remote is read before it is written to, so that a branch that is not there is nothing to
    // delete rather than a push git refuses — and so that one push takes away everything that is.
    deleteRemoteBranchesUnder: async (root, prefix): Promise<GitResult> => {
        // A repository with no remote never had anything pushed to one, which is the ordinary case
        // for a run that died before it finished.
        if (!(await git(root, "remote", "get-url", REMOTE)).ok) {
            return { ok: true }
        }

        const listed = await run("git", ["ls-remote", "--heads", REMOTE, `refs/heads/${prefix}*`], {
            cwd: root,
            timeoutMs: INVOCATION_TIMEOUT_MS,
        })
        if (!listed.ok) {
            return { ok: false, reason: complaint(listed) }
        }

        // `<sha>\t<ref>`, and the ref is taken whole: `push --delete` is given full ref names so
        // that nothing it is handed can be read as anything but a branch.
        const heads = `refs/heads/${prefix}`
        const refs = lines(listed.stdout)
            .map(line => line.split("\t")[1] ?? "")
            .filter(ref => ref.startsWith(heads))
        if (refs.length === 0) {
            return { ok: true }
        }

        const deleted = await run("git", ["push", REMOTE, "--delete", ...refs], {
            cwd: root,
            timeoutMs: INVOCATION_TIMEOUT_MS,
        })
        return deleted.ok ? { ok: true } : { ok: false, reason: complaint(deleted) }
    },

    // `--set-upstream` so that a second push of the same branch — a resumed run's, or the
    // operator's own afterwards — needs no arguments. Never `--force`: the spec branch is
    // append-only, and a push git refuses is a fact worth reporting rather than overriding.
    //
    // It is given the one timeout every external invocation gets, because it is the one git call
    // that reaches the network and can sit on a credential prompt nobody is there to answer
    // (ADR-0021).
    push: async (root, branch): Promise<GitResult> => {
        const pushed = await run("git", ["push", "--set-upstream", REMOTE, branch], {
            cwd: root,
            timeoutMs: INVOCATION_TIMEOUT_MS,
        })
        return pushed.ok ? { ok: true } : { ok: false, reason: complaint(pushed) }
    },
})
