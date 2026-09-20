import { describe, expect, it } from "vitest"
import type { LifecycleEvent, Outcome, Step } from "../../src/domain/events.ts"
import { type Pacing, replayMoments } from "../../src/replay/frames.ts"

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
