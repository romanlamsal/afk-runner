import { describe, expect, it } from "vitest"
import { boardOf, type Track } from "../../src/domain/board.ts"
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
