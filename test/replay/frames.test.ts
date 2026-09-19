import { describe, expect, it } from "vitest"
import type { StepState } from "../../src/domain/board.ts"
import type { LifecycleEvent, Outcome, Step } from "../../src/domain/events.ts"
import { liveActions, type Pacing, type ReplayFrame, replayFrames, waitBefore } from "../../src/replay/frames.ts"
import { manifestOf, ticket } from "../fixtures/manifest.ts"

/**
 * What a replay makes of a log. The reconstruction of the live action set is the whole of what is
 * asserted here: everything else a frame carries is the board's, and the board is tested where it
 * lives.
 */

const at = (minute: number): string => `2026-09-15T11:${`${minute}`.padStart(2, "0")}:00.000Z`

const event = (ticket: number, step: Step, outcome: Outcome, minute = 0): LifecycleEvent => ({
    ticket,
    step,
    outcome,
    at: at(minute),
})

const MANIFEST = manifestOf([ticket(7), ticket(8, [7])])

/** How the last frame of a log reads a ticket's step, which is what the reconstruction decides. */
const stateAt = (events: readonly LifecycleEvent[], number: number, step: Step): StepState | undefined => {
    const frames = replayFrames(MANIFEST, events)
    const view = frames.at(-2)?.view
    return view?.rows.find(row => row.ticket === number)?.steps.find(entry => entry.step === step)?.state
}

const frame = (minute: number | undefined): ReplayFrame => ({
    view: { rows: [], at: undefined },
    event: undefined,
    at: minute === undefined ? undefined : new Date(at(minute)),
})

describe("liveActions", () => {
    it.each([
        ["setup", [event(7, "setup", "running")], { kind: "setup", ticket: 7 }],
        ["implement", [event(7, "implement", "running")], { kind: "implement", ticket: 7, attempt: 1 }],
        ["rebase", [event(7, "rebase", "running")], { kind: "rebase", ticket: 7 }],
        ["merge", [event(7, "merge", "running")], { kind: "merge", ticket: 7 }],
        ["gate", [event(7, "gate", "running")], { kind: "gate", ticket: 7 }],
        ["fix", [event(7, "fix", "running")], { kind: "fix", ticket: 7 }],
        ["revert", [event(7, "revert", "running")], { kind: "revert", ticket: 7 }],
        [
            "resolve, counted off the rebase it belongs to",
            [event(7, "rebase", "running"), event(7, "rebase", "conflicted"), event(7, "resolve", "running")],
            { kind: "resolve", ticket: 7, attempt: 1 },
        ],
        [
            "prepare, at the step it was sent to repair",
            [event(7, "implement", "running"), event(7, "implement", "failed"), event(7, "prepare", "running")],
            { kind: "prepare", ticket: 7, brokenStep: "implement" },
        ],
    ] as const)("should hold the action the driver held for a running %s", (_case, events, action) => {
        // given
        const log = events

        // when
        const live = liveActions(MANIFEST, log)

        // then
        expect(live).toEqual([action])
    })

    it("should hold nothing for a step the log has already ended", () => {
        // given
        const log = [event(7, "implement", "running"), event(7, "implement", "ok")]

        // when
        const live = liveActions(MANIFEST, log)

        // then
        expect(live).toEqual([])
    })

    it("should hold nothing for a run-level step, which no action of the driver's names", () => {
        // given
        const log: readonly LifecycleEvent[] = [{ step: "plan", outcome: "running", at: at(0) }]

        // when
        const live = liveActions(MANIFEST, log)

        // then
        expect(live).toEqual([])
    })
})

describe("replayFrames", () => {
    it("should open on the empty board, so that the first line of the log is still news", () => {
        // given
        const log = [event(7, "implement", "running")]

        // when
        const frames = replayFrames(MANIFEST, log)

        // then
        expect(frames.at(0)?.view.rows.every(row => row.steps.every(step => step.state === "ahead"))).toBe(true)
    })

    it("should draw one frame per line of the log, between the two edges", () => {
        // given
        const log = [event(7, "setup", "running"), event(7, "setup", "ok"), event(7, "implement", "running")]

        // when
        const frames = replayFrames(MANIFEST, log)

        // then
        expect(frames.map(one => one.event)).toEqual([undefined, ...log, undefined])
    })

    it("should read a step the log left running as running while the log goes on", () => {
        // given
        const log = [event(7, "implement", "running")]

        // when
        const state = stateAt(log, 7, "implement")

        // then
        expect(state).toBe("running")
    })

    it("should close on the board the whole log comes to", () => {
        // given
        const log = [event(7, "implement", "running")]

        // when
        const frames = replayFrames(MANIFEST, log)

        // then
        expect(frames.at(-1)?.view).toEqual(frames.at(-2)?.view)
    })

    it("should count a running step's elapsed time to the instant each line was written", () => {
        // given
        const log = [event(7, "implement", "running", 1), event(8, "setup", "running", 4)]

        // when
        const frames = replayFrames(MANIFEST, log)

        // then
        expect(frames.at(2)?.view.rows.map(row => row.elapsed)).toEqual([3 * 60_000, 0])
    })

    it("should carry the instant each event was appended at", () => {
        // given
        const log = [event(7, "setup", "running", 3)]

        // when
        const frames = replayFrames(MANIFEST, log)

        // then
        expect(frames.at(1)?.at).toEqual(new Date(at(3)))
    })

    it("should carry no instant for an event whose timestamp no clock can read", () => {
        // given
        const log: readonly LifecycleEvent[] = [{ ticket: 7, step: "setup", outcome: "running", at: "whenever" }]

        // when
        const frames = replayFrames(MANIFEST, log)

        // then
        expect(frames.at(1)?.at).toBeUndefined()
    })
})

describe("waitBefore", () => {
    it("should hold nothing before the first frame, which nothing precedes", () => {
        // given
        const pacing: Pacing = { kind: "fixed", ms: 150 }

        // when
        const held = waitBefore(pacing, undefined, frame(0))

        // then
        expect(held).toBe(0)
    })

    it("should hold the same wait between every pair of frames when it paces itself", () => {
        // given
        const pacing: Pacing = { kind: "fixed", ms: 150 }

        // when
        const held = waitBefore(pacing, frame(0), frame(9))

        // then
        expect(held).toBe(150)
    })

    it.each([
        ["the run's own gap, divided", 1, 60_000],
        ["a minute of the run per second", 60, 1_000],
        ["nothing at all, at a factor no time survives", 0, 0],
    ] as const)("should hold %s", (_case, factor, expected) => {
        // given
        const pacing: Pacing = { kind: "real", factor }

        // when
        const held = waitBefore(pacing, frame(0), frame(1))

        // then
        expect(held).toBe(expected)
    })

    it("should hold nothing across a frame the log gave no instant for", () => {
        // given
        const pacing: Pacing = { kind: "real", factor: 1 }

        // when
        const held = waitBefore(pacing, frame(0), frame(undefined))

        // then
        expect(held).toBe(0)
    })
})
