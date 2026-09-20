import { describe, expect, it } from "vitest"
import type { LifecycleEvent, Outcome, RunBoundary, Step } from "../../src/domain/events.ts"
import { type Pacing, replayMoments } from "../../src/replay/frames.ts"
import { TICK_MS } from "../../src/service/watch.ts"

/**
 * What a replay makes of a log: the moments it draws, and where its clock stands at each of them.
 * The clock is the whole of what is asserted here — what a moment is drawn as is the board's, and
 * the board is tested where it lives.
 */

const at = (minute: number): string => `2026-09-15T11:${`${minute}`.padStart(2, "0")}:00.000Z`

const event = (ticket: number, step: Step, outcome: Outcome, minute = 0): LifecycleEvent => ({
    ticket,
    step,
    outcome,
    at: at(minute),
})

const resumption = (minute: number): RunBoundary => ({ boundary: "resumption", at: at(minute) })

const FIXED: Pacing = { kind: "fixed", ms: 150 }

describe("replayMoments", () => {
    it("should open on the empty log, so that the first line of it is still news", () => {
        // given
        const log = [event(7, "implement", "running")]

        // when
        const moments = replayMoments(log, FIXED)

        // then
        expect(moments.at(0)?.log).toEqual([])
    })

    it("should draw one moment per line of the log, between the two edges", () => {
        // given
        const log = [event(7, "setup", "running"), event(7, "setup", "ok"), event(7, "implement", "running")]

        // when
        const moments = replayMoments(log, FIXED)

        // then
        expect(moments.map(moment => moment.event)).toEqual([undefined, ...log, undefined])
    })

    it("should close on the whole log, which is what a resume would open on", () => {
        // given
        const log = [event(7, "implement", "running")]

        // when
        const moments = replayMoments(log, FIXED)

        // then
        expect(moments.at(-1)?.log).toEqual(log)
    })

    it("should hold every moment but the last live, since a process wrote the line it stands at", () => {
        // given
        const log = [event(7, "setup", "running", 0), event(7, "setup", "ok", 1)]

        // when
        const moments = replayMoments(log, FIXED)

        // then
        expect(moments.slice(0, -1).map(moment => moment.live)).toEqual([true, true, true])
    })

    it("should close on a moment nothing holds, so that what the log left running reads as interrupted", () => {
        // given
        const log = [event(7, "implement", "running")]

        // when
        const moments = replayMoments(log, FIXED)

        // then
        expect(moments.at(-1)?.live).toBe(false)
    })

    it("should stand its clock at the instant the line was written, which is what an elapsed figure counts to", () => {
        // given
        const log = [event(7, "implement", "running", 1), event(8, "setup", "running", 4)]

        // when
        const moments = replayMoments(log, FIXED)

        // then
        expect(moments.at(2)?.at).toEqual(new Date(at(4)))
    })

    it("should stand its clock where it stood for a line whose instant no clock can read", () => {
        // given
        const log: readonly LifecycleEvent[] = [
            event(7, "setup", "running", 3),
            { ticket: 7, step: "setup", outcome: "ok", at: "whenever" },
        ]

        // when
        const moments = replayMoments(log, FIXED)

        // then
        expect(moments.at(2)?.at).toEqual(new Date(at(3)))
    })

    it("should hold the same wait between every pair of moments when it paces itself", () => {
        // given
        const log = [event(7, "setup", "running", 0), event(7, "setup", "ok", 9)]

        // when
        const moments = replayMoments(log, FIXED)

        // then
        expect(moments.map(moment => moment.wait)).toEqual([0, 150, 150, 0])
    })

    it.each([
        ["the run's own gap, divided", 1, 60_000],
        ["a minute of the run per second", 120, 500],
        ["nothing at all, at a factor no time survives", 0, 0],
    ] as const)("should take %s to reach the next line", (_case, factor, expected) => {
        // given
        const log = [event(7, "setup", "running", 0), event(7, "setup", "ok", 1)]

        // when
        const moments = replayMoments(log, { kind: "real", factor })

        // then
        expect(moments.reduce((held, moment) => held + moment.wait, 0)).toBe(expected)
    })

    it("should advance its clock across a gap at the speed factor, as the live board's ticked", () => {
        // given
        const log = [event(7, "implement", "running", 0), event(7, "implement", "ok", 3)]

        // when
        const moments = replayMoments(log, { kind: "real", factor: 60 })

        // then
        expect(moments.map(moment => moment.at)).toEqual([
            new Date(0),
            new Date(at(0)),
            new Date(at(1)),
            new Date(at(2)),
            new Date(at(3)),
            new Date(at(3)),
        ])
    })

    it("should draw the same log at each of those moments, since nothing settled across the gap", () => {
        // given
        const log = [event(7, "implement", "running", 0), event(7, "implement", "ok", 3)]

        // when
        const moments = replayMoments(log, { kind: "real", factor: 60 })

        // then
        expect(moments.slice(2, 4).map(moment => moment.log)).toEqual([[log[0]], [log[0]]])
    })

    it("should advance its clock only with the log when it paces itself, which is no clock of the run's", () => {
        // given
        const log = [event(7, "implement", "running", 0), event(7, "implement", "ok", 30)]

        // when
        const moments = replayMoments(log, FIXED)

        // then
        expect(moments).toHaveLength(4)
    })
})

describe("replayMoments: a resumption", () => {
    // An implementer whose process was killed at minute 0, and a resume half an hour of the run later.
    const killed = event(7, "implement", "running", 0)
    const resumed = event(7, "implement", "running", 31)
    const log = [killed, resumption(30), resumed] as const
    const REAL: Pacing = { kind: "real", factor: 60 }

    it("should draw the gap before it as a moment nothing holds, so the step it left running reads as interrupted", () => {
        // given — the log above

        // when
        const moments = replayMoments(log, REAL)

        // then
        expect(moments.map(moment => moment.live)).toEqual([true, true, false, true, false])
    })

    it("should draw no tick across the gap, which nobody held a step running through", () => {
        // given — the log above

        // when
        const moments = replayMoments(log, REAL)

        // then
        expect(moments).toHaveLength(5)
    })

    it("should hold one beat on the interrupted moment, so that the stop is seen before the resume", () => {
        // given — the log above

        // when
        const moments = replayMoments(log, REAL)

        // then
        expect(moments.at(2)?.wait).toBe(TICK_MS)
    })

    it("should draw the moment with the lifecycle events so far, since it is no event of any ticket", () => {
        // given — the log above

        // when
        const moments = replayMoments(log, REAL)

        // then
        expect(moments.at(2)).toMatchObject({ log: [killed], event: undefined })
    })

    it("should stand its clock on the last instant the log vouches for, since when the process went is unknown", () => {
        // given — the log above

        // when
        const moments = replayMoments(log, REAL)

        // then
        expect(moments.at(2)?.at).toEqual(new Date(at(0)))
    })

    it("should tick from the resumption on, since the process that wrote the next line was alive", () => {
        // given
        const later = event(7, "implement", "ok", 33)

        // when
        const moments = replayMoments([killed, resumption(30), resumed, later], REAL)

        // then
        expect(moments.at(4)?.at).toEqual(new Date(at(32)))
    })

    it("should keep it out of the log a moment draws, for the board is a function of lifecycle events", () => {
        // given — the log above

        // when
        const moments = replayMoments(log, REAL)

        // then
        expect(moments.at(-1)?.log).toEqual([killed, resumed])
    })

    it.each([
        ["a pace of its own", FIXED, 150],
        ["no wait at a factor no time survives", { kind: "real", factor: 0 }, 0],
    ] as const)("should keep to %s for the beat", (_case, pacing, expected) => {
        // given — the log above

        // when
        const moments = replayMoments(log, pacing)

        // then
        expect(moments.at(2)?.wait).toBe(expected)
    })
})
