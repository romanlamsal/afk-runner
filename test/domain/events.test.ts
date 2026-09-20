import { describe, expect, it } from "vitest"
import {
    answered,
    attempts,
    brokenStep,
    cameTo,
    cutFrom,
    type LifecycleEvent,
    type Outcome,
    owedAfterRedGate,
    prepared,
    progressOf,
    readEvent,
    readRecord,
    repairableStep,
    running,
    type Step,
    sessionOf,
    settled,
    setUp,
    skipped,
    started,
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

describe("answered", () => {
    it("should count a step's terminal events, and not an attempt nothing ended", () => {
        // given
        const events = [
            event(10, "fix", "running"),
            event(10, "fix", "running"),
            event(10, "fix", "failed"),
            event(10, "gate", "failed"),
        ]

        // when
        const counted = answered(events, 10, "fix")

        // then
        expect(counted).toBe(1)
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

describe("cameTo", () => {
    it.each([
        ["a gate that went green", [event(10, "gate", "ok")], "verified"],
        ["an implementer that reported back", [event(10, "implement", "ok")], "unverified"],
        ["a squash the gate has not run over", [event(10, "merge", "ok")], "unverified"],
        ["a step that failed", [event(10, "implement", "failed")], "failed"],
        ["a revert", [event(10, "revert", "failed")], "failed"],
        ["a red gate a fix is still owed to", [event(10, "gate", "failed")], undefined],
        ["a fix the gate has not run over", [event(10, "fix", "ok")], undefined],
        ["a fix that reported failure", [event(10, "fix", "failed")], undefined],
        [
            "a red gate a revert is still owed to",
            [event(10, "fix", "running"), event(10, "fix", "ok"), event(10, "gate", "failed")],
            undefined,
        ],
        ["a revert a killed run left running", [event(10, "revert", "running")], undefined],
        ["a ticket a blocker took down", [event(10, "implement", "skipped")], "skipped"],
        ["a step that began and never ended", [event(10, "implement", "running")], undefined],
        ["a rebase git stopped part-way", [event(10, "rebase", "conflicted")], undefined],
        ["a ticket the log never mentioned", [], undefined],
    ] as const)("should say %s came to %s", (_name, events, expected) => {
        // given — the events from the table

        // when
        const conclusion = cameTo(events, 10)

        // then
        expect(conclusion).toBe(expected)
    })
})

describe("owedAfterRedGate", () => {
    it.each([
        ["a red gate no fix has answered", [event(10, "gate", "failed")], "fix"],
        ["a red gate after a killed fix", [event(10, "fix", "running"), event(10, "gate", "failed")], "fix"],
        ["a fix a killed run left running", [event(10, "fix", "running")], "fix"],
        ["a fix that reported back", [event(10, "fix", "running"), event(10, "fix", "ok")], "gate"],
        ["a fix that reported failure", [event(10, "fix", "running"), event(10, "fix", "failed")], "gate"],
        [
            "a red gate after an answered fix",
            [event(10, "fix", "running"), event(10, "fix", "failed"), event(10, "gate", "failed")],
            "revert",
        ],
        ["a revert a killed run left running", [event(10, "revert", "running")], "revert"],
        ["a recorded revert", [event(10, "revert", "running"), event(10, "revert", "failed")], undefined],
        ["a green gate", [event(10, "gate", "ok")], undefined],
        ["a ticket the log never mentioned", [], undefined],
    ] as const)("should owe %s a %s", (_name, events, expected) => {
        // given — the events from the table

        // when
        const move = owedAfterRedGate(events, 10)

        // then
        expect(move).toBe(expected)
    })
})

describe("progressOf", () => {
    it("should sort the tickets by what their last event says", () => {
        // given
        const events = [
            event(9, "gate", "ok"),
            event(10, "implement", "ok"),
            event(11, "implement", "failed"),
            event(12, "implement", "skipped"),
        ]

        // when
        const progress = progressOf([9, 10, 11, 12], events)

        // then
        expect(progress).toEqual({ verified: [9], unverified: [10], failed: [11], skipped: [12] })
    })

    it("should count a ticket in the middle of the gate-red sequence as failed nowhere", () => {
        // given: what the exit code and the pull request's draft flag read
        const events = [event(10, "gate", "failed"), event(10, "fix", "running")]

        // when
        const progress = progressOf([10], events)

        // then
        expect(progress).toEqual({ verified: [], unverified: [], failed: [], skipped: [] })
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

/**
 * ADR-0022: setup is a step of its own, and ADR-0024 keeps it out of the steps a prepare pass is
 * sent to — a half-made worktree is thrown away and cut again rather than handed to an agent.
 */
describe("setup as a step", () => {
    it("should never be something a prepare pass is sent to repair", () => {
        // given
        const step = "setup" as const

        // when
        const repairable = repairableStep(step)

        // then
        expect(repairable).toBe(false)
    })

    it.each([
        ["its setup got through", [event(10, "setup", "ok")], true],
        ["its setup failed", [event(10, "setup", "failed")], false],
        ["a killed run left its setup running", [event(10, "setup", "running")], false],
        ["an implementer has been through it since", [event(10, "setup", "ok"), event(10, "implement", "ok")], false],
        ["nothing has happened to it", [], false],
    ] as const)("should call a ticket set up, or not, when %s", (_name, events, expected) => {
        // given — the warm worktree an implementer is handed, and nothing else

        // when
        const warm = setUp(events, 10)

        // then
        expect(warm).toBe(expected)
    })
})

describe("cutFrom", () => {
    const base = (ticket: number, baseSha: string): LifecycleEvent => ({
        ...event(ticket, "setup", "ok"),
        baseSha,
    })

    it("should be the commit the setup that cut the worktree recorded", () => {
        // given
        const events = [base(10, "spec-tip"), event(10, "implement", "running")]

        // when
        const cut = cutFrom(events, 10)

        // then
        expect(cut).toBe("spec-tip")
    })

    it("should be the last one, so that a recut ticket is judged against the worktree it has", () => {
        // given
        const events = [base(10, "an-older-tip"), event(10, "setup", "failed"), base(10, "the-tip-it-has")]

        // when
        const cut = cutFrom(events, 10)

        // then
        expect(cut).toBe("the-tip-it-has")
    })

    it("should be nothing for a ticket no setup has been through", () => {
        // given
        const events = [base(11, "spec-tip")]

        // when
        const cut = cutFrom(events, 10)

        // then
        expect(cut).toBeUndefined()
    })
})

describe("brokenStep", () => {
    it("should be the step the log last mentioned", () => {
        // given
        const events = [event(10, "implement", "ok"), event(10, "rebase", "failed")]

        // when
        const broke = brokenStep(events, 10)

        // then
        expect(broke).toBe("rebase")
    })

    it("should look past a prepare pass, because a pass is never the thing that broke", () => {
        // given
        const events = [event(10, "implement", "failed"), event(10, "prepare", "running")]

        // when
        const broke = brokenStep(events, 10)

        // then
        expect(broke).toBe("implement")
    })

    it("should be nothing for a ticket the log has never mentioned", () => {
        // given
        const events = [event(11, "implement", "failed")]

        // when
        const broke = brokenStep(events, 10)

        // then
        expect(broke).toBeUndefined()
    })
})

describe("prepared", () => {
    it("should name the step a finished pass was sent to", () => {
        // given
        const events = [event(10, "rebase", "failed"), event(10, "prepare", "running"), event(10, "prepare", "ok")]

        // when
        const step = prepared(events, 10)

        // then
        expect(step).toBe("rebase")
    })

    it.each([
        ["the pass is still running", [event(10, "implement", "failed"), event(10, "prepare", "running")]],
        ["the pass failed", [event(10, "implement", "failed"), event(10, "prepare", "failed")]],
        ["nothing was ever prepared", [event(10, "implement", "failed")]],
        [
            "the step the pass bought has already been attempted",
            [event(10, "implement", "failed"), event(10, "prepare", "ok"), event(10, "implement", "running")],
        ],
    ] as const)("should name no step because %s", (_name, events) => {
        // given — the events from the table

        // when
        const step = prepared(events, 10)

        // then
        expect(step).toBeUndefined()
    })
})

describe("sessionOf", () => {
    it("should be the last session the step was given", () => {
        // given — ADR-0017: an id in the log was read out of a stream, so it is a session that exists
        const events = [
            { ...event(10, "implement", "running"), sessionId: "first" },
            event(10, "implement", "failed"),
            { ...event(10, "prepare", "running"), sessionId: "the-pass" },
        ]

        // when
        const session = sessionOf(events, 10, "implement")

        // then
        expect(session).toBe("first")
    })

    it("should be nothing where the step's stream carried no id, so that nothing is resumed", () => {
        // given
        const events = [event(10, "implement", "running"), event(10, "implement", "failed")]

        // when
        const session = sessionOf(events, 10, "implement")

        // then
        expect(session).toBeUndefined()
    })
})

/**
 * The counts an attempt consumed, and nothing priced. ADR-0027: the agent CLI computes a dollar
 * figure locally at list price and it is not a bill, so the log must not carry one — a figure in
 * the log is a figure somebody will later read as spend.
 */
describe("an event's usage", () => {
    const counts = {
        inputTokens: 1600,
        outputTokens: 29700,
        cacheReadInputTokens: 1600000,
        cacheCreationInputTokens: 86500,
    }

    it("should keep the counts an agent step reported", () => {
        // given
        const raw = { ticket: 7, step: "implement", outcome: "ok", at: "2026-09-15T11:18:38.314Z", usage: counts }

        // when
        const read = readEvent(raw)

        // then
        expect(read?.usage).toEqual(counts)
    })

    it("should keep no dollar figure, whatever a writer tried to put in one", () => {
        // given
        const raw = {
            ticket: 7,
            step: "implement",
            outcome: "ok",
            at: "2026-09-15T11:18:38.314Z",
            usage: { ...counts, totalCostUsd: 3.38 },
        }

        // when
        const read = readEvent(raw)

        // then
        expect(read?.usage).not.toHaveProperty("totalCostUsd")
    })

    it("should be absent on a step that ran commands and held no session", () => {
        // given
        const raw = { ticket: 7, step: "merge", outcome: "ok", at: "2026-09-15T11:18:38.314Z" }

        // when
        const read = readEvent(raw)

        // then
        expect(read?.usage).toBeUndefined()
    })
})

/**
 * The one step about the run rather than about one ticket's machine. Its events carry no ticket, and
 * what makes that safe is that every derivation here matches the ticket against a number, so a
 * ticketless event is invisible to all of them (ADR-0028).
 */
describe("a run-level event", () => {
    const opened = {
        step: "pull-request",
        outcome: "ok",
        at: "2026-09-15T11:18:38.314Z",
        usage: { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4 },
    }

    it("should be read without a ticket", () => {
        // given
        const raw = opened

        // when
        const read = readEvent(raw)

        // then
        expect(read?.ticket).toBeUndefined()
    })

    it("should not become any ticket's status", () => {
        // given
        const events = [event(10, "gate", "ok"), readEvent(opened)].flatMap(one => (one === undefined ? [] : [one]))

        // when
        const status = statusOf(events, 10)

        // then
        expect(status?.step).toBe("gate")
    })

    it("should leave a ticket verified that the gate proved before it", () => {
        // given
        const events = [event(10, "gate", "ok"), readEvent(opened)].flatMap(one => (one === undefined ? [] : [one]))

        // when
        const proved = verified(events, 10)

        // then
        expect(proved).toBe(true)
    })

    it("should never be something a prepare pass is sent to repair", () => {
        // given
        const step = "pull-request" as const

        // when
        const repairable = repairableStep(step)

        // then
        expect(repairable).toBe(false)
    })
})

/**
 * The one outcome that is neither an end nor a step still going: git stopped the rebase part-way
 * and said so, which is a fact about the tool rather than about how afk feels about it (ADR-0025).
 */
describe("a conflicted rebase", () => {
    it("should be a line the log reads back", () => {
        // given
        const raw = { ticket: 10, step: "rebase", outcome: "conflicted", at: "2026-09-15T11:18:38.314Z" }

        // when
        const read = readEvent(raw)

        // then
        expect(read).toEqual(raw)
    })

    it.each([
        ["settled", settled],
        ["running", running],
        ["verified", verified],
    ] as const)("should leave the ticket not %s", (_name, derivation) => {
        // given
        const events = [event(10, "implement", "ok"), event(10, "rebase", "running"), event(10, "rebase", "conflicted")]

        // when
        const holds = derivation(events, 10)

        // then
        expect(holds).toBe(false)
    })
})

/**
 * What makes a run an existing one. Not that the log file is there — planning writes a run-level
 * event before any ticket is touched, and `--plan-only` then `--implement-only` must not refuse
 * itself (ADR-0028).
 */
describe("started", () => {
    const plan = { step: "plan" as const, outcome: "ok" as const, at: "2026-09-15T11:18:38.314Z" }
    const opened = { step: "pull-request" as const, outcome: "ok" as const, at: "2026-09-15T11:18:38.314Z" }

    it.each([
        ["not be started for an empty log", [], false],
        ["not be started for a log holding only a plan", [plan], false],
        ["not be started for a log holding only run-level steps", [plan, opened], false],
        ["be started once the log names a ticket", [plan, event(10, "implement", "running")], true],
        [
            "be started for a skip, a ticket nothing attempted being a run all the same",
            [plan, skipped(10, new Date())],
            true,
        ],
    ] as const)("should %s", (_name, events, expected) => {
        // given
        const log: readonly LifecycleEvent[] = events

        // when
        const began = started(log)

        // then
        expect(began).toBe(expected)
    })
})

describe("readRecord", () => {
    it("should read a resumption, which is a run boundary and no lifecycle event", () => {
        // given
        const raw = { boundary: "resumption", at: "2026-09-16T09:00:00.000Z" }

        // when
        const read = readRecord(raw)

        // then
        expect(read).toEqual(raw)
    })

    it("should read a lifecycle event as one", () => {
        // given
        const raw = { ticket: 10, step: "implement", outcome: "ok", at: "2026-09-15T11:18:38.314Z" }

        // when
        const read = readRecord(raw)

        // then
        expect(read).toEqual(raw)
    })

    it.each([
        ["a boundary nothing knows", { boundary: "takeover", at: "now" }],
        ["a boundary with no instant", { boundary: "resumption" }],
    ] as const)("should drop %s rather than fail the whole log", (_name, raw) => {
        // given — the line from the table

        // when
        const read = readRecord(raw)

        // then
        expect(read).toBeUndefined()
    })

    it("should leave a run boundary unread by readEvent, so no derivation of the log sees one", () => {
        // given
        const raw = { boundary: "resumption", at: "2026-09-16T09:00:00.000Z" }

        // when
        const read = readEvent(raw)

        // then
        expect(read).toBeUndefined()
    })
})
