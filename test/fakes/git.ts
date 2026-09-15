import type { Git, TrunkState, WorktreeRequest, WorktreeResult } from "../../src/domain/git.ts"

export type FakeGit = {
    git: Git
    /** Every worktree asked for, in the order it was asked for. */
    worktrees: WorktreeRequest[]
}

export const TRUNK: TrunkState = { branch: "main", ahead: 0, behind: 0, compared: true, dirty: false }

export const createFakeGit = (
    repository: { root?: string | undefined; trunk?: TrunkState | undefined; checkout?: WorktreeResult } = {},
): FakeGit => {
    const worktrees: WorktreeRequest[] = []
    return {
        worktrees,
        git: {
            topLevel: async () => ("root" in repository ? repository.root : "/repo"),
            inspectTrunk: async () => ("trunk" in repository ? repository.trunk : TRUNK),
            checkoutWorktree: async (_root, request) => {
                worktrees.push(request)
                return repository.checkout ?? { ok: true }
            },
        },
    }
}
