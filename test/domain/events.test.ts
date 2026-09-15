import { describe, expect, it } from "vitest"
import {
    attempts,
    type LifecycleEvent,
    type Outcome,
    progressOf,
    readEvent,
    running,
    type Step,
    settled,
    skipped,
    statusOf,
    unattempted,
    verified,
} from "../../src/domain/events.ts"

/**
 * Status is the last event and nothing else, so everything here is a question about a list. Two
 * representations of one fact cannot disagree when there is only ever one (ADR-0011).
 */

const event = (ticket: number, step: Step, outcome: Outcome): LifecycleEvent => ({
    ticket,
    step,
    outcome,
    at: "2026-09-15T11:18:38.314Z",
})

describe("statusOf", () => {
    it("should be the ticket's last event", () => {
        // given
        const events = [event(10, "implement", "running"), event(10, "implement", "ok")]

        // when
        const status = statusOf(events, 10)

        // then
        expect(status?.outcome).toBe("ok")
    })

    it("should ignore another ticket's events", () => {
        // given
        const events = [event(10, "implement", "ok"), event(11, "implement", "failed")]

        // when
        const status = statusOf(events, 10)

        // then
        expect(status?.outcome).toBe("ok")
    })

    it("should be nothing for a ticket the log has never mentioned", () => {
        // given
        const events = [event(11, "implement", "ok")]

        // when
        const status = statusOf(events, 10)

        // then
        expect(status).toBeUndefined()
    })
})

describe("attempts", () => {
    it("should count a step's start events and nothing else", () => {
        // given
        const events = [
            event(10, "implement", "running"),
            event(10, "implement", "failed"),
            event(10, "implement", "running"),
            event(10, "rebase", "running"),
        ]

        // when
        const counted = attempts(events, 10, "implement")

        // then
        expect(counted).toBe(2)
    })

    it("should be zero for a step that has never started", () => {
        // given
        const events = [event(10, "implement", "running")]

        // when
        const counted = attempts(events, 10, "gate")

        // then
        expect(counted).toBe(0)
    })
})

describe("verified", () => {
    it.each([
        ["the gate passed", [event(10, "merge", "ok"), event(10, "gate", "ok")], true],
        ["it is only implemented", [event(10, "implement", "ok")], false],
        ["it is merged but not gated", [event(10, "merge", "ok")], false],
        ["the gate is still running", [event(10, "gate", "running")], false],
        ["the gate went red", [event(10, "gate", "failed")], false],
        ["it was reverted after a green gate", [event(10, "gate", "ok"), event(10, "revert", "ok")], false],
    ] as const)("should say %s", (_name, events, expected) => {
        // given — the events from the table

        // when
        const green = verified(events, 10)

        // then
        expect(green).toBe(expected)
    })
})

describe("settled", () => {
    it.each([
        ["failed", [event(10, "implement", "failed")], true],
        ["skipped", [event(10, "implement", "skipped")], true],
        ["running", [event(10, "implement", "running")], false],
        ["ok", [event(10, "implement", "ok")], false],
        ["never mentioned", [], false],
    ] as const)("should say a ticket that is %s is settled or not", (_name, events, expected) => {
        // given — the events from the table

        // when
        const done = settled(events, 10)

        // then
        expect(done).toBe(expected)
    })
})

describe("progressOf", () => {
    it("should sort the tickets by what their last event says", () => {
        // given
        const events = [
            event(10, "implement", "ok"),
            event(11, "implement", "failed"),
            event(12, "implement", "skipped"),
        ]

        // when
        const progress = progressOf([10, 11, 12], events)

        // then
        expect(progress).toEqual({ implemented: [10], failed: [11], skipped: [12] })
    })
})

describe("readEvent", () => {
    it("should read a line the log wrote", () => {
        // given
        const raw = { ticket: 10, step: "implement", outcome: "ok", at: "2026-09-15T11:18:38.314Z" }

        // when
        const read = readEvent(raw)

        // then
        expect(read).toEqual(raw)
    })

    it.each([
        ["a step nothing recovers from", { ticket: 10, step: "deploy", outcome: "ok", at: "now" }],
        ["an outcome that is not one", { ticket: 10, step: "implement", outcome: "green", at: "now" }],
        ["a ticket that is not an issue number", { ticket: 0, step: "implement", outcome: "ok", at: "now" }],
        ["half a line", { ticket: 10, step: "imple" }],
    ] as const)("should drop %s rather than fail the whole log", (_name, raw) => {
        // given — the line from the table

        // when
        const read = readEvent(raw)

        // then
        expect(read).toBeUndefined()
    })
})

describe("running", () => {
    it.each([
        ["a step that began and never ended", [event(10, "implement", "running")], true],
        ["a step that ended", [event(10, "implement", "running"), event(10, "implement", "ok")], false],
        ["a ticket the log never mentioned", [], false],
    ] as const)("should say %s is running or not", (_name, events, expected) => {
        // given — the events from the table

        // when
        const midStep = running(events, 10)

        // then
        expect(midStep).toBe(expected)
    })
})

describe("unattempted", () => {
    it.each([
        ["a ticket the log never mentioned", [], true],
        ["a ticket something happened to", [event(10, "implement", "running")], false],
        ["a ticket only another ticket's events mention", [event(11, "implement", "ok")], true],
    ] as const)("should say %s is unattempted or not", (_name, events, expected) => {
        // given — the events from the table

        // when
        const untouched = unattempted(events, 10)

        // then
        expect(untouched).toBe(expected)
    })
})

describe("skipped", () => {
    it("should write a skip down against the work that will not happen", () => {
        // given
        const at = new Date("2026-09-15T11:18:38.314Z")

        // when
        const written = skipped(12, at)

        // then
        expect(written).toEqual({
            ticket: 12,
            step: "implement",
            outcome: "skipped",
            at: "2026-09-15T11:18:38.314Z",
            detail: "a ticket it is blocked by will not land",
        })
    })

    it("should settle the ticket it names, so that the skip spreads exactly once", () => {
        // given
        const written = skipped(12, new Date("2026-09-15T11:18:38.314Z"))

        // when
        const done = settled([written], 12)

        // then
        expect(done).toBe(true)
    })
})
