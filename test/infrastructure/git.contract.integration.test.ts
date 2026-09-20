import { execFile } from "node:child_process"
import { access, appendFile, mkdtemp, realpath, writeFile } from "node:fs/promises"
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

/** What an install leaves: a file the repository ignores. */
const IGNORED = "installed.txt"

const world = async (): Promise<GitWorld> => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "afk-git-contract-")))
    await sh(root, "init", "-b", "main")
    await sh(root, "config", "user.email", "afk@example.com")
    await sh(root, "config", "user.name", "afk")
    await commitHere(root, "first")

    const git = createGit()
    const checkedOut = new Set<string>()
    let made = 0

    /**
     * Where a branch is checked out. Created once and kept, because real git refuses a second
     * checkout of a branch — and re-creating it would throw away the rebase in progress.
     */
    const worktree = async (branch: string): Promise<string> => {
        const path = `wt/${branch}`
        if (!checkedOut.has(branch)) {
            await git.checkoutWorktree(root, { path, branch, startPoint: "main" })
            checkedOut.add(branch)
        }
        return path
    }

    const commit = async (branch: string, message?: string): Promise<string> => {
        // Through the port, and in a worktree of the branch's own — which is the only way real git
        // will have it, because a branch cannot be checked out twice.
        const path = await worktree(branch)
        made += 1
        return commitHere(join(root, path), message ?? `work-${made}`)
    }

    return {
        git,
        root,
        trunk: "main",
        commit,
        worktree,
        orphan: async branch => {
            made += 1
            await sh(root, "checkout", "--orphan", branch)
            const sha = await commitHere(root, `elsewhere-${made}`)
            await sh(root, "checkout", "main")
            return sha
        },
        collide: async (branch, onto) => {
            // One file, added on both sides with different content: the plainest conflict there is.
            for (const [side, text] of [
                [onto, "theirs"],
                [branch, "ours"],
            ] as const) {
                const path = join(root, await worktree(side))
                await writeFile(join(path, "collision.txt"), `${text}\n`, "utf8")
                await sh(path, "add", ".")
                await sh(path, "commit", "-m", `collision-${text}`)
            }
        },
        soil: async path => {
            await writeFile(join(root, path, "uncommitted.txt"), "in progress\n", "utf8")
        },
        // Trunk's first commit is in every worktree, so there is always that file to change.
        edit: async path => {
            await writeFile(join(root, path, "first.txt"), "changed\n", "utf8")
        },
        // Ignored through the repository's own exclude file, which every worktree shares.
        ignore: async path => {
            await appendFile(join(root, ".git", "info", "exclude"), `${IGNORED}\n`, "utf8")
            await writeFile(join(root, path, IGNORED), "installed\n", "utf8")
        },
        ignores: async path => {
            try {
                await access(join(root, path, IGNORED))
                return true
            } catch {
                return false
            }
        },
    }
}

describeGitContract("real git", world)
