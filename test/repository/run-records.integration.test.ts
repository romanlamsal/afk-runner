import { execFile } from "node:child_process"
import { chmod, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { createFileRunRecordStore } from "../../src/repository/run-records.ts"

/**
 * The run directory against real git: that it ignores itself is a claim about what `git status`
 * reports, and only git can answer it.
 */
const run = promisify(execFile)

const records = createFileRunRecordStore()

const sh = async (cwd: string, ...args: string[]): Promise<string> => (await run("git", args, { cwd })).stdout.trim()

const repository = async (): Promise<string> => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "afk-records-")))
    await sh(root, "init", "-b", "main")
    return root
}

describe("createFileRunRecordStore", () => {
    it("should ignore everything in the run directory, its own ignore file included", async () => {
        // given
        const root = await repository()

        // when
        await records.create(root, 4)

        // then
        expect(await readFile(join(root, ".afk/4/.gitignore"), "utf8")).toContain("*")
    })

    it("should keep the run directory out of the repository's status", async () => {
        // given
        const root = await repository()
        await records.create(root, 4)
        await writeFile(join(root, ".afk/4/events.jsonl"), '{"step":"implement"}\n', "utf8")

        // when
        const status = await sh(root, "status", "--porcelain")

        // then
        expect(status).toBe("")
    })

    it("should refuse to stage what is in the run directory", async () => {
        // given
        const root = await repository()
        await records.create(root, 4)
        await writeFile(join(root, ".afk/4/.env"), "TOKEN=secret\n", "utf8")

        // when
        await sh(root, "add", ".")

        // then
        expect(await sh(root, "diff", "--cached", "--name-only")).toBe("")
    })

    it("should report no event log for a spec that has not run", async () => {
        // given
        const root = await repository()
        await records.create(root, 4)

        // when
        const has = await records.hasEventLog(root, 4)

        // then
        expect(has).toBe(false)
    })

    it("should report the event log a run left behind", async () => {
        // given
        const root = await repository()
        await records.create(root, 4)
        await writeFile(join(root, ".afk/4/events.jsonl"), '{"step":"implement"}\n', "utf8")

        // when
        const has = await records.hasEventLog(root, 4)

        // then
        expect(has).toBe(true)
    })

    it("should take the run directory away whole, transcripts and event log with it", async () => {
        // given
        const root = await repository()
        await records.create(root, 4)
        await writeFile(join(root, ".afk/4/events.jsonl"), '{"step":"implement"}\n', "utf8")

        // when
        await records.remove(root, 4)

        // then
        expect(await records.hasEventLog(root, 4)).toBe(false)
    })

    it("should leave another spec's run directory where it is", async () => {
        // given
        const root = await repository()
        await records.create(root, 4)
        await records.create(root, 5)

        // when
        await records.remove(root, 4)

        // then
        expect(await readFile(join(root, ".afk/5/.gitignore"), "utf8")).toContain("*")
    })

    it("should be content with a spec that has no run directory", async () => {
        // given
        const root = await repository()

        // when
        const removal = await records.remove(root, 4)

        // then
        expect(removal).toEqual({ ok: true })
    })

    // Skipped for a user the filesystem never says no to, which is what running as root is.
    it.skipIf(process.getuid?.() === 0)(
        "should report a run directory it could not take away, rather than throwing past the run",
        async () => {
            // given: a run directory inside one nobody may write to, which is what makes the rm fail
            const root = await repository()
            await records.create(root, 4)
            await chmod(join(root, ".afk"), 0o500)

            // when
            const removal = await records.remove(root, 4)

            // then
            expect(removal).toEqual({ ok: false, reason: expect.stringContaining("EACCES") })
        },
    )
})
