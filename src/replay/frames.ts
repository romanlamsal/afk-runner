import type { LifecycleEvent } from "../domain/events.ts"
import { TICK_MS } from "../service/watch.ts"

/**
 * Replaying an event log as the board it was, and the pure half of it: the moments a replay draws,
 * each one a prefix of the log and the instant the replayed clock stood at, and how long to hold
 * the moment before it.
 *
 * A replay has no time now of its own, so the replayed instant is its clock: it stands at the last
 * instant the log carries and advances between two lines at the speed factor, exactly as the live
 * run's clock advanced through the same gap. That is what makes a row's elapsed figure and its
 * silence the ones the live board showed rather than something recomputed from now (ADR-0034).
 *
 * The board itself is not built here: it is derived from the run directory, and the transcripts and
 * command logs a moment's colour comes from are files somebody has to read.
 */

/** One drawn moment of the replay: what the board is derived from, and what the replay does first. */
export type ReplayMoment = {
    /** The log as of this moment: the board is a function of the whole prefix, never of the last frame. */
    log: readonly LifecycleEvent[]
    /** Where the replayed clock stands, which is what a row's elapsed figure counts to. */
    at: Date
    /** The event the moment is about, and nothing for the edges and for a moment only the clock made. */
    event: LifecycleEvent | undefined
    /** How long to hold before drawing it, in milliseconds of the replay's own time. */
    wait: number
}

/** How fast a replay goes: a wait of its own, or the log's own clock divided down. */
export type Pacing =
    /** The same wait between every pair of frames, whatever the run took. */
    | { kind: "fixed"; ms: number }
    /**
     * The gaps the run actually had, divided by a factor — `60` is a minute of the run per second
     * of the replay. A factor at or below zero is no wait at all, so `--speed 0` is "as fast as it
     * reads".
     */
    | { kind: "real"; factor: number }

/**
 * The instant an event carries, where it carries one a clock can read. `at` is never branched on by
 * the domain and is therefore never validated past being a non-empty string, so a replay that paces
 * itself by it treats an unreadable one as no instant rather than as time zero.
 */
const instantOf = (event: LifecycleEvent): Date | undefined => {
    const at = new Date(event.at)
    return Number.isNaN(at.getTime()) ? undefined : at
}

/**
 * The instant a prefix of the log was drawn at: the last instant it carries a clock can read. A
 * prefix with no readable instant has nothing running to count, so the epoch serves.
 */
const drawnAt = (events: readonly LifecycleEvent[]): Date =>
    events.map(instantOf).findLast(at => at !== undefined) ?? new Date(0)

/** The replay's own time across a gap of the run's: the gap divided, and nothing where there is none. */
const gapOf = (pacing: Pacing, from: Date | undefined, to: Date | undefined): number => {
    if (pacing.kind === "fixed") {
        return Math.max(0, pacing.ms)
    }
    if (from === undefined || to === undefined || pacing.factor <= 0) {
        return 0
    }
    // A log is appended to in order, but it is a file on disk and a clock that went backwards is a
    // machine's business rather than a replay's: the gap is never negative.
    return Math.max(0, (to.getTime() - from.getTime()) / pacing.factor)
}

/**
 * The moments a wait is filled with: the same log again, drawn at the instants the replayed clock
 * passes through on its way to the next line.
 *
 * It is the live watch's tick, replayed. Nothing settles across a gap, so nothing the log says
 * changes — what changes is the clock, and with it how long the running step has been going and
 * whether it has written anything lately. A replay without them would hold a still frame across the
 * very minute the live board spent counting, which is the frame run 1117 was killed over.
 */
const ticksAcross = (log: readonly LifecycleEvent[], from: Date, to: Date, held: number): readonly ReplayMoment[] =>
    // The replayed clock advances by the speed factor, so one tick of the replay is one tick's worth
    // of the run divided down, and the number of them is how many ticks the wait is long — less the
    // one that would land on the next line's own instant, which is the line's moment rather than a
    // tick, and drawing the older log at it would be a frame the live board never showed.
    Array.from({ length: Math.ceil(held / TICK_MS) - 1 }, (_unused, index): ReplayMoment => {
        const through = ((index + 1) * TICK_MS) / held
        return {
            log,
            at: new Date(from.getTime() + (to.getTime() - from.getTime()) * through),
            event: undefined,
            wait: TICK_MS,
        }
    })

/**
 * Every moment a log is, in order: the empty board the run opened on, one moment per line with the
 * clock's own moments between them, and the board the next process would open on.
 *
 * The opening moment is what makes the replay a run rather than a summary — off a terminal the first
 * view is the baseline and news for nothing, so starting anywhere else would swallow whatever had
 * already happened by then.
 *
 * The closing moment is the whole log again with no event beside it: the replay ends on what a
 * resume would open on rather than on the last line's own news.
 */
export const replayMoments = (events: readonly LifecycleEvent[], pacing: Pacing): readonly ReplayMoment[] => {
    const moments: ReplayMoment[] = [{ log: [], at: drawnAt([]), event: undefined, wait: 0 }]

    let previous: Date | undefined
    events.forEach((event, index) => {
        const at = instantOf(event)
        const held = gapOf(pacing, previous, at)
        // Each moment derives from the whole prefix rather than from the one before it, because that
        // is what the board is: a function of the log, never of the last thing drawn (ADR-0030).
        const before = events.slice(0, index)
        const ticks =
            previous === undefined || at === undefined || pacing.kind === "fixed"
                ? []
                : ticksAcross(before, previous, at, held)
        const log = events.slice(0, index + 1)

        moments.push(...ticks, {
            log,
            at: at ?? drawnAt(log),
            event,
            wait: held - ticks.length * TICK_MS,
        })
        previous = at ?? previous
    })

    moments.push({ log: events, at: drawnAt(events), event: undefined, wait: 0 })
    return moments
}
