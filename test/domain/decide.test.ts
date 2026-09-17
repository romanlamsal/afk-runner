import { describe, expect, it } from "vitest"
import { type Action, nextActions, type RunParameters } from "../../src/domain/decide.ts"
import type { BrokenStep, LifecycleEvent, Outcome, Step } from "../../src/domain/events.ts"
import type { Ticket } from "../../src/domain/manifest.ts"
import { manifestOf, ticket } from "../fixtures/manifest.ts"

/**
 * Every scheduling rule afk has, asserted against the pure function that holds them. No fakes, no
 * fixtures and no git: inputs are a manifest and a list of events, and the output is a list of
 * actions.
 *
 * Resume is asserted here too, because there is nothing else to assert: a resumed run is this
 * function called against a non-empty log.
 */

const event = (ticket: number, step: Step, outcome: Outcome): LifecycleEvent => ({
    ticket,
    step,
    outcome,
    at: "2026-09-15T11:18:38.314Z",
})

/** A ticket whose setup got through: the worktree is cut and an implementer is what it wants next. */
const cut = (number: number): readonly LifecycleEvent[] => [
    event(number, "setup", "running"),
    event(number, "setup", "ok"),
]

/** A ticket the gate has passed: the only thing that puts a blocker behind its dependents. */
const verified = (number: number): readonly LifecycleEvent[] => [
    event(number, "implement", "ok"),
    event(number, "gate", "ok"),
]

/**
 * A ticket that has spent everything it gets: an implementer that failed, the prepare pass that
 * earned it, and the one more attempt that failed as well (ADR-0012).
 */
const failed = (number: number): readonly LifecycleEvent[] => [
    event(number, "implement", "running"),
    event(number, "implement", "failed"),
    event(number, "prepare", "running"),
    event(number, "prepare", "ok"),
    event(number, "implement", "running"),
    event(number, "implement", "failed"),
]

const decide = (
    tickets: readonly Ticket[],
    events: readonly LifecycleEvent[] = [],
    parameters: Partial<RunParameters> = {},
): readonly Action[] =>
    nextActions(manifestOf(tickets), events, { inFlight: [], maxParallel: 3, draining: false, ...parameters })

const settingUp = (ticket: number): Action => ({ kind: "setup", ticket })

const implementing = (ticket: number, attempt = 1): Action => ({ kind: "implement", ticket, attempt })

const merging = (ticket: number, attempt = 1): Action => ({ kind: "merge", ticket, attempt })

const gating = (ticket: number): Action => ({ kind: "gate", ticket })

const preparing = (ticket: number, brokenStep: BrokenStep): Action => ({ kind: "prepare", ticket, brokenStep })

describe("nextActions: the slate", () => {
    it("should start a ticket nothing blocks", () => {
        // given
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets)

        // then
        expect(actions).toEqual([settingUp(10)])
    })

    it.each([
        ["nothing has happened to it", []],
        ["it is only implemented", [event(11, "implement", "ok")]],
        ["it is merged but not gated", [event(11, "implement", "ok"), event(11, "merge", "ok")]],
        ["its gate is still running", [event(11, "merge", "ok"), event(11, "gate", "running")]],
    ] as const)("should hold a ticket back while its blocker is unverified because %s", (_name, events) => {
        // given
        const tickets = [ticket(11), ticket(12, [11])]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions.some(action => "ticket" in action && action.ticket === 12)).toBe(false)
    })

    it("should start a ticket once its every blocker is verified", () => {
        // given
        const tickets = [ticket(11), ticket(12, [11])]

        // when
        const actions = decide(tickets, verified(11))

        // then
        expect(actions).toEqual([settingUp(12)])
    })

    it("should not wait for a blocker the manifest does not list, because it is not this run's work", () => {
        // given
        const tickets = [ticket(12, [99])]

        // when
        const actions = decide(tickets)

        // then
        expect(actions).toEqual([settingUp(12)])
    })

    it("should hand out the most-blocking ticket first when there is one slot", () => {
        // given
        const tickets = [ticket(10), ticket(11), ticket(12, [11])]

        // when
        const actions = decide(tickets, [], { maxParallel: 1 })

        // then
        expect(actions).toEqual([settingUp(11)])
    })

    it("should never hand out more tickets than there are slots", () => {
        // given
        const tickets = [ticket(10), ticket(11), ticket(12)]

        // when
        const actions = decide(tickets, [], { maxParallel: 2 })

        // then
        expect(actions).toHaveLength(2)
    })

    it("should count what is already in flight against the slots", () => {
        // given
        const tickets = [ticket(10), ticket(11), ticket(12)]

        // when
        const actions = decide(tickets, [], { maxParallel: 2, inFlight: [implementing(10)] })

        // then
        expect(actions).toEqual([settingUp(11)])
    })

    it("should never hand out a ticket that is already in flight", () => {
        // given
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, [], { inFlight: [implementing(10)] })

        // then
        expect(actions).toEqual([])
    })

    it("should never re-start a ticket the log says something already happened to", () => {
        // given — a run killed mid-implement, so the process is gone but the event is not
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, [event(10, "implement", "running")])

        // then — a pass over what it left behind, never a second implementer beside it
        expect(actions).toEqual([preparing(10, "implement")])
    })
})

describe("nextActions: attempts", () => {
    it("should number the first attempt one", () => {
        // given
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, cut(10))

        // then
        expect(actions).toEqual([implementing(10, 1)])
    })

    it("should number a rebase attempt from the rebases the log already carries", () => {
        // given
        const tickets = [ticket(10)]
        const events = [event(10, "rebase", "running"), event(10, "rebase", "failed"), event(10, "implement", "ok")]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([merging(10, 2)])
    })
})

describe("nextActions: the merge track", () => {
    it("should take an implemented ticket into the merge track", () => {
        // given
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, [event(10, "implement", "ok")])

        // then
        expect(actions).toEqual([merging(10)])
    })

    it("should gate a merged ticket, because the gate follows every merge without exception", () => {
        // given — what a run killed between a squash and its gate leaves behind (ADR-0008)
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, [event(10, "implement", "ok"), event(10, "merge", "ok")])

        // then
        expect(actions).toEqual([gating(10)])
    })

    it("should never gate a ticket twice, because the gate is what makes it verified", () => {
        // given
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, [event(10, "merge", "ok"), event(10, "gate", "ok")])

        // then
        expect(actions).toEqual([{ kind: "finish" }])
    })

    it.each([
        ["a gate", gating(11)],
        ["a merge", merging(11)],
    ] as const)("should start no second merge-side action while %s is in flight", (_name, flying) => {
        // given: #10 is waiting for the merge track while #11 already has it
        const tickets = [ticket(10), ticket(11)]
        const events = [event(10, "implement", "ok"), event(11, "merge", "ok")]

        // when
        const actions = decide(tickets, events, { inFlight: [flying] })

        // then
        expect(actions).toEqual([])
    })

    it("should keep handing out implementers while a ticket is being gated", () => {
        // given
        const tickets = [ticket(10), ticket(11)]

        // when
        const actions = decide(tickets, [...cut(10), event(11, "merge", "ok")], { inFlight: [gating(11)] })

        // then
        expect(actions).toEqual([implementing(10)])
    })

    it.each([
        ["it is still being implemented", [event(10, "implement", "running")]],
        ["its rebase already landed", [event(10, "implement", "ok"), event(10, "rebase", "ok")]],
        ["its rebase failed", [event(10, "implement", "ok"), event(10, "rebase", "failed")]],
        ["it is verified", [event(10, "implement", "ok"), event(10, "gate", "ok")]],
    ] as const)("should leave a ticket out of the merge track because %s", (_name, events) => {
        // given
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions.some(action => action.kind === "merge")).toBe(false)
    })

    it("should never merge two tickets at once, because one worktree owns the spec branch", () => {
        // given
        const tickets = [ticket(10), ticket(11)]
        const events = [event(10, "implement", "ok"), event(11, "implement", "ok")]

        // when
        const actions = decide(tickets, events, { inFlight: [merging(10)] })

        // then
        expect(actions.filter(action => action.kind === "merge")).toEqual([])
    })

    it("should merge the most-blocking ticket first, so that the slate moves soonest", () => {
        // given
        const tickets = [ticket(10), ticket(11), ticket(12, [11])]
        const events = [event(10, "implement", "ok"), event(11, "implement", "ok")]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions.filter(action => action.kind === "merge")).toEqual([merging(11)])
    })

    it("should keep handing out implementers while a ticket is in the merge track", () => {
        // given
        const tickets = [ticket(10), ticket(11)]

        // when
        const actions = decide(tickets, [event(10, "implement", "ok")], { inFlight: [merging(10)] })

        // then
        expect(actions).toEqual([settingUp(11)])
    })

    it("should skip rather than merge a ticket whose blocker died while it was being implemented", () => {
        // given
        const tickets = [ticket(11), ticket(12, [11])]
        const events = [...failed(11), event(12, "implement", "ok")]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([{ kind: "skip", ticket: 12 }])
    })

    it("should skip rather than merge a ticket whose blocker was reverted while it was being implemented", () => {
        // given — ADR-0010: the implementer's time is spent, but the tree it built on is gone
        const tickets = [ticket(11), ticket(12, [11])]
        const events = [event(11, "gate", "failed"), event(11, "revert", "failed"), event(12, "implement", "ok")]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([{ kind: "skip", ticket: 12 }])
    })

    it("should never take a reverted ticket back into the merge track, because its merge is undone", () => {
        // given
        const tickets = [ticket(11)]
        const events = [event(11, "merge", "ok"), event(11, "gate", "failed"), event(11, "revert", "failed")]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([{ kind: "finish" }])
    })

    it("should start no merge once the run is draining", () => {
        // given
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, [event(10, "implement", "ok")], { draining: true })

        // then
        expect(actions).toEqual([{ kind: "finish" }])
    })
})

describe("nextActions: the transitive skip", () => {
    it("should skip a ticket whose blocker failed", () => {
        // given
        const tickets = [ticket(11), ticket(12, [11])]

        // when
        const actions = decide(tickets, failed(11))

        // then
        expect(actions).toEqual([{ kind: "skip", ticket: 12 }])
    })

    it("should skip a whole subtree, not only what the failure directly blocks", () => {
        // given
        const tickets = [ticket(11), ticket(12, [11]), ticket(13, [12]), ticket(14, [13])]

        // when
        const actions = decide(tickets, failed(11))

        // then
        expect(actions).toEqual([
            { kind: "skip", ticket: 12 },
            { kind: "skip", ticket: 13 },
            { kind: "skip", ticket: 14 },
        ])
    })

    it("should skip a ticket blocked by a skipped one, so the skip spreads through the log", () => {
        // given
        const tickets = [ticket(11), ticket(12, [11]), ticket(13, [12])]

        // when
        const actions = decide(tickets, [...failed(11), event(12, "implement", "skipped")])

        // then
        expect(actions).toEqual([{ kind: "skip", ticket: 13 }])
    })

    it("should leave a ticket alone when only one of its blockers failed and the other is fine", () => {
        // given — 13 is doomed by 11 whatever 12 does, and 10 is blocked by neither
        const tickets = [ticket(10), ticket(11), ticket(12), ticket(13, [11, 12])]

        // when
        const actions = decide(tickets, [...verified(10), ...verified(12), ...failed(11)])

        // then
        expect(actions).toEqual([{ kind: "skip", ticket: 13 }])
    })

    it("should let a dependent already in flight finish rather than skip it out from under its implementer", () => {
        // given
        const tickets = [ticket(11), ticket(12, [11])]

        // when
        const actions = decide(tickets, failed(11), { inFlight: [implementing(12)] })

        // then
        expect(actions).toEqual([])
    })

    it("should never skip a ticket twice, because the first skip settles it", () => {
        // given
        const tickets = [ticket(11), ticket(12, [11])]

        // when
        const actions = decide(tickets, [...failed(11), event(12, "implement", "skipped")])

        // then
        expect(actions).toEqual([{ kind: "finish" }])
    })
})

describe("nextActions: draining", () => {
    it("should start nothing new once the run is draining", () => {
        // given
        const tickets = [ticket(10), ticket(11)]

        // when
        const actions = decide(tickets, [], { draining: true, inFlight: [implementing(10)] })

        // then
        expect(actions).toEqual([])
    })

    it("should still gate a merge a draining run has already made, because the gate has no exception", () => {
        // given
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, [event(10, "merge", "ok")], { draining: true })

        // then
        expect(actions).toEqual([gating(10)])
    })

    it("should finish once the last in-flight action of a draining run has settled", () => {
        // given
        const tickets = [ticket(10), ticket(11)]

        // when
        const actions = decide(tickets, [], { draining: true })

        // then
        expect(actions).toEqual([{ kind: "finish" }])
    })

    it("should not skip a doomed ticket while draining, because a drain records only what it started", () => {
        // given
        const tickets = [ticket(11), ticket(12, [11])]

        // when
        const actions = decide(tickets, failed(11), { draining: true })

        // then
        expect(actions).toEqual([{ kind: "finish" }])
    })
})

describe("nextActions: finishing", () => {
    it("should finish when every ticket is verified", () => {
        // given
        const tickets = [ticket(10), ticket(11)]

        // when
        const actions = decide(tickets, [...verified(10), ...verified(11)])

        // then
        expect(actions).toEqual([{ kind: "finish" }])
    })

    it("should not finish while something is still in flight", () => {
        // given
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, [], { inFlight: [implementing(10)] })

        // then
        expect(actions).toEqual([])
    })
})

describe("nextActions: a step whose process is gone", () => {
    it.each([
        ["implement", [event(10, "implement", "running")], "implement"],
        ["rebase", [event(10, "implement", "ok"), event(10, "rebase", "running")], "rebase"],
        [
            "resolve",
            [event(10, "implement", "ok"), event(10, "rebase", "running"), event(10, "resolve", "running")],
            "resolve",
        ],
        ["merge", [event(10, "rebase", "ok"), event(10, "merge", "running")], "merge"],
        ["gate", [event(10, "merge", "ok"), event(10, "gate", "running")], "gate"],
    ] as const)("should prepare a ticket a killed run left mid-%s", (_name, events, brokenStep) => {
        // given — the live action set is empty, which is what it is on a resumed run's first tick
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([preparing(10, brokenStep)])
    })

    it("should recognise every stale step on the first tick, because resume is no mode of its own", () => {
        // given — ADR-0019: one run killed with three tickets part-way through three different steps
        const tickets = [ticket(10), ticket(11), ticket(12)]
        const events = [
            event(10, "implement", "running"),
            event(11, "implement", "ok"),
            event(11, "rebase", "running"),
            event(12, "implement", "running"),
        ]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([preparing(11, "rebase"), preparing(10, "implement"), preparing(12, "implement")])
    })

    it("should leave a running step alone while the driver says it is running", () => {
        // given — the same log, and the one thing that tells the two apart (ADR-0019)
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, [event(10, "implement", "running")], { inFlight: [implementing(10)] })

        // then
        expect(actions).toEqual([])
    })

    it("should prepare a ticket a killed run left at a conflicted rebase, instructed by the rebase", () => {
        // given — git stopped the rebase part-way and the run that was going to resolve it is gone
        const tickets = [ticket(10)]
        const events = [event(10, "implement", "ok"), event(10, "rebase", "running"), event(10, "rebase", "conflicted")]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([preparing(10, "rebase")])
    })

    it("should leave a conflicted rebase alone while the merge action that will resolve it is live", () => {
        // given — the same log, and the live action set that tells a stopped run from a running one
        const tickets = [ticket(10)]
        const events = [event(10, "implement", "ok"), event(10, "rebase", "running"), event(10, "rebase", "conflicted")]

        // when
        const actions = decide(tickets, events, { inFlight: [merging(10)] })

        // then
        expect(actions).toEqual([])
    })

    it("should doom nothing over a conflicted rebase, because a conflict is no ticket's end", () => {
        // given — a killed run's ticket stopped at a conflict, and a dependent of it
        const tickets = [ticket(10), ticket(11, [10])]
        const events = [event(10, "implement", "ok"), event(10, "rebase", "running"), event(10, "rebase", "conflicted")]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).not.toContainEqual({ kind: "skip", ticket: 11 })
    })

    it("should send a prepare pass a killed run left running to the step underneath it", () => {
        // given
        const tickets = [ticket(10)]
        const events = [event(10, "implement", "failed"), event(10, "prepare", "running")]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([preparing(10, "implement")])
    })

    it("should never prepare a ticket a killed run left mid-revert, because its merge was on its way off", () => {
        // given — ADR-0009: putting back a ticket that was being reverted is what recovery must not do
        const tickets = [ticket(10)]
        const events = [event(10, "merge", "ok"), event(10, "gate", "failed"), event(10, "revert", "running")]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([{ kind: "finish" }])
    })

    it("should skip the dependents of a ticket a killed run left mid-revert", () => {
        // given
        const tickets = [ticket(11), ticket(12, [11])]
        const events = [event(11, "merge", "ok"), event(11, "gate", "failed"), event(11, "revert", "running")]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([{ kind: "skip", ticket: 12 }])
    })
})

describe("nextActions: one prepare pass and one more attempt", () => {
    it.each([
        ["the agent reported a failure", "`npm run check` failed"],
        ["it timed out", "timed out after 60m"],
        ["nothing was committed", "#10 committed nothing on afk/4/t10"],
    ] as const)("should prepare a failed implementer, whatever it was that failed: %s", (_name, detail) => {
        // given — ADR-0012: failures are not classified into ones worth a pass and ones that are not
        const tickets = [ticket(10)]
        const events = [event(10, "implement", "running"), { ...event(10, "implement", "failed"), detail }]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([preparing(10, "implement")])
    })

    it("should attempt the implementer once more after the pass", () => {
        // given
        const tickets = [ticket(10)]
        const events = [
            event(10, "implement", "running"),
            event(10, "implement", "failed"),
            event(10, "prepare", "running"),
            event(10, "prepare", "ok"),
        ]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([implementing(10, 2)])
    })

    it("should fail a ticket for good once the attempt the pass bought has failed as well", () => {
        // given
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, failed(10))

        // then
        expect(actions).toEqual([{ kind: "finish" }])
    })

    it("should skip the dependents of a ticket that spent its pass and its last attempt", () => {
        // given
        const tickets = [ticket(11), ticket(12, [11])]

        // when
        const actions = decide(tickets, failed(11))

        // then
        expect(actions).toEqual([{ kind: "skip", ticket: 12 }])
    })

    it("should count an attempt a killed run left behind, because afk cannot know how far it got", () => {
        // given — a first attempt nothing ended, its pass, and a second attempt that did fail
        const tickets = [ticket(10)]
        const events = [
            event(10, "implement", "running"),
            event(10, "prepare", "running"),
            event(10, "prepare", "ok"),
            event(10, "implement", "running"),
            event(10, "implement", "failed"),
        ]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([{ kind: "finish" }])
    })

    it("should still prepare a step a killed run left running once the budget is spent", () => {
        // given — an interrupted run must be able to pick its own work back up either way
        const tickets = [ticket(10)]
        const events = [
            event(10, "implement", "running"),
            event(10, "implement", "failed"),
            event(10, "prepare", "running"),
            event(10, "prepare", "ok"),
            event(10, "implement", "running"),
        ]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([preparing(10, "implement")])
    })

    it("should never prepare a ticket whose prepare pass itself failed", () => {
        // given
        const tickets = [ticket(10)]
        const events = [
            event(10, "implement", "running"),
            event(10, "implement", "failed"),
            event(10, "prepare", "running"),
            event(10, "prepare", "failed"),
        ]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([{ kind: "finish" }])
    })

    it("should never prepare a ticket whose blocker is dead, because no pass can make it landable", () => {
        // given
        const tickets = [ticket(11), ticket(12, [11])]
        const events = [...failed(11), event(12, "implement", "running"), event(12, "implement", "failed")]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([{ kind: "skip", ticket: 12 }])
    })

    it("should spend an implementer slot on a prepare pass, because the ticket is still being worked", () => {
        // given
        const tickets = [ticket(10), ticket(11)]
        const events = [event(10, "implement", "running"), event(10, "implement", "failed")]

        // when
        const actions = decide(tickets, events, { maxParallel: 1 })

        // then
        expect(actions).toEqual([preparing(10, "implement")])
    })

    it("should start nothing new once the run is draining, a prepare pass included", () => {
        // given
        const tickets = [ticket(10)]
        const events = [event(10, "implement", "running"), event(10, "implement", "failed")]

        // when
        const actions = decide(tickets, events, { draining: true })

        // then
        expect(actions).toEqual([{ kind: "finish" }])
    })
})

describe("nextActions: recovering the merge track", () => {
    it.each([
        ["rebase", [event(10, "implement", "ok"), event(10, "rebase", "running"), event(10, "rebase", "failed")]],
        ["resolve", [event(10, "implement", "ok"), event(10, "rebase", "running"), event(10, "resolve", "failed")]],
    ] as const)("should prepare a ticket whose %s failed", (brokenStep, events) => {
        // given
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([preparing(10, brokenStep)])
    })

    it("should take a prepared ticket back into the merge track rather than re-implement it", () => {
        // given
        const tickets = [ticket(10)]
        const events = [
            event(10, "implement", "ok"),
            event(10, "rebase", "running"),
            event(10, "rebase", "failed"),
            event(10, "prepare", "running"),
            event(10, "prepare", "ok"),
        ]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([merging(10, 2)])
    })

    it("should gate a ticket the pass was sent to a killed gate for, rather than merge it again", () => {
        // given
        const tickets = [ticket(10)]
        const events = [
            event(10, "merge", "ok"),
            event(10, "gate", "running"),
            event(10, "prepare", "running"),
            event(10, "prepare", "ok"),
        ]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([gating(10)])
    })

    it("should fail a ticket for good once the merge track attempt the pass bought has failed too", () => {
        // given
        const tickets = [ticket(10)]
        const events = [
            event(10, "implement", "ok"),
            event(10, "rebase", "running"),
            event(10, "rebase", "failed"),
            event(10, "prepare", "running"),
            event(10, "prepare", "ok"),
            event(10, "rebase", "running"),
            event(10, "rebase", "failed"),
        ]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([{ kind: "finish" }])
    })

    it("should never prepare the merge track while a merge is in flight, because one worktree owns the branch", () => {
        // given
        const tickets = [ticket(10), ticket(11)]
        const events = [event(10, "implement", "ok"), event(11, "implement", "ok"), event(11, "rebase", "failed")]

        // when
        const actions = decide(tickets, events, { inFlight: [merging(10)] })

        // then
        expect(actions).toEqual([])
    })

    it("should never merge while the merge track's own prepare pass is in flight", () => {
        // given
        const tickets = [ticket(10), ticket(11)]
        const events = [event(10, "implement", "ok"), event(11, "implement", "ok"), event(11, "rebase", "failed")]

        // when
        const actions = decide(tickets, events, { inFlight: [preparing(11, "rebase")] })

        // then
        expect(actions.some(action => action.kind === "merge")).toBe(false)
    })

    it("should keep handing out implementers while the merge track is being prepared", () => {
        // given
        const tickets = [ticket(10), ticket(11)]
        const events = [event(11, "implement", "ok"), event(11, "rebase", "failed")]

        // when
        const actions = decide(tickets, events, { inFlight: [preparing(11, "rebase")] })

        // then
        expect(actions).toEqual([settingUp(10)])
    })
})

/**
 * ADR-0022 and ADR-0024: setup is a step of its own and an action of its own, it is never repaired,
 * and it carries a budget of its own — the attempt and one more, counted off its own start events.
 */
describe("nextActions: setup", () => {
    /** A setup that got somewhere and stopped, and one a killed run left with no end event at all. */
    const broke = (number: number, outcome: "failed" | "running"): readonly LifecycleEvent[] => [
        event(number, "setup", "running"),
        ...(outcome === "failed" ? [event(number, "setup", "failed")] : []),
    ]

    /** A ticket that has spent both its setups: the first broke, the recut broke too. */
    const spent = (number: number): readonly LifecycleEvent[] => [
        ...broke(number, "failed"),
        ...broke(number, "failed"),
    ]

    it("should set a ticket up before it is implemented, so that its claim is inside a recorded step", () => {
        // given
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets)

        // then
        expect(actions).toEqual([settingUp(10)])
    })

    it("should give a ticket whose setup got through an implementer rather than another setup", () => {
        // given — ADR-0022: a run killed at `setup: ok` keeps its warm worktree
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, cut(10))

        // then
        expect(actions).toEqual([implementing(10, 1)])
    })

    it.each([
        ["failed", "failed"],
        ["a killed run left running", "running"],
    ] as const)("should cut a setup that %s again, within its own budget", (_name, outcome) => {
        // given
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, broke(10, outcome))

        // then
        expect(actions).toEqual([settingUp(10)])
    })

    it.each([
        ["failed", "failed"],
        ["a killed run left running", "running"],
    ] as const)("should never send a prepare pass to a setup that %s", (_name, outcome) => {
        // given — ADR-0024: a half-made worktree is thrown away, never handed to an agent
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, broke(10, outcome))

        // then
        expect(actions.some(action => action.kind === "prepare")).toBe(false)
    })

    it("should count a killed setup against the budget, because the recut is the repair", () => {
        // given — one setup that failed and one a second kill left running: both attempts are spent
        const tickets = [ticket(10)]
        const events = [...broke(10, "failed"), ...broke(10, "running")]

        // when
        const actions = decide(tickets, events)

        // then
        expect(actions).toEqual([{ kind: "finish" }])
    })

    it("should fail a ticket for good once its setup budget is spent", () => {
        // given
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, spent(10))

        // then
        expect(actions).toEqual([{ kind: "finish" }])
    })

    it("should skip the dependents of a ticket that spent its setup budget, transitively", () => {
        // given
        const tickets = [ticket(11), ticket(12, [11]), ticket(13, [12])]

        // when
        const actions = decide(tickets, spent(11))

        // then
        expect(actions).toEqual([
            { kind: "skip", ticket: 12 },
            { kind: "skip", ticket: 13 },
        ])
    })

    it("should spend an implementer slot on a setup, because the ticket is being worked", () => {
        // given
        const tickets = [ticket(10), ticket(11)]

        // when
        const actions = decide(tickets, [], { maxParallel: 1 })

        // then
        expect(actions).toHaveLength(1)
    })

    it("should leave a setup the driver says is running alone", () => {
        // given — ADR-0019: a `running` event is a killed step only once the live action set says so
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, broke(10, "running"), { inFlight: [settingUp(10)] })

        // then
        expect(actions).toEqual([])
    })

    it("should start no setup once the run is draining", () => {
        // given
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, [], { draining: true })

        // then
        expect(actions).toEqual([{ kind: "finish" }])
    })

    it("should hold a ticket's setup back until its every blocker is verified, as it holds its implementer", () => {
        // given
        const tickets = [ticket(11), ticket(12, [11])]

        // when
        const actions = decide(tickets, [event(11, "implement", "ok")])

        // then
        expect(actions.some(action => action.kind === "setup" && action.ticket === 12)).toBe(false)
    })
})
