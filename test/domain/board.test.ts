import { describe, expect, it } from "vitest"
import { boardOf, type StepState, type Track } from "../../src/domain/board.ts"
import type { Action } from "../../src/domain/decide.ts"
import type { LifecycleEvent, Outcome, Step } from "../../src/domain/events.ts"
import { manifestOf, ticket } from "../fixtures/manifest.ts"

/**
 * The board's rules, asserted against the pure function that holds them. No fakes, no fixtures and
 * no git: the inputs are a manifest, a list of events and the driver's live action set, and the
 * output is the view a frame is drawn from.
 *
 * A resumed run is asserted here too, because there is nothing else to assert: it is this function
 * called against a log a previous process left behind.
 */

const event = (ticket: number, step: Step, outcome: Outcome): LifecycleEvent => ({
    ticket,
    step,
    outcome,
    at: "2026-09-15T11:18:38.314Z",
})

const MANIFEST = manifestOf([ticket(7), ticket(8, [7]), ticket(9, [7])])

/** The track a ticket's row sits in, which is the whole of what a row says about it for now. */
const trackOf = (
    events: readonly LifecycleEvent[],
    number: number,
    inFlight: readonly Action[] = [],
): Track | undefined => boardOf(MANIFEST, events, inFlight).rows.find(row => row.ticket === number)?.track

/** A ticket whose implementer reported back: everything the merge track draws from starts here. */
const implemented = (number: number): readonly LifecycleEvent[] => [
    event(number, "implement", "running"),
    event(number, "implement", "ok"),
]

describe("boardOf: the rows", () => {
    it("should give every ticket of the spec exactly one row", () => {
        // given
        const events = [...implemented(7), event(7, "rebase", "running")]

        // when
        const view = boardOf(MANIFEST, events, [])

        // then
        expect(view.rows.map(row => row.ticket)).toEqual([7, 8, 9])
    })

    it("should carry the ticket's title as the manifest has it", () => {
        // given
        const events: readonly LifecycleEvent[] = []

        // when
        const view = boardOf(MANIFEST, events, [])

        // then
        expect(view.rows.map(row => row.title)).toEqual(["ticket 7", "ticket 8", "ticket 9"])
    })

    it.each([
        ["a spec nothing has happened to", []],
        ["a ticket mid-step", implemented(7)],
        ["a ticket that failed for good", [event(7, "implement", "failed")]],
        ["a whole spec verified", [...implemented(7), event(7, "gate", "ok")]],
    ] as const)("should have a row for every ticket and nothing else with %s", (_case, events) => {
        // given
        const log = events

        // when
        const view = boardOf(MANIFEST, log, [])

        // then
        expect(view.rows).toHaveLength(MANIFEST.tickets.length)
    })
})

describe("boardOf: which track a ticket is on", () => {
    it.each([
        ["a ticket the log has never mentioned", [], "implement"],
        ["a ticket being set up", [event(7, "setup", "running")], "implement"],
        ["a ticket with an implementer on it", [event(7, "implement", "running")], "implement"],
        ["a ticket whose implementer failed", [event(7, "implement", "failed")], "implement"],
        ["a ticket skipped before it started", [event(7, "implement", "skipped")], "implement"],
        ["a ticket implemented and waiting for the merge track", implemented(7), "implement"],
        ["a ticket being rebased", [...implemented(7), event(7, "rebase", "running")], "merge"],
        ["a ticket whose rebase git stopped part-way", [...implemented(7), event(7, "rebase", "conflicted")], "merge"],
        ["a ticket on the spec branch", [...implemented(7), event(7, "merge", "ok")], "merge"],
        ["a verified ticket", [...implemented(7), event(7, "gate", "ok")], "merge"],
        ["a ticket taken back off the spec branch", [...implemented(7), event(7, "revert", "failed")], "merge"],
    ] as const)("should put %s on the %s track", (_case, events, expected) => {
        // given
        const log = events

        // when
        const track = trackOf(log, 7)

        // then
        expect(track).toBe(expected)
    })

    it("should put a ticket the merge track has just been handed on the merge track", () => {
        // given: the action is live before the step that records it has appended anything
        const events = implemented(7)
        const inFlight: readonly Action[] = [{ kind: "rebase", ticket: 7 }]

        // when
        const track = trackOf(events, 7, inFlight)

        // then
        expect(track).toBe("merge")
    })

    it("should keep a ticket on the merge track once a repair pass is on it", () => {
        // given: a squash that broke, and the pass it earned — which is not a merge-side step
        const events = [...implemented(7), event(7, "merge", "failed"), event(7, "prepare", "running")]

        // when
        const track = trackOf(events, 7)

        // then
        expect(track).toBe("merge")
    })
})

/** The weight one step of a ticket's trail is read at, which is the whole of what a trail says. */
const weightOf = (
    events: readonly LifecycleEvent[],
    number: number,
    step: Step,
    inFlight: readonly Action[] = [],
): StepState | undefined =>
    boardOf(MANIFEST, events, inFlight)
        .rows.find(row => row.ticket === number)
        ?.steps.find(entry => entry.step === step)?.state

const rowOf = (events: readonly LifecycleEvent[], number: number, inFlight: readonly Action[] = []) =>
    boardOf(MANIFEST, events, inFlight).rows.find(row => row.ticket === number)

describe("boardOf: the steps a row covers", () => {
    it("should cover setup and implement on the implement track", () => {
        // given
        const events: readonly LifecycleEvent[] = []

        // when
        const row = rowOf(events, 7)

        // then
        expect(row?.steps.map(entry => entry.step)).toEqual(["setup", "implement"])
    })

    it("should cover the merge-side steps on the merge track", () => {
        // given
        const events = [...implemented(7), event(7, "rebase", "running")]

        // when
        const row = rowOf(events, 7)

        // then
        expect(row?.steps.map(entry => entry.step)).toEqual(["rebase", "resolve", "merge", "gate", "fix", "revert"])
    })
})

describe("boardOf: what a step is read at", () => {
    it.each([
        ["a step the log has been through", [event(7, "setup", "ok")], "setup" as Step, [], "settled"],
        ["a step the log has never mentioned", [], "implement" as Step, [], "ahead"],
        [
            "the step the driver is running",
            [event(7, "setup", "running")],
            "setup" as Step,
            [{ kind: "setup", ticket: 7 }] as const,
            "live",
        ],
        [
            "a step still ahead of the one being run",
            [event(7, "setup", "running")],
            "implement" as Step,
            [{ kind: "setup", ticket: 7 }] as const,
            "ahead",
        ],
    ] as const)("should read %s as %s", (_case, events, step, inFlight, expected) => {
        // given
        const log = events

        // when
        const weight = weightOf(log, 7, step, inFlight)

        // then
        expect(weight).toBe(expected)
    })

    it("should read a prepare pass at the step it was sent to repair", () => {
        // given: the pass is on the implement track, because that is what it is repairing
        const events = [event(7, "implement", "failed"), event(7, "prepare", "running")]
        const inFlight: readonly Action[] = [{ kind: "prepare", ticket: 7, brokenStep: "implement" }]

        // when
        const weight = weightOf(events, 7, "implement", inFlight)

        // then
        expect(weight).toBe("live")
    })

    it("should read a merge-side prepare pass on the merge track", () => {
        // given
        const events = [...implemented(7), event(7, "merge", "failed"), event(7, "prepare", "running")]
        const inFlight: readonly Action[] = [{ kind: "prepare", ticket: 7, brokenStep: "merge" }]

        // when
        const weight = weightOf(events, 7, "merge", inFlight)

        // then
        expect(weight).toBe("live")
    })

    it("should give at most one ticket a live step on the merge track", () => {
        // given: the merge track is serial, so the live action set holds one of its actions at most
        const events = [...implemented(7), ...implemented(8)]
        const inFlight: readonly Action[] = [{ kind: "rebase", ticket: 7 }]

        // when
        const view = boardOf(MANIFEST, events, inFlight)

        // then
        expect(
            view.rows.filter(row => row.track === "merge" && row.steps.some(entry => entry.state === "live")),
        ).toHaveLength(1)
    })
})

describe("boardOf: a ticket the merge track has not taken yet", () => {
    it("should read an implemented ticket as waiting", () => {
        // given
        const events = implemented(7)

        // when
        const row = rowOf(events, 7)

        // then
        expect(row?.waiting).toBe(true)
    })

    it.each([
        ["a ticket nothing has happened to", []],
        ["a ticket being implemented", [event(7, "implement", "running")]],
        ["a ticket the merge track has taken", [...implemented(7), event(7, "rebase", "running")]],
    ] as const)("should not read %s as waiting", (_case, events) => {
        // given
        const log = events

        // when
        const row = rowOf(log, 7)

        // then
        expect(row?.waiting).toBe(false)
    })

    it("should tell three waiting tickets apart in no way at all", () => {
        // given: three implemented tickets and no merge-side action, which is the whole of the queue
        const events = [...implemented(7), ...implemented(8), ...implemented(9)]

        // when
        const view = boardOf(MANIFEST, events, [])

        // then
        expect(view.rows.map(row => ({ ...row, ticket: 0, title: "" }))).toEqual([
            { ...view.rows[0], ticket: 0, title: "" },
            { ...view.rows[0], ticket: 0, title: "" },
            { ...view.rows[0], ticket: 0, title: "" },
        ])
    })
})
