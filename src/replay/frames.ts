import { isRunBoundary, type LifecycleEvent, type LogRecord } from "../domain/events.ts"
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
    /** Whether a process held the run at this moment, which is what tells a running step from a dead one. */
    live: boolean
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
const instantOf = (event: LogRecord): Date | undefined => {
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

/** The beat an interrupted board is held for: the pace's own, and nothing at a pace that waits for nothing. */
const beatOf = (pacing: Pacing): number =>
    pacing.kind === "fixed" ? Math.max(0, pacing.ms) : pacing.factor <= 0 ? 0 : TICK_MS

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
            live: true,
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
 *
 * Liveness is the one thing a replay knows for certain rather than has to read: every moment but the
 * last stands at an instant a process was alive to have written the log's last line at, so its open
 * steps were running then. The closing moment is the exception, and it is the whole reason it exists
 * — the run has stopped, nothing holds it, and what it left running reads as interrupted, which is
 * what a resume opens on (ADR-0034).
 */
export const replayMoments = (records: readonly LogRecord[], pacing: Pacing): readonly ReplayMoment[] => {
    const moments: ReplayMoment[] = [{ log: [], at: drawnAt([]), event: undefined, live: true, wait: 0 }]

    // What the board is derived from: a run boundary is no lifecycle event and no derivation of the
    // log sees one, so a moment's prefix carries the events alone (ADR-0036).
    const events: LifecycleEvent[] = []

    let previous: Date | undefined
    records.forEach(record => {
        const at = instantOf(record)

        if (isRunBoundary(record)) {
            // The process that held the run is gone, and the log knows nothing of when: the clock
            // stays on the last instant it can vouch for and nothing is ticked across the gap, which
            // is a day the run did not spend. One beat holds the interrupted board before the resume
            // picks up (ADR-0036).
            moments.push({ log: [...events], at: drawnAt(events), event: undefined, live: false, wait: beatOf(pacing) })
            previous = at ?? previous
            return
        }

        const held = gapOf(pacing, previous, at)
        // Each moment derives from the whole prefix rather than from the one before it, because that
        // is what the board is: a function of the log, never of the last thing drawn (ADR-0030).
        const before = [...events]
        const ticks =
            previous === undefined || at === undefined || pacing.kind === "fixed"
                ? []
                : ticksAcross(before, previous, at, held)
        events.push(record)

        moments.push(...ticks, {
            log: [...events],
            at: at ?? drawnAt(events),
            event: record,
            live: true,
            wait: held - ticks.length * TICK_MS,
        })
        previous = at ?? previous
    })

    moments.push({ log: [...events], at: drawnAt(events), event: undefined, live: false, wait: 0 })
    return moments
}
