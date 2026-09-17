import { tmpdir } from "node:os"
import { describe, expect, it } from "vitest"
import { killEveryChild, run } from "../../src/infrastructure/process.ts"

/**
 * Real processes, for the one property no fake could show: what the operating system does to a
 * child when the terminal interrupts afk. A terminal signals the whole foreground process group, so
 * a child that shared afk's group would die on the *first* interrupt — and drain exists precisely
 * so that an implementer six minutes in does not (ADR-0016).
 */

describe("running another program", () => {
    it("should give every child a process group of its own, so that afk alone answers the interrupt", async () => {
        // given — a shell that reports its own pid and the group it is in
        const reportingItsGroup = `echo "$$ $(ps -o pgid= -p $$ | tr -d ' ')"`

        // when
        const ran = await run("sh", ["-c", reportingItsGroup], { cwd: tmpdir() })

        // then — a child that leads its own group is one the terminal's signal never reaches
        const [pid, group] = ran.stdout.split(" ")
        expect(group).toBe(pid)
    })

    it("should kill a child that is still running, which is the second interrupt's whole shutdown", async () => {
        // given — a command that would outlast the night
        const wedged = run("sh", ["-c", "sleep 30"], { cwd: tmpdir() })

        // when
        killEveryChild()

        // then
        expect((await wedged).ok).toBe(false)
    })

    it("should leave a child it already reaped alone, because there is nothing left to kill", async () => {
        // given
        await run("sh", ["-c", "true"], { cwd: tmpdir() })

        // when
        const killing = (): void => killEveryChild()

        // then
        expect(killing).not.toThrow()
    })
})
