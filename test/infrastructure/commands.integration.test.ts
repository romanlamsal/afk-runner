import { mkdtemp, readFile, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createShellCommandRunner } from "../../src/infrastructure/commands.ts"

/**
 * The operator's own commands, run as real processes. What is asserted is what a fake cannot show:
 * that an invocation which never comes back is killed and reported as an ordinary failure, so that
 * one wedged command holds a slot for an hour rather than for a night (ADR-0021) — and that what a
 * command says reaches its log in the run directory while it is still saying it.
 */

const root = async (): Promise<string> => realpath(await mkdtemp(join(tmpdir(), "afk-commands-")))

const LOG = ".afk/4/commands/20260915T111838314Z-t7-gate.log"

const AT = "2026-09-15T11:18:38.314Z"

const stamped = createShellCommandRunner({ timeoutMs: 10_000, now: () => new Date(AT) })

/** The log's contents once they hold `text`, or undefined when `settled` came first. */
const logBefore = async (path: string, text: string, settled: () => boolean): Promise<string | undefined> => {
    while (!settled()) {
        const written = await readFile(path, "utf8").catch(() => "")
        if (written.includes(text)) {
            return written
        }
        await new Promise(resolve => setTimeout(resolve, 10))
    }
    return undefined
}

describe("the shell command runner", () => {
    it("should fail a command that ran past its timeout", async () => {
        // given
        const run = createShellCommandRunner({ timeoutMs: 50 })

        // when
        const ran = await run({ root: await root(), cwd: ".", command: "sleep 30", logPath: LOG })

        // then
        expect(ran.ok).toBe(false)
    })

    it("should say how long a timed-out command was given, because nothing branches on why it failed", async () => {
        // given
        const run = createShellCommandRunner({ timeoutMs: 50 })

        // when
        const ran = await run({ root: await root(), cwd: ".", command: "sleep 30", logPath: LOG })

        // then
        expect(ran.detail).toContain("timed out after")
    })

    it("should run a command that finishes inside its timeout as usual", async () => {
        // given
        const run = createShellCommandRunner({ timeoutMs: 10_000 })

        // when
        const ran = await run({ root: await root(), cwd: ".", command: "true", logPath: LOG })

        // then
        expect(ran.ok).toBe(true)
    })
})

describe("the shell command runner: its log", () => {
    it("should write the command and each line of its output with a timestamp in front", async () => {
        // given
        const repository = await root()

        // when
        await stamped({ root: repository, cwd: ".", command: "printf 'one\\ntwo'", logPath: LOG })

        // then
        expect(await readFile(join(repository, LOG), "utf8")).toBe(`${AT} $ printf 'one\\ntwo'\n${AT} one\n${AT} two\n`)
    })

    it("should write what the command said on stderr as well", async () => {
        // given
        const repository = await root()

        // when
        await stamped({ root: repository, cwd: ".", command: "echo broken >&2; exit 1", logPath: LOG })

        // then
        expect(await readFile(join(repository, LOG), "utf8")).toContain(`${AT} broken\n`)
    })

    it("should append a second command to the log the first wrote, as the gate's setup and verify do", async () => {
        // given
        const repository = await root()
        await stamped({ root: repository, cwd: ".", command: "echo installed", logPath: LOG })

        // when
        await stamped({ root: repository, cwd: ".", command: "echo verified", logPath: LOG })

        // then
        expect(await readFile(join(repository, LOG), "utf8")).toBe(
            `${AT} $ echo installed\n${AT} installed\n${AT} $ echo verified\n${AT} verified\n`,
        )
    })

    it("should write a line while the command is still running rather than once it is done", async () => {
        // given
        const repository = await root()
        const run = createShellCommandRunner({ timeoutMs: 2_000 })
        let settled = false
        const running = run({ root: repository, cwd: ".", command: "echo first; sleep 30", logPath: LOG })
        void running.finally(() => {
            settled = true
        })

        // when
        const written = await logBefore(join(repository, LOG), "first", () => settled)
        await running

        // then
        expect(written).toContain("first")
    })

    it("should still sum a failure up in its detail, so that an event says what happened without the log", async () => {
        // given
        const repository = await root()

        // when
        const ran = await stamped({ root: repository, cwd: ".", command: "echo broken >&2; exit 1", logPath: LOG })

        // then
        expect(ran.detail).toBe("`echo broken >&2; exit 1` failed: broken")
    })
})
