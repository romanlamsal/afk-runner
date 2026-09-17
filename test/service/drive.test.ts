import { describe, expect, it } from "vitest"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import type { Manifest } from "../../src/domain/manifest.ts"
import type { PreparedRun } from "../../src/domain/run.ts"
import type { StepResult } from "../../src/service/attempt.ts"
import { createDriveService } from "../../src/service/drive.ts"
import { createFakeBoard } from "../fakes/board.ts"
import { createFakeEventLog, type FakeEventLog } from "../fakes/event-log.ts"
import { createFakeInterrupts } from "../fakes/interrupts.ts"

/**
 * The loop, and deliberately nothing else. Which action follows which is the decision function's,
 * and is asserted against it directly in `test/domain/decide.test.ts` — never a second time through
 * fakes. What is asserted here is what the loop alone owns: that an action reaches the service that
 * performs it, that a skip is written down rather than dispatched, and what the run comes to when a
 * step halts it or the operator stops it.
 *
 * The real decision function is used rather than a double: it is pure, and a fake of it would make
 * these tests assert the fake.
 */

const MANIFEST: Manifest = {
    spec: 4,
    setup: "npm ci",
    verify: "npm run check",
    tickets: [
        { number: 7, title: "Implement the slate", blockedBy: [] },
        { number: 8, title: "Rebase onto the spec branch", blockedBy: [7] },
    ],
}

const RUN: PreparedRun = {
    root: "/repo",
    spec: 4,
    trunk: "main",
    branch: "afk/4/spec",
    gate: ".afk/4/gate",
    manifest: MANIFEST,
}

const AT = "2026-09-15T11:18:38.314Z"

const event = (ticket: number, step: LifecycleEvent["step"], outcome: LifecycleEvent["outcome"]): LifecycleEvent => ({
    ticket,
    step,
    outcome,
    at: AT,
})

/**
 * Both of a step's events, the way every real service writes them: a start, so that a killed run
 * leaves a record the step began, and an end. The attempt budget is counted off the start events,
 * so a fake that wrote only the end would let a step be retried forever.
 */
const settle = async (
    events: FakeEventLog,
    ticket: number,
    step: LifecycleEvent["step"],
    outcome: "ok" | "failed" | "halted" | "conflicted",
): Promise<void> => {
    await events.log.append(RUN.root, RUN.spec, event(ticket, step, "running"))
    if (outcome !== "halted") {
        await events.log.append(RUN.root, RUN.spec, event(ticket, step, outcome))
    }
}

type Setup = {
    /** What an earlier run left behind. An empty log is a spec nothing has happened to. */
    log?: readonly LifecycleEvent[]
    /** What the implement service comes to. It settles its own step, the way the real one does. */
    implementing?: StepResult
    /** What the setup service comes to, which is what an implementer is waited on by. */
    settingUp?: StepResult
    /** What git made of the rebase, which is what puts a ticket in front of a resolver or not. */
    rebasing?: "ok" | "conflicted"
    /** What the gate comes to, which is what puts a ticket into the gate-red sequence or not. */
    gating?: "ok" | "failed"
    /** Called as each implementer settles, which is the only moment an interrupt is worth aiming at. */
    duringImplement?: (interrupt: () => void) => void
}

const harness = ({
    log = [],
    implementing = { outcome: "ok" },
    settingUp = { outcome: "ok" },
    rebasing = "ok",
    gating = "ok",
    duringImplement,
}: Setup = {}) => {
    const events = createFakeEventLog(log)
    const board = createFakeBoard()
    const { interrupts, interrupt } = createFakeInterrupts()
    /** Every action the loop handed out, as `<kind>:<ticket>`: which service got what, and nothing else. */
    const dispatched: string[] = []

    const drive = createDriveService({
        board: board.board,
        events: events.log,
        interrupts,
        now: () => new Date(AT),
        setup: async (_run, action) => {
            dispatched.push(`setup:${action.ticket}`)
            await settle(events, action.ticket, "setup", settingUp.outcome)
            return settingUp
        },
        implement: async (_run, action) => {
            dispatched.push(`implement:${action.ticket}`)
            await settle(events, action.ticket, "implement", implementing.outcome)
            duringImplement?.(interrupt)
            return implementing
        },
        rebase: async (_run, action) => {
            dispatched.push(`rebase:${action.ticket}`)
            await settle(events, action.ticket, "rebase", rebasing)
            return { outcome: "ok" }
        },
        resolve: async (_run, action) => {
            dispatched.push(`resolve:${action.ticket}`)
            await settle(events, action.ticket, "resolve", "ok")
            return { outcome: "ok" }
        },
        merge: async (_run, action) => {
            dispatched.push(`merge:${action.ticket}`)
            await settle(events, action.ticket, "merge", "ok")
            return { outcome: "ok" }
        },
        gate: async (_run, action) => {
            dispatched.push(`gate:${action.ticket}`)
            await settle(events, action.ticket, "gate", gating)
            return { outcome: gating }
        },
        fix: async (_run, action) => {
            dispatched.push(`fix:${action.ticket}`)
            await settle(events, action.ticket, "fix", "failed")
            return { outcome: "failed" }
        },
        revert: async (_run, action) => {
            dispatched.push(`revert:${action.ticket}`)
            await settle(events, action.ticket, "revert", "failed")
            return { outcome: "failed" }
        },
        prepare: async (_run, action) => {
            dispatched.push(`prepare:${action.ticket}`)
            await settle(events, action.ticket, "prepare", "ok")
            return { outcome: "ok" }
        },
    })

    return { drive, events, dispatched, interrupt, board }
}

describe("createDriveService: the service an action reaches", () => {
    it.each([
        ["setup", {}, "setup:7"],
        ["implement", {}, "implement:7"],
        ["rebase", {}, "rebase:7"],
        ["merge", {}, "merge:7"],
        ["gate", {}, "gate:7"],
        ["resolve", { rebasing: "conflicted" }, "resolve:7"],
        ["fix", { gating: "failed" }, "fix:7"],
        ["revert", { gating: "failed" }, "revert:7"],
        ["prepare", { implementing: { outcome: "failed" } }, "prepare:7"],
    ] as const)("should give a %s action to the service that performs it", async (_kind, setup, expected) => {
        // given
        const { drive, dispatched } = harness(setup)

        // when
        await drive(RUN, { maxParallel: 2 })

        // then
        expect(dispatched).toContain(expected)
    })
})

describe("createDriveService: what the loop settles itself", () => {
    it("should settle a skip by writing it down rather than by dispatching it", async () => {
        // given: an implementer that never succeeds, so #7 spends its budget and #8 can never land
        const { drive, events } = harness({ implementing: { outcome: "failed" } })

        // when
        await drive(RUN, { maxParallel: 2 })

        // then
        expect(events.appended).toContainEqual(expect.objectContaining({ ticket: 8, outcome: "skipped" }))
    })
})

describe("createDriveService: what the run comes to", () => {
    it.each([
        ["halted", { outcome: "halted", reason: "#7 is not in the manifest" }, "halted"],
        ["done", { outcome: "ok" }, "done"],
    ] as const)("should come to %s when a step settled as %o", async (_case, implementing, expected) => {
        // given
        const { drive } = harness({ implementing })

        // when
        const result = await drive(RUN, { maxParallel: 2 })

        // then
        expect(result.outcome).toBe(expected)
    })

    it("should carry the halting step's reason out as the run's whole explanation", async () => {
        // given
        const reason = "#7 is not in the manifest"
        const { drive } = harness({ implementing: { outcome: "halted", reason } })

        // when
        const result = await drive(RUN, { maxParallel: 2 })

        // then
        expect(result.reason).toBe(reason)
    })

    it("should come to interrupted when the operator stopped the run", async () => {
        // given
        const { drive } = harness({ duringImplement: interrupt => interrupt() })

        // when
        const result = await drive(RUN, { maxParallel: 1 })

        // then
        expect(result.outcome).toBe("interrupted")
    })

    it("should start nothing new once the operator has interrupted", async () => {
        // given
        const { drive, dispatched } = harness({ duringImplement: interrupt => interrupt() })

        // when
        await drive(RUN, { maxParallel: 1 })

        // then
        expect(dispatched.filter(action => action.startsWith("implement:"))).toHaveLength(1)
    })

    it("should report the progress the log came to", async () => {
        // given
        const { drive } = harness()

        // when
        const result = await drive(RUN, { maxParallel: 2 })

        // then
        expect(result.progress.verified).toEqual([7, 8])
    })
})

describe("createDriveService: what the board is shown", () => {
    it("should show every ticket of the spec from the first frame", async () => {
        // given
        const { drive, board } = harness()

        // when
        await drive(RUN, { maxParallel: 2 })

        // then
        expect(board.shown[0]?.rows.map(row => row.ticket)).toEqual([7, 8])
    })

    it("should show what the run came to as its last frame", async () => {
        // given: a run that gets both tickets through, so both end on the merge track
        const { drive, board } = harness()

        // when
        await drive(RUN, { maxParallel: 2 })

        // then
        expect(board.shown.at(-1)?.rows.map(row => row.track)).toEqual(["merge", "merge"])
    })
})
