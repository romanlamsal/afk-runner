import { execFile } from "node:child_process"
import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { createEnvironmentFiles } from "../../src/infrastructure/environment-files.ts"

/**
 * Which files count as the operator's environment is a question only git can answer — an
 * environment file is one the repository ignores — so this adapter is exercised against a real
 * repository rather than a fake that would simply agree.
 */
const exec = promisify(execFile)

const copy = createEnvironmentFiles()

const sh = async (cwd: string, ...args: string[]): Promise<string> => (await exec("git", args, { cwd })).stdout.trim()

const write = async (root: string, path: string, contents: string): Promise<void> => {
    await mkdir(join(root, path, ".."), { recursive: true })
    await writeFile(join(root, path), contents, "utf8")
}

/** A repository that ignores `.env` files anywhere, with one commit and an empty worktree beside it. */
const repository = async (): Promise<string> => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "afk-env-")))
    await sh(root, "init", "-b", "main")
    await sh(root, "config", "user.email", "afk@example.com")
    await sh(root, "config", "user.name", "afk")
    await write(root, ".gitignore", ".env\n.env.*\n.afk/\n")
    await sh(root, "add", ".")
    await sh(root, "commit", "-m", "first")
    await mkdir(join(root, ".afk/4/t7"), { recursive: true })
    return root
}

describe("createEnvironmentFiles", () => {
    it("should put an ignored environment file into the worktree", async () => {
        // given
        const root = await repository()
        await write(root, ".env", "TOKEN=secret\n")

        // when
        await copy(root, ".afk/4/t7")

        // then
        expect(await readFile(join(root, ".afk/4/t7/.env"), "utf8")).toBe("TOKEN=secret\n")
    })

    it("should copy the file rather than symlink it, so that rotating a secret leaves it alone", async () => {
        // given
        const root = await repository()
        await write(root, ".env", "TOKEN=secret\n")
        await copy(root, ".afk/4/t7")

        // when
        const copied = await lstat(join(root, ".afk/4/t7/.env"))

        // then
        expect(copied.isSymbolicLink()).toBe(false)
    })

    it("should preserve the relative path, so that a monorepo's layout lands correctly", async () => {
        // given
        const root = await repository()
        await write(root, "packages/api/.env.test", "DATABASE_URL=postgres://\n")

        // when
        await copy(root, ".afk/4/t7")

        // then
        expect(await readFile(join(root, ".afk/4/t7/packages/api/.env.test"), "utf8")).toBe(
            "DATABASE_URL=postgres://\n",
        )
    })

    it("should leave a tracked file alone, because it is already in the worktree git made", async () => {
        // given
        const root = await repository()

        // when
        await copy(root, ".afk/4/t7")

        // then
        await expect(readFile(join(root, ".afk/4/t7/.gitignore"), "utf8")).rejects.toThrow()
    })

    it("should never copy a copy out of another worktree in the run directory", async () => {
        // given — an earlier ticket's worktree holds a copy, which is an ignored file too
        const root = await repository()
        await write(root, ".env", "TOKEN=secret\n")
        await write(root, ".afk/4/t6/.env", "TOKEN=secret\n")

        // when
        await copy(root, ".afk/4/t7")

        // then
        await expect(readFile(join(root, ".afk/4/t7/.afk/4/t6/.env"), "utf8")).rejects.toThrow()
    })

    it("should leave an ignored file that is not an environment file where it is", async () => {
        // given
        const root = await repository()
        await write(root, ".gitignore", ".env\n.env.*\n.afk/\nbuild/\n")
        await write(root, "build/bundle.js", "// huge\n")

        // when
        await copy(root, ".afk/4/t7")

        // then
        await expect(readFile(join(root, ".afk/4/t7/build/bundle.js"), "utf8")).rejects.toThrow()
    })
})
