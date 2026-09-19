import { describe, expect, it } from "vitest"
import {
    type BoardStep,
    boardOf,
    dead,
    type SettledOutcome,
    type StepState,
    type Track,
} from "../../src/domain/board.ts"
import type { LifecycleEvent, Outcome, Step } from "../../src/domain/events.ts"
import { manifestOf, ticket } from "../fixtures/manifest.ts"

/**
 * The board's rules, asserted against the pure function that holds them. No fakes, no fixtures and
 * no git: the inputs are a manifest and a list of events, and the output is the view a frame is
 * drawn from.
 *
 * A run picked back up is asserted here too, because there is nothing else to assert: it is this
 * function called against a log a previous process left behind, and it says the same thing about it
 * as it says about a log its own process is still writing (ADR-0030).
 */

const event = (ticket: number, step: Step, outcome: Outcome): LifecycleEvent => ({
    ticket,
    step,
    outcome,
    at: "2026-09-15T11:18:38.314Z",
})

/** The instant every view here is derived at, unless a test is about the instant. */
const NOW = new Date("2026-09-15T11:19:36.314Z")

const MANIFEST = manifestOf([ticket(7), ticket(8, [7]), ticket(9, [7])])

/** The track a ticket's row sits in, which is the whole of what a row says about it for now. */
const trackOf = (events: readonly LifecycleEvent[], number: number): Track | undefined =>
    boardOf(MANIFEST, events, NOW).rows.find(row => row.ticket === number)?.track

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
        const view = boardOf(MANIFEST, events, NOW)

        // then
        expect(view.rows.map(row => row.ticket)).toEqual([7, 8, 9])
    })

    it("should carry the ticket's title as the manifest has it", () => {
        // given
        const events: readonly LifecycleEvent[] = []

        // when
        const view = boardOf(MANIFEST, events, NOW)

        // then
        expect(view.rows.map(row => row.title)).toEqual(["ticket 7", "ticket 8", "ticket 9"])
    })

    it.each([
        ["a spec nothing has happened to", []],
        ["a ticket mid-step", implemented(7)],
        ["a ticket that failed for good", [event(7, "implement", "failed")]],
        ["a whole spec verified", [...implemented(7), event(7, "gate", "ok")]],
        ["a log fuller of events than the spec has tickets", [7, 8, 9].flatMap(implemented)],
    ] as const)("should have a row for every ticket and nothing else with %s", (_case, events) => {
        // given
        const log = events

        // when
        const view = boardOf(MANIFEST, log, NOW)

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

    it("should keep a ticket on the implement track until a merge-side event is written about it", () => {
        // given: the merge track has been handed the ticket, and has appended nothing about it yet
        const events = implemented(7)

        // when
        const track = trackOf(events, 7)

        // then
        expect(track).toBe("implement")
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
const weightOf = (events: readonly LifecycleEvent[], number: number, step: Step): StepState | undefined =>
    boardOf(MANIFEST, events, NOW)
        .rows.find(row => row.ticket === number)
        ?.steps.find(entry => entry.step === step)?.state

const rowOf = (events: readonly LifecycleEvent[], number: number) =>
    boardOf(MANIFEST, events, NOW).rows.find(row => row.ticket === number)

describe("boardOf: the steps a row covers", () => {
    const EVERY_STEP = ["setup", "implement", "rebase", "resolve", "merge", "gate", "fix", "revert"]

    it.each([
        ["a ticket nothing has happened to", []],
        ["a ticket on the implement track", [event(7, "setup", "ok")]],
        ["a ticket the merge track has taken", [...implemented(7), event(7, "rebase", "running")]],
    ] as const)("should cover every step in order for %s", (_case, events) => {
        // given
        const log = events

        // when
        const row = rowOf(log, 7)

        // then
        expect(row?.steps.map(entry => entry.step)).toEqual(EVERY_STEP)
    })
})

/**
 * The three weights, and the whole of what tells them apart: the log holds an end event for the
 * step, the log holds a start event and no end, or the log holds nothing about it. Nothing here asks
 * whether a process is behind the step, because nothing here could answer it (ADR-0030).
 */
describe("boardOf: what a step is read at", () => {
    it.each([
        ["a step the log has been through", [event(7, "setup", "ok")], "setup" as Step, "settled"],
        ["a step the log has never mentioned", [], "implement" as Step, "ahead"],
        ["a step the log started and has not ended", [event(7, "setup", "running")], "setup" as Step, "running"],
        ["a step still ahead of the one being run", [event(7, "setup", "running")], "implement" as Step, "ahead"],
        [
            "a step the log started again after it broke",
            [event(7, "implement", "failed"), event(7, "prepare", "ok"), event(7, "implement", "running")],
            "implement" as Step,
            "running",
        ],
    ] as const)("should read %s as %s", (_case, events, step, expected) => {
        // given
        const log = events

        // when
        const weight = weightOf(log, 7, step)

        // then
        expect(weight).toBe(expected)
    })

    it("should read a prepare pass at the step it was sent to repair", () => {
        // given: the pass is on the implement track, because that is what it is repairing
        const events = [event(7, "implement", "failed"), event(7, "prepare", "running")]

        // when
        const weight = weightOf(events, 7, "implement")

        // then
        expect(weight).toBe("running")
    })

    it("should read a merge-side prepare pass on the merge track", () => {
        // given
        const events = [...implemented(7), event(7, "merge", "failed"), event(7, "prepare", "running")]

        // when
        const weight = weightOf(events, 7, "merge")

        // then
        expect(weight).toBe("running")
    })

    it("should leave the steps after a repair ahead of it", () => {
        // given
        const events = [...implemented(7), event(7, "merge", "failed"), event(7, "prepare", "running")]

        // when
        const weight = weightOf(events, 7, "gate")

        // then
        expect(weight).toBe("ahead")
    })

    it("should read every step a killed run left open as running", () => {
        // given: a log full of steps a previous process began, with nothing alive to have begun them
        const events = [event(7, "setup", "running"), event(8, "implement", "running")]

        // when
        const view = boardOf(MANIFEST, events, NOW)

        // then
        expect(view.rows.flatMap(row => row.steps).filter(entry => entry.state === "running")).toHaveLength(2)
    })

    it("should give a ticket at most one running step", () => {
        // given: the ticket's whole implement track begun and only its last step left open
        const events = [event(7, "setup", "ok"), event(7, "implement", "running")]

        // when
        const row = rowOf(events, 7)

        // then
        expect(row?.steps.filter(entry => entry.state === "running")).toHaveLength(1)
    })
})

describe("boardOf: a ticket the merge track has not taken yet", () => {
    it("should read an implemented ticket with no unfinished step as waiting", () => {
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
        ["a ticket the merge track is through with", [...implemented(7), event(7, "gate", "ok")]],
    ] as const)("should not read %s as waiting", (_case, events) => {
        // given
        const log = events

        // when
        const row = rowOf(log, 7)

        // then
        expect(row?.waiting).toBe(false)
    })

    it("should tell three waiting tickets apart in no way at all", () => {
        // given: three implemented tickets and no merge-side event, which is the whole of the queue
        const events = [...implemented(7), ...implemented(8), ...implemented(9)]

        // when
        const view = boardOf(MANIFEST, events, NOW)

        // then
        expect(view.rows.map(row => ({ ...row, ticket: 0, title: "" }))).toEqual([
            { ...view.rows[0], ticket: 0, title: "" },
            { ...view.rows[0], ticket: 0, title: "" },
            { ...view.rows[0], ticket: 0, title: "" },
        ])
    })
})

/** What a settled step of a row's trail came to, which is the whole of what a settled step says. */
const outcomeOf = (events: readonly LifecycleEvent[], number: number, step: Step): SettledOutcome | undefined => {
    const entry: BoardStep | undefined = rowOf(events, number)?.steps.find(candidate => candidate.step === step)
    return entry?.state === "settled" ? entry.outcome : undefined
}

describe("boardOf: what a settled step came to", () => {
    it.each([
        ["a step that went green", event(7, "setup", "ok"), "ok"],
        ["a step that broke", event(7, "setup", "failed"), "failed"],
        ["a step that will not happen", event(7, "implement", "skipped"), "skipped"],
    ] as const)("should carry %s as %s", (_case, settling, expected) => {
        // given
        const events = [event(7, settling.step, "running"), settling]

        // when
        const outcome = outcomeOf(events, 7, settling.step)

        // then
        expect(outcome).toBe(expected)
    })

    it("should carry a rebase git stopped part-way as conflicted", () => {
        // given
        const events = [...implemented(7), event(7, "rebase", "running"), event(7, "rebase", "conflicted")]

        // when
        const outcome = outcomeOf(events, 7, "rebase")

        // then
        expect(outcome).toBe("conflicted")
    })

    it("should carry what the last attempt of a step came to", () => {
        // given: a failed implementer, the pass it earned, and the attempt that pass bought
        const events = [
            event(7, "implement", "failed"),
            event(7, "prepare", "ok"),
            event(7, "implement", "running"),
            event(7, "implement", "ok"),
        ]

        // when
        const outcome = outcomeOf(events, 7, "implement")

        // then
        expect(outcome).toBe("ok")
    })

    it("should carry nothing for a step that only ever began", () => {
        // given: what a killed run leaves behind
        const events = [event(7, "setup", "running")]

        // when
        const outcome = outcomeOf(events, 7, "setup")

        // then
        expect(outcome).toBeUndefined()
    })
})

describe("boardOf: a ticket nothing more will happen to", () => {
    it.each([
        ["a ticket whose implementer failed", [event(7, "implement", "failed")], "implement" as Track],
        ["a ticket skipped before it started", [event(7, "implement", "skipped")], "implement" as Track],
        [
            "a ticket taken back off the spec branch",
            [...implemented(7), event(7, "merge", "ok"), event(7, "revert", "failed")],
            "merge" as Track,
        ],
    ] as const)("should leave %s dead on the %s track", (_case, events, track) => {
        // given
        const log = events

        // when
        const row = rowOf(log, 7)

        // then
        expect(row && { track: row.track, dead: dead(row) }).toEqual({ track, dead: true })
    })

    it("should leave a dead ticket at the step it died at", () => {
        // given
        const events = [...implemented(7), event(7, "merge", "ok"), event(7, "revert", "failed")]

        // when
        const outcome = outcomeOf(events, 7, "revert")

        // then
        expect(outcome).toBe("failed")
    })

    it("should not read a verified ticket as dead", () => {
        // given
        const events = [...implemented(7), event(7, "merge", "ok"), event(7, "gate", "ok")]

        // when
        const row = rowOf(events, 7)

        // then
        expect(row && dead(row)).toBe(false)
    })

    it.each([
        ["a red gate a fix is still owed to", [event(7, "gate", "failed")]],
        ["a fix at work on a red gate", [event(7, "gate", "failed"), event(7, "fix", "running")]],
        [
            "a red gate a revert is still owed to",
            [event(7, "gate", "failed"), event(7, "fix", "ok"), event(7, "gate", "failed")],
        ],
        ["a revert a killed run left running", [event(7, "gate", "failed"), event(7, "revert", "running")]],
    ] as const)("should not read %s as dead", (_case, events) => {
        // given
        const log = [...implemented(7), event(7, "merge", "ok"), ...events]

        // when
        const row = rowOf(log, 7)

        // then
        expect(row && dead(row)).toBe(false)
    })

    it("should keep a verified ticket listed", () => {
        // given: the whole spec worked through, which is the frame the run is left looking at
        const events = [7, 8, 9].flatMap(number => [...implemented(number), event(number, "gate", "ok")])

        // when
        const view = boardOf(MANIFEST, events, NOW)

        // then
        expect(view.rows.map(row => row.ticket)).toEqual([7, 8, 9])
    })
})

describe("boardOf: what a ticket came to", () => {
    it.each([
        ["a ticket nothing has happened to", [], undefined],
        ["a ticket mid-step", [event(7, "implement", "running")], undefined],
        ["a ticket the gate proved", [...implemented(7), event(7, "gate", "ok")], "verified"],
        ["a ticket a step got through", implemented(7), "unverified"],
        ["a ticket whose implementer failed", [event(7, "implement", "failed")], "failed"],
        ["a ticket blocked by one that will not land", [event(7, "implement", "skipped")], "skipped"],
    ] as const)("should read %s as %s", (_case, events, expected) => {
        // given
        const log = events

        // when
        const row = rowOf(log, 7)

        // then
        expect(row?.conclusion).toBe(expected)
    })
})

/**
 * The view's whole vocabulary, asserted as a shape rather than a field at a time: what a second
 * process rendering this has to understand, and the list `beyond repair` is no longer on.
 */
describe("boardOf: what a row is made of", () => {
    it("should carry exactly the row's fields and nothing beside them", () => {
        // given
        const events = [...implemented(7), event(7, "gate", "failed"), event(7, "revert", "running")]

        // when
        const row = rowOf(events, 7)

        // then
        expect(Object.keys(row ?? {}).sort()).toEqual([
            "conclusion",
            "detail",
            "elapsed",
            "steps",
            "ticket",
            "title",
            "track",
            "waiting",
        ])
    })
})

describe("boardOf: why a step came to what it did", () => {
    /** An event that ended with something to say about how it ended. */
    const explained = (step: Step, outcome: Outcome, detail: string): LifecycleEvent => ({
        ...event(7, step, outcome),
        detail,
    })

    it("should carry the reason the last settled step gave", () => {
        // given
        const events = [event(7, "implement", "running"), explained("implement", "failed", "the budget ran out")]

        // when
        const row = rowOf(events, 7)

        // then
        expect(row?.detail).toBe("the budget ran out")
    })

    it("should carry no reason where the last settled step gave none", () => {
        // given
        const events = [explained("setup", "failed", "the setup command exited 1"), ...implemented(7)]

        // when
        const row = rowOf(events, 7)

        // then
        expect(row?.detail).toBeUndefined()
    })

    it("should carry the settled step's reason rather than a running step's", () => {
        // given
        const events = [explained("implement", "failed", "the budget ran out"), event(7, "prepare", "running")]

        // when
        const row = rowOf(events, 7)

        // then
        expect(row?.detail).toBe("the budget ran out")
    })
})

/**
 * How long a row's running step has been going: from its start event to the instant the view is
 * derived at, and nothing on a row with nothing running (ADR-0034).
 */
describe("boardOf: how long the running step has been going", () => {
    const started = (step: Step, when: string): LifecycleEvent => ({ ...event(7, step, "running"), at: when })

    it.each([
        ["an implementer started 58 seconds ago", [started("implement", "2026-09-15T11:18:38.314Z")], 58_000],
        [
            "a fix started after its gate went red",
            [...implemented(7), event(7, "gate", "failed"), started("fix", "2026-09-15T11:19:26.314Z")],
            10_000,
        ],
        [
            "a prepare pass, timed from its own start",
            [event(7, "implement", "failed"), started("prepare", "2026-09-15T11:19:35.314Z")],
            1_000,
        ],
        ["a start the clock reads as later than now", [started("implement", "2026-09-15T12:00:00.000Z")], 0],
    ] as const)("should count %s", (_case, events, elapsed) => {
        // given
        const log = events

        // when
        const row = rowOf(log, 7)

        // then
        expect(row?.elapsed).toBe(elapsed)
    })

    it.each([
        ["nothing has happened to", []],
        ["settled its last step", implemented(7)],
        ["concluded", [...implemented(7), event(7, "gate", "ok")]],
        ["started at an instant no clock reads", [started("implement", "not a time")]],
    ] as const)("should count nothing for a ticket that %s", (_case, events) => {
        // given
        const log = events

        // when
        const row = rowOf(log, 7)

        // then
        expect(row?.elapsed).toBeUndefined()
    })

    it("should count to the instant it is handed rather than to a clock", () => {
        // given
        const events = [started("implement", "2026-09-15T10:00:00.000Z")]

        // when
        const view = boardOf(MANIFEST, events, new Date("2026-09-15T10:20:00.000Z"))

        // then
        expect(view.rows[0]?.elapsed).toBe(20 * 60_000)
    })
})

/**
 * When the last thing happened is read off the log's last event rather than from the instant the
 * view is derived at: it is the log's time, never the time now.
 */
describe("boardOf: when the last thing happened", () => {
    /** An event that says when it happened, which is the only thing these cases turn on. */
    const at = (when: string): LifecycleEvent => ({ ...event(7, "implement", "running"), at: when })

    it("should carry the timestamp of the log's most recent event", () => {
        // given
        const events = [at("2026-09-15T11:18:38.314Z"), at("2026-09-15T11:42:07.001Z")]

        // when
        const view = boardOf(MANIFEST, events, NOW)

        // then
        expect(view.at).toBe("2026-09-15T11:42:07.001Z")
    })

    it("should carry nothing where the log holds no event", () => {
        // given
        const events: readonly LifecycleEvent[] = []

        // when
        const view = boardOf(MANIFEST, events, NOW)

        // then
        expect(view.at).toBeUndefined()
    })

    it("should carry the last event's own timestamp rather than a reading of the clock", () => {
        // given: a log whose last event is an hour old, read now
        const events = [at("2026-09-15T10:00:00.000Z")]

        // when
        const view = boardOf(MANIFEST, events, NOW)

        // then
        expect(view.at).toBe("2026-09-15T10:00:00.000Z")
    })

    it("should say the same thing about the same log however often it is read", () => {
        // given
        const events = [at("2026-09-15T10:00:00.000Z"), at("2026-09-15T10:00:04.000Z")]

        // when
        const views = [boardOf(MANIFEST, events, NOW), boardOf(MANIFEST, events, NOW)]

        // then
        expect(views.map(view => view.at)).toEqual(["2026-09-15T10:00:04.000Z", "2026-09-15T10:00:04.000Z"])
    })
})
