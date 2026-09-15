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

    return {
        git: fake.git,
        root: "/repo",
        trunk: "main",
        commit: async branch => {
            // Through the port, so the fake creates the branch the way a run would.
            await fake.git.checkoutWorktree("/repo", { path: `wt/${branch}`, branch, startPoint: "main" })
            made += 1
            const sha = `commit-${made}`
            fake.commit(branch, sha)
            return sha
        },
        orphan: async branch => {
            made += 1
            const sha = `orphan-${made}`
            fake.commit(branch, sha)
            return sha
        },
    }
}

describeGitContract("the git fake", world)
