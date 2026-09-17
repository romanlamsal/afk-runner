import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"
import { createShellCommandRunner } from "../../src/infrastructure/commands.ts"

/**
 * The operator's own commands, run as real processes. What is asserted is the one behaviour a fake
 * cannot show: that an invocation which never comes back is killed and reported as an ordinary
 * failure, so that one wedged command holds a slot for an hour rather than for a night (ADR-0021).
 */

describe("the shell command runner", () => {
    it("should fail a command that ran past its timeout", async () => {
        // given
        const run = createShellCommandRunner({ timeoutMs: 50 })

        // when
        const ran = await run({ root: tmpdir(), cwd: ".", command: "sleep 30" })

        // then
        expect(ran.ok).toBe(false)
    })

    it("should say how long a timed-out command was given, because nothing branches on why it failed", async () => {
        // given
        const run = createShellCommandRunner({ timeoutMs: 50 })

        // when
        const ran = await run({ root: tmpdir(), cwd: ".", command: "sleep 30" })

        // then
        expect(ran.detail).toContain("timed out after")
    })

    it("should run a command that finishes inside its timeout as usual", async () => {
        // given
        const run = createShellCommandRunner({ timeoutMs: 10_000 })

        // when
        const ran = await run({ root: tmpdir(), cwd: ".", command: "true" })

        // then
        expect(ran.ok).toBe(true)
    })
})
