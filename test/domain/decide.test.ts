import { describe, expect, it } from "vitest"
import { type Action, nextActions, type RunParameters } from "../../src/domain/decide.ts"
import type { LifecycleEvent, Outcome, Step } from "../../src/domain/events.ts"
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

/** A ticket the gate has passed: the only thing that puts a blocker behind its dependents. */
const verified = (number: number): readonly LifecycleEvent[] => [
    event(number, "implement", "ok"),
    event(number, "gate", "ok"),
]

const decide = (
    tickets: readonly Ticket[],
    events: readonly LifecycleEvent[] = [],
    parameters: Partial<RunParameters> = {},
): readonly Action[] =>
    nextActions(manifestOf(tickets), events, { inFlight: [], maxParallel: 3, draining: false, ...parameters })

const implementing = (ticket: number, attempt = 1): Action => ({ kind: "implement", ticket, attempt })

const merging = (ticket: number, attempt = 1): Action => ({ kind: "merge", ticket, attempt })

describe("nextActions: the slate", () => {
    it("should start a ticket nothing blocks", () => {
        // given
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets)

        // then
        expect(actions).toEqual([implementing(10)])
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
        expect(actions).toEqual([implementing(12)])
    })

    it("should not wait for a blocker the manifest does not list, because it is not this run's work", () => {
        // given
        const tickets = [ticket(12, [99])]

        // when
        const actions = decide(tickets)

        // then
        expect(actions).toEqual([implementing(12)])
    })

    it("should hand out the most-blocking ticket first when there is one slot", () => {
        // given
        const tickets = [ticket(10), ticket(11), ticket(12, [11])]

        // when
        const actions = decide(tickets, [], { maxParallel: 1 })

        // then
        expect(actions).toEqual([implementing(11)])
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
        expect(actions).toEqual([implementing(11)])
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

        // then
        expect(actions).toEqual([{ kind: "finish" }])
    })
})

describe("nextActions: attempts", () => {
    it("should number the first attempt one", () => {
        // given
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets)

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

    it("should take a merged ticket back into the merge track, so that its gate still runs", () => {
        // given — what a run killed between a squash and its gate leaves behind (ADR-0008)
        const tickets = [ticket(10)]

        // when
        const actions = decide(tickets, [event(10, "implement", "ok"), event(10, "merge", "ok")])

        // then
        expect(actions).toEqual([merging(10)])
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
        expect(actions).toEqual([implementing(11)])
    })

    it("should skip rather than merge a ticket whose blocker died while it was being implemented", () => {
        // given
        const tickets = [ticket(11), ticket(12, [11])]
        const events = [event(11, "implement", "failed"), event(12, "implement", "ok")]

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
        const actions = decide(tickets, [event(11, "implement", "failed")])

        // then
        expect(actions).toEqual([{ kind: "skip", ticket: 12 }])
    })

    it("should skip a whole subtree, not only what the failure directly blocks", () => {
        // given
        const tickets = [ticket(11), ticket(12, [11]), ticket(13, [12]), ticket(14, [13])]

        // when
        const actions = decide(tickets, [event(11, "implement", "failed")])

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
        const actions = decide(tickets, [event(11, "implement", "failed"), event(12, "implement", "skipped")])

        // then
        expect(actions).toEqual([{ kind: "skip", ticket: 13 }])
    })

    it("should leave a ticket alone when only one of its blockers failed and the other is fine", () => {
        // given — 13 is doomed by 11 whatever 12 does, and 10 is blocked by neither
        const tickets = [ticket(10), ticket(11), ticket(12), ticket(13, [11, 12])]

        // when
        const actions = decide(tickets, [...verified(10), ...verified(12), event(11, "implement", "failed")])

        // then
        expect(actions).toEqual([{ kind: "skip", ticket: 13 }])
    })

    it("should let a dependent already in flight finish rather than skip it out from under its implementer", () => {
        // given
        const tickets = [ticket(11), ticket(12, [11])]

        // when
        const actions = decide(tickets, [event(11, "implement", "failed")], { inFlight: [implementing(12)] })

        // then
        expect(actions).toEqual([])
    })

    it("should never skip a ticket twice, because the first skip settles it", () => {
        // given
        const tickets = [ticket(11), ticket(12, [11])]

        // when
        const actions = decide(tickets, [event(11, "implement", "failed"), event(12, "implement", "skipped")])

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
        const actions = decide(tickets, [event(11, "implement", "failed")], { draining: true })

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
