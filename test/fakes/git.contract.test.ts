import { describeGitContract, type GitWorld } from "../contract/git.ts"
import { createFakeGit } from "./git.ts"

/**
 * The fake half of the git port's contract. The other half runs the same suite against real git
 * (`test/infrastructure/git.contract.integration.test.ts`); this one is what the default suite
 * runs, and the pair is what keeps the fake honest.
 */
const world = async (): Promise<GitWorld> => {
    const fake = createFakeGit({ branches: { main: ["trunk-tip"] } })
    let made = 0

    /** Where a branch is checked out: one worktree each, which is all git will allow anyway. */
    const worktree = async (branch: string): Promise<string> => {
        const path = `wt/${branch}`
        // Through the port, so the fake creates the branch the way a run would.
        await fake.git.checkoutWorktree("/repo", { path, branch, startPoint: "main" })
        return path
    }

    const commit = async (branch: string): Promise<string> => {
        await worktree(branch)
        made += 1
        const sha = `commit-${made}`
        fake.commit(branch, sha)
        return sha
    }

    return {
        git: fake.git,
        root: "/repo",
        trunk: "main",
        commit,
        worktree,
        orphan: async branch => {
            made += 1
            const sha = `orphan-${made}`
            fake.commit(branch, sha)
            return sha
        },
        collide: async (branch, onto) => {
            await commit(onto)
            await commit(branch)
            fake.collide(branch)
        },
        soil: async path => {
            fake.soil(path)
        },
    }
}

describeGitContract("the git fake", world)
