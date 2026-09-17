import { describe, expect, it } from "vitest"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import type { Manifest } from "../../src/domain/manifest.ts"
import type { PreparedRun } from "../../src/domain/run.ts"
import type { StepResult } from "../../src/service/attempt.ts"
import { createGateService, createProveBranch } from "../../src/service/gate.ts"
import { createFakeCommands } from "../fakes/commands.ts"
import { createFakeEventLog } from "../fakes/event-log.ts"

/**
 * The gate. What is asserted is which commands ran where, and what the log says the spec branch came
 * to — the only thing in the run that produces **verified**.
 */

const MANIFEST: Manifest = {
    spec: 4,
    setup: "npm ci",
    verify: "npm run check",
    tickets: [{ number: 7, title: "Implement the slate", blockedBy: [] }],
}

const RUN: PreparedRun = {
    root: "/repo",
    spec: 4,
    trunk: "main",
    branch: "afk/4/spec",
    gate: ".afk/4/gate",
    manifest: MANIFEST,
}

/** `failing` is the command that goes red in this repository; undefined is one where both pass. */
const harness = (failing?: string) => {
    const commands = createFakeCommands(failing)
    const events = createFakeEventLog()

    const gate = createGateService({
        events: events.log,
        now: () => new Date(),
        prove: createProveBranch({ commands: commands.run }),
    })

    return { commands, events, gate: (): Promise<StepResult> => gate(RUN, 7) }
}

const steps = (appended: readonly LifecycleEvent[]): string[] => appended.map(event => `${event.step} ${event.outcome}`)

describe("the gate service: a spec branch that holds up", () => {
    it("should run setup and then verify, in that order", async () => {
        // given
        const { gate, commands } = harness()

        // when
        await gate()

        // then
        expect(commands.ran.map(ran => ran.command)).toEqual(["npm ci", "npm run check"])
    })

    it("should run both in the gate worktree, which stands on the commit that just landed", async () => {
        // given
        const { gate, commands } = harness()

        // when
        await gate()

        // then
        expect(commands.ran.map(ran => ran.cwd)).toEqual([".afk/4/gate", ".afk/4/gate"])
    })

    it("should write one start event and one end event, against the ticket whose merge caused it", async () => {
        // given
        const { gate, events } = harness()

        // when
        await gate()

        // then
        expect(events.appended).toMatchObject([
            { ticket: 7, step: "gate", outcome: "running" },
            { ticket: 7, step: "gate", outcome: "ok" },
        ])
    })

    it("should report the green the ticket becomes verified on", async () => {
        // given
        const { gate } = harness()

        // when
        const result = await gate()

        // then
        expect(result).toEqual({ outcome: "ok" })
    })
})

describe("the gate service: a spec branch that does not hold up", () => {
    it.each([
        ["setup", "npm ci"],
        ["verify", "npm run check"],
    ] as const)("should end red when %s does", async (_name, failing) => {
        // given
        const { gate, events } = harness(failing)

        // when
        await gate()

        // then
        expect(steps(events.appended)).toEqual(["gate running", "gate failed"])
    })

    it("should never run verify against a checkout setup could not prepare", async () => {
        // given
        const { gate, commands } = harness("npm ci")

        // when
        await gate()

        // then
        expect(commands.ran.map(ran => ran.command)).toEqual(["npm ci"])
    })

    it("should say what went wrong, so that the operator reads it rather than guesses", async () => {
        // given
        const { gate, events } = harness("npm run check")

        // when
        await gate()

        // then
        expect(events.appended.at(-1)?.detail).toBe("`npm run check` failed: exit 1")
    })
})
