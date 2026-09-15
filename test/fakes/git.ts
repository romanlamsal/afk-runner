import type { Git, TrunkState, WorktreeRequest, WorktreeResult } from "../../src/domain/git.ts"

/**
 * The git port's fake, and it is allowed to be fat: it models a branch as the commits on it, so
 * that "is this branch ahead of that commit" and "does it contain it" are answered the way git
 * answers them rather than by a flag a test set. A rule that needed more than this would be a rule
 * that belongs in the domain.
 *
 * What it deliberately does not do is *produce* a conflict — no rule inspects a conflicted tree.
 * The real behaviour is pinned by the contract suite in `test/contract/git.ts`, which runs against
 * this fake and against real git.
 */
export type FakeGit = {
    git: Git
    /** Every worktree asked for, in the order it was asked for. */
    worktrees: WorktreeRequest[]
    /** Put a commit on a branch, as an agent working in a worktree would. */
    commit: (branch: string, sha: string) => void
}

export const TRUNK: TrunkState = { branch: "main", ahead: 0, behind: 0, compared: true, dirty: false }

export type FakeRepository = {
    root?: string | undefined
    trunk?: TrunkState | undefined
    checkout?: WorktreeResult
    /** Branch name to the commits on it, oldest first. The last one is the tip. */
    branches?: Record<string, readonly string[]>
}

export const createFakeGit = (repository: FakeRepository = {}): FakeGit => {
    const worktrees: WorktreeRequest[] = []
    const branches = new Map<string, string[]>(
        Object.entries(repository.branches ?? {}).map(([branch, commits]) => [branch, [...commits]]),
    )

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

    return {
        worktrees,
        commit: (branch, sha) => {
            branches.set(branch, [...(branches.get(branch) ?? []), sha])
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
                return { ok: true }
            },
            revision: async (_root, rev) => tipOf(rev),
            contains: async (_root, { rev, commit }) => historyOf(rev).includes(commit),
        },
    }
}
