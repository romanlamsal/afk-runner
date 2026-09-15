import { rm } from "node:fs/promises"
import { join } from "node:path"
import type { Git, TrunkState, WorktreeResult } from "../domain/git.ts"
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

    checkoutWorktree: async (root, { path, branch, startPoint }): Promise<WorktreeResult> => {
        // A run that was killed leaves its worktree registered, and a worktree git no longer knows
        // about leaves its directory behind. Both are ordinary, and neither may fail a start.
        const absolute = join(root, path)
        await git(root, "worktree", "remove", "--force", absolute)
        await git(root, "worktree", "prune")
        await rm(absolute, { recursive: true, force: true })

        const added = (await hasBranch(root, branch))
            ? await git(root, "worktree", "add", absolute, branch)
            : await git(root, "worktree", "add", "-b", branch, absolute, startPoint)

        return added.ok ? { ok: true } : { ok: false, reason: added.stderr === "" ? added.stdout : added.stderr }
    },

    revision: async (root, rev) => {
        const resolved = await git(root, "rev-parse", "--verify", "--quiet", `${rev}^{commit}`)
        return resolved.ok && resolved.stdout !== "" ? resolved.stdout : undefined
    },

    contains: async (root, { rev, commit }) => (await git(root, "merge-base", "--is-ancestor", commit, rev)).ok,
})
