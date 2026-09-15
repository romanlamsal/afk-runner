import { execFile } from "node:child_process"
import { mkdtemp, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { createGit } from "../../src/infrastructure/git.ts"
import { describeGitContract, type GitWorld } from "../contract/git.ts"

/**
 * The real half of the git port's contract — the same suite the fake runs, against git itself in a
 * throwaway repository. This run is what makes the fake's answers worth trusting.
 */
const exec = promisify(execFile)

const sh = async (cwd: string, ...args: string[]): Promise<string> => (await exec("git", args, { cwd })).stdout.trim()

const commitHere = async (cwd: string, message: string): Promise<string> => {
    await writeFile(join(cwd, `${message}.txt`), `${message}\n`, "utf8")
    await sh(cwd, "add", ".")
    await sh(cwd, "commit", "-m", message)
    return sh(cwd, "rev-parse", "HEAD")
}

const world = async (): Promise<GitWorld> => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "afk-git-contract-")))
    await sh(root, "init", "-b", "main")
    await sh(root, "config", "user.email", "afk@example.com")
    await sh(root, "config", "user.name", "afk")
    await commitHere(root, "first")

    const git = createGit()
    let made = 0

    return {
        git,
        root,
        trunk: "main",
        commit: async branch => {
            // Through the port, and in a worktree of the branch's own — which is the only way real
            // git will have it, because a branch cannot be checked out twice.
            await git.checkoutWorktree(root, { path: `wt/${branch}`, branch, startPoint: "main" })
            made += 1
            return commitHere(join(root, "wt", branch), `work-${made}`)
        },
        orphan: async branch => {
            made += 1
            await sh(root, "checkout", "--orphan", branch)
            const sha = await commitHere(root, `elsewhere-${made}`)
            await sh(root, "checkout", "main")
            return sha
        },
    }
}

describeGitContract("real git", world)
