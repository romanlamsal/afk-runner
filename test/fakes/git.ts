import type { Git, GitResult, RebaseRequest, TrunkState, WorktreeRequest } from "../../src/domain/git.ts"

/**
 * The git port's fake, and it is allowed to be fat: it models a branch as the commits on it, so
 * that "is this branch ahead of that commit" and "does it contain it" are answered the way git
 * answers them rather than by a flag a test set. A rule that needed more than this would be a rule
 * that belongs in the domain.
 *
 * A rebase is modelled the same way — the branch's own commits replayed onto what it was rebased
 * onto — and a conflict is arranged rather than produced: which branches collide is a scenario's to
 * say. The real behaviour is pinned by the contract suite in `test/contract/git.ts`, which runs
 * against this fake and against real git.
 */
export type FakeGit = {
    git: Git
    /** Every worktree asked for, in the order it was asked for. */
    worktrees: WorktreeRequest[]
    /** Every rebase asked for, in the order it was asked for. */
    rebases: RebaseRequest[]
    /** Put a commit on a branch, as an agent working in a worktree would. */
    commit: (branch: string, sha: string) => void
    /** The commits on a branch, oldest first: what a rebase moved, read back. */
    commitsOn: (branch: string) => readonly string[]
    /** Finish a conflicted rebase, as the conflict resolver in that worktree does. */
    resolve: (path: string) => void
    /** Finish it by dropping the branch's own commits, as skipping the whole rebase would. */
    resolveAway: (path: string) => void
    /** Arrange that rebasing this branch stops on a conflict. */
    collide: (branch: string) => void
    /** Make the worktree at `path` dirty, as an agent that left work uncommitted does. */
    soil: (path: string) => void
}

export const TRUNK: TrunkState = { branch: "main", ahead: 0, behind: 0, compared: true, dirty: false }

export type FakeRepository = {
    root?: string | undefined
    trunk?: TrunkState | undefined
    checkout?: GitResult
    /** Branch name to the commits on it, oldest first. The last one is the tip. */
    branches?: Record<string, readonly string[]>
    /** Worktree path to the branch checked out in it, for worktrees a run already made. */
    checkouts?: Record<string, string>
    /** The branches whose rebase stops on a conflict. */
    colliding?: readonly string[]
}

export const createFakeGit = (repository: FakeRepository = {}): FakeGit => {
    const worktrees: WorktreeRequest[] = []
    const rebases: RebaseRequest[] = []
    const branches = new Map<string, string[]>(
        Object.entries(repository.branches ?? {}).map(([branch, commits]) => [branch, [...commits]]),
    )
    const checkouts = new Map<string, string>(Object.entries(repository.checkouts ?? {}))
    const colliding = new Set(repository.colliding ?? [])
    /** Worktree path to the rebase git stopped in, which is the only state a rebase leaves. */
    const stopped = new Map<string, RebaseRequest>()
    const dirty = new Set<string>()

    /** The commits leading to `rev`, whether it names a branch or a commit already on one. */
    const historyOf = (rev: string): readonly string[] => {
        const branch = branches.get(rev)
        if (branch !== undefined) {
            return branch
        }
        const holder = [...branches.values()].find(commits => commits.includes(rev))
        return holder === undefined ? [] : holder.slice(0, holder.indexOf(rev) + 1)
    }

    const tipOf = (rev: string): string | undefined => historyOf(rev).at(-1)

    /** What a rebase is: the branch's own commits, in order, on top of whatever it was rebased onto. */
    const replay = ({ path, onto }: RebaseRequest): void => {
        const branch = checkouts.get(path)
        if (branch === undefined) {
            return
        }
        const base = historyOf(onto)
        const own = historyOf(branch).filter(commit => !base.includes(commit))
        branches.set(branch, [...base, ...own])
    }

    return {
        worktrees,
        rebases,
        commit: (branch, sha) => {
            branches.set(branch, [...(branches.get(branch) ?? []), sha])
        },
        commitsOn: branch => [...historyOf(branch)],
        resolve: path => {
            const rebase = stopped.get(path)
            if (rebase !== undefined) {
                replay(rebase)
                stopped.delete(path)
            }
        },
        resolveAway: path => {
            const rebase = stopped.get(path)
            const branch = rebase === undefined ? undefined : checkouts.get(path)
            if (rebase !== undefined && branch !== undefined) {
                branches.set(branch, [...historyOf(rebase.onto)])
                stopped.delete(path)
            }
        },
        collide: branch => {
            colliding.add(branch)
        },
        soil: path => {
            dirty.add(path)
        },
        git: {
            topLevel: async () => ("root" in repository ? repository.root : "/repo"),
            inspectTrunk: async () => ("trunk" in repository ? repository.trunk : TRUNK),
            checkoutWorktree: async (_root, request) => {
                worktrees.push(request)
                if (repository.checkout !== undefined && !repository.checkout.ok) {
                    return repository.checkout
                }
                if (!branches.has(request.branch)) {
                    branches.set(request.branch, [...historyOf(request.startPoint)])
                }
                checkouts.set(request.path, request.branch)
                return { ok: true }
            },
            revision: async (_root, rev) => tipOf(rev),
            contains: async (_root, { rev, commit }) => historyOf(rev).includes(commit),
            isClean: async (_root, path) => !dirty.has(path) && !stopped.has(path),
            rebase: async (_root, request) => {
                rebases.push(request)
                const branch = checkouts.get(request.path)
                if (branch === undefined) {
                    return { outcome: "failed", reason: `no worktree at ${request.path}` }
                }
                if (colliding.has(branch)) {
                    stopped.set(request.path, request)
                    return { outcome: "conflicted" }
                }
                replay(request)
                return { outcome: "landed" }
            },
            conflicted: async (_root, path) => stopped.has(path),
            abortRebase: async (_root, path) => {
                stopped.delete(path)
                return { ok: true }
            },
        },
    }
}
