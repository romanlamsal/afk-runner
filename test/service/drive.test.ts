import { describe, expect, it } from "vitest"
import type { Action } from "../../src/domain/decide.ts"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import type { Manifest } from "../../src/domain/manifest.ts"
import type { PreparedRun } from "../../src/domain/run.ts"
import type { StepResult } from "../../src/service/attempt.ts"
import { createDriveService } from "../../src/service/drive.ts"
import { createFakeEventLog, type FakeEventLog } from "../fakes/event-log.ts"
import { createFakeInterrupts } from "../fakes/interrupts.ts"

/**
 * The loop, and deliberately nothing else. Every rule about *what* to start belongs to the decision
 * function and is asserted against it directly; what is asserted here is that the loop asks, starts
 * what it was told to, waits, and asks again — and what it comes to when a step halts the run or the
 * operator stops it.
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
    outcome: "ok" | "failed" | "halted",
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
    /** What the gate comes to, which is what puts a ticket into the gate-red sequence or not. */
    gating?: "ok" | "failed"
    /** Called as each implementer settles, which is the only moment an interrupt is worth aiming at. */
    duringImplement?: (interrupt: () => void) => void
}

const harness = ({
    log = [],
    implementing = { outcome: "ok" },
    settingUp = { outcome: "ok" },
    gating = "ok",
    duringImplement,
}: Setup = {}) => {
    const events = createFakeEventLog(log)
    const { interrupts, interrupt } = createFakeInterrupts()
    const cut: Extract<Action, { kind: "setup" }>[] = []
    const implemented: Extract<Action, { kind: "implement" }>[] = []
    const rebased: Extract<Action, { kind: "rebase" }>[] = []
    const merged: Extract<Action, { kind: "merge" }>[] = []
    const gated: Extract<Action, { kind: "gate" }>[] = []
    const prepared: Extract<Action, { kind: "prepare" }>[] = []
    const fixed: Extract<Action, { kind: "fix" }>[] = []
    const reverted: Extract<Action, { kind: "revert" }>[] = []

    const drive = createDriveService({
        events: events.log,
        interrupts,
        now: () => new Date(AT),
        setup: async (_run, action) => {
            cut.push({ kind: "setup", ...action })
            await settle(events, action.ticket, "setup", settingUp.outcome)
            return settingUp
        },
        implement: async (_run, action) => {
            implemented.push({ kind: "implement", ...action })
            await settle(events, action.ticket, "implement", implementing.outcome)
            duringImplement?.(interrupt)
            return implementing
        },
        rebase: async (_run, action) => {
            rebased.push({ kind: "rebase", ...action })
            await settle(events, action.ticket, "rebase", "ok")
            return { outcome: "ok" }
        },
        resolve: async (_run, action) => {
            await settle(events, action.ticket, "resolve", "ok")
            return { outcome: "ok" }
        },
        merge: async (_run, action) => {
            merged.push({ kind: "merge", ...action })
            await settle(events, action.ticket, "merge", "ok")
            return { outcome: "ok" }
        },
        gate: async (_run, action) => {
            gated.push({ kind: "gate", ...action })
            await settle(events, action.ticket, "gate", gating)
            return { outcome: gating }
        },
        fix: async (_run, action) => {
            fixed.push({ kind: "fix", ...action })
            await settle(events, action.ticket, "fix", "failed")
            return { outcome: "failed" }
        },
        revert: async (_run, action) => {
            reverted.push({ kind: "revert", ...action })
            await settle(events, action.ticket, "revert", "failed")
            return { outcome: "failed" }
        },
        prepare: async (_run, action) => {
            prepared.push({ kind: "prepare", ...action })
            await settle(events, action.ticket, "prepare", "ok")
            return { outcome: "ok" }
        },
    })

    return { drive, events, cut, implemented, rebased, merged, gated, prepared, fixed, reverted, interrupt }
}

describe("createDriveService", () => {
    it("should give a ticket nothing blocks to the setup service", async () => {
        // given
        const { drive, cut } = harness()

        // when
        await drive(RUN, { maxParallel: 2 })

        // then
        expect(cut.map(action => action.ticket)).toContain(7)
    })

    it("should give a ticket its setup got through to the implement service", async () => {
        // given
        const { drive, implemented } = harness()

        // when
        await drive(RUN, { maxParallel: 2 })

        // then
        expect(implemented.map(action => action.ticket)).toContain(7)
    })

    it("should give an implemented ticket to the rebase service", async () => {
        // given
        const { drive, rebased } = harness()

        // when
        await drive(RUN, { maxParallel: 2 })

        // then
        expect(rebased.map(action => action.ticket)).toContain(7)
    })

    it("should give a rebased ticket to the merge service", async () => {
        // given
        const { drive, merged } = harness()

        // when
        await drive(RUN, { maxParallel: 2 })

        // then
        expect(merged.map(action => action.ticket)).toContain(7)
    })

    it("should give a ticket whose gate went red to the fix service", async () => {
        // given
        const { drive, fixed } = harness({ gating: "failed" })

        // when
        await drive(RUN, { maxParallel: 2 })

        // then
        expect(fixed.map(action => action.ticket)).toEqual([7])
    })

    it("should give a ticket whose gate is red again after its one fix to the revert service", async () => {
        // given
        const { drive, reverted } = harness({ gating: "failed" })

        // when
        await drive(RUN, { maxParallel: 2 })

        // then
        expect(reverted.map(action => action.ticket)).toEqual([7])
    })

    it("should give a merged ticket to the gate service", async () => {
        // given
        const { drive, gated } = harness()

        // when
        await drive(RUN, { maxParallel: 2 })

        // then
        expect(gated.map(action => action.ticket)).toContain(7)
    })

    it("should give a ticket a step left broken to the prepare service", async () => {
        // given
        const { drive, prepared } = harness({ implementing: { outcome: "failed" } })

        // when
        await drive(RUN, { maxParallel: 2 })

        // then
        expect(prepared).toContainEqual({ kind: "prepare", ticket: 7, brokenStep: "implement" })
    })

    it("should settle a skip by writing it down rather than by dispatching it", async () => {
        // given: an implementer that never succeeds, so #7 spends its budget and #8 can never land
        const { drive, events } = harness({ implementing: { outcome: "failed" } })

        // when
        await drive(RUN, { maxParallel: 2 })

        // then
        expect(events.appended).toContainEqual(expect.objectContaining({ ticket: 8, outcome: "skipped" }))
    })

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
        const { drive, implemented } = harness({ duringImplement: interrupt => interrupt() })

        // when
        await drive(RUN, { maxParallel: 1 })

        // then
        expect(implemented).toHaveLength(1)
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
