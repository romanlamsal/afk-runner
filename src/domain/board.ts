import {
    brokenStep,
    type Conclusion,
    cameTo,
    implemented,
    type LifecycleEvent,
    MERGE_SIDE_STEPS,
    mergeSideStep,
    type Outcome,
    running,
    type Step,
} from "./events.ts"
import type { Manifest } from "./manifest.ts"

/**
 * The board: the view of a run, derived from the manifest and the event log and from nothing else
 * (ADR-0030). It claims nothing about liveness, so it says what the log says — which is what lets it
 * be drawn by anything that can read the run directory rather than only by the process running it.
 *
 * Nothing here is written down. What the driver holds and the log does not — which of its steps has
 * a process behind it — stays the driver's, because scheduling needs it and a view does not.
 */

/** The two tracks a run is made of, and the two blocks the board is made of (CONTEXT.md). */
export const TRACKS = ["implement", "merge"] as const

export type Track = (typeof TRACKS)[number]

/**
 * The steps each track is made of, and so the trail a row on it carries. The merge track's are the
 * merge-side steps themselves, read from where the schedule reads them, so that the board and the
 * seriality rule can never disagree about what the merge track is.
 *
 * `prepare` is on neither list, and that is the domain's existing rule rather than a new one: a pass
 * is never a step of its own on a row — it is read at the step it was sent to repair.
 */
export const TRACK_STEPS: Record<Track, readonly Step[]> = {
    implement: ["setup", "implement"],
    merge: MERGE_SIDE_STEPS,
}

/**
 * The weights a step is carried at, which is what makes a row answer three questions at once: what
 * has happened to this ticket, what is happening to it now, and what is still ahead of it.
 *
 * There are three of them and not four. Telling a step that is happening from one whose process is
 * gone takes knowledge only the driver holds, so a board with both in its vocabulary would have to
 * guess for every trailing `running` event; `running` states the fact the log states and leaves the
 * rest to whoever is reading (ADR-0030).
 */
export const STEP_STATES = ["settled", "running", "ahead"] as const

export type StepState = (typeof STEP_STATES)[number]

/**
 * What a step ended as. `running` is not one of them, and that is the distinction the board rests
 * on: a step that began is not a step that ended.
 */
export type SettledOutcome = Exclude<Outcome, "running">

/**
 * One step of a row's trail, at the weight that step is read at. A settled step carries what it
 * came to, so that a green step and a red one are different things on the row rather than the same
 * thing with a different word beside it.
 */
export type BoardStep =
    | { step: Step; state: "settled"; outcome: SettledOutcome }
    | { step: Step; state: "running" | "ahead" }

/** One ticket's line. Every ticket of the spec has exactly one, from the first frame to the last. */
export type BoardRow = {
    ticket: number
    /** The issue title as the manifest carries it. Fitting it to a terminal is the frame's job. */
    title: string
    track: Track
    /** The trail across the track's steps, in the order the track takes them. */
    steps: readonly BoardStep[]
    /**
     * A ticket whose implementer reported back, with the merge track yet to take it. It carries no
     * position and the view carries no order, because there is no queue: the run computes only the
     * next one and computes it again every pass, so an order here would assert a sequence the run
     * has not committed to.
     */
    waiting: boolean
    /**
     * What the ticket came to, or nothing where the run has not brought it to anything yet. Read
     * from `cameTo` and never decided again here: the exit code and the pull request's draft flag
     * are read from that same classification, so a second one would let the board say verified
     * while the process said draft (`layers.md`, question 3).
     *
     * It is also where a ticket no repair would help arrives: the driver asks `repairFor` and
     * settles the ticket, and the row reads the conclusion the log then carries (ADR-0030).
     */
    conclusion: Conclusion | undefined
    /**
     * Why the ticket's last settled step came to what it did, where the event carried a reason at
     * all. It is free text and nothing branches on it (ADR-0011): it is here because off a terminal
     * a row is one line and that line is all the operator gets, so a step that failed has to be
     * able to say why on it.
     */
    detail: string | undefined
}

/**
 * A ticket nothing more will happen to, and that will not land. It is the row's marking and not a
 * block of its own: a dead ticket stays at the step it died at — a failed implementer on the
 * implement track, a reverted ticket on the merge track, a skipped ticket on the implement track —
 * which is what keeps the height the ticket count for the whole run.
 *
 * A verified ticket is settled too and is not dead: it stays listed, and that is what makes the
 * last frame the run's summary as well as its last state.
 */
export const dead = (row: BoardRow): boolean => row.conclusion === "failed" || row.conclusion === "skipped"

/**
 * What a run shows while it runs. The row set is the manifest's tickets, so it never grows, never
 * shrinks and never reorders: the board's height is invariant for the whole run.
 */
export type BoardView = {
    rows: readonly BoardRow[]
}

/**
 * Where a view is shown. A driven port: the domain says what it needs, never how — a terminal
 * redraws a block, and off one there is nothing to draw on.
 *
 * Both calls are synchronous, return void and never throw. A terminal write must not be able to
 * fail a run, so an adapter that cannot write swallows it rather than raising through the driver's
 * loop.
 */
export type Board = {
    show: (view: BoardView) => void
    /**
     * A line about the run itself rather than about a ticket — the drain notice, and so far nothing
     * else. The board owns the terminal for the drive's duration, so whatever has something to say
     * to the operator while a run is going says it through here: two writers to one terminal is not
     * a design choice (ADR-0029).
     *
     * It arrives out of the loop's turn — a signal handler is the caller — so an adapter that draws
     * shows it at once rather than waiting for the next frame. Off a terminal there is no frame to
     * tear and the notice keeps its own stream.
     */
    notice: (line: string) => void
}

/**
 * The track a ticket is on: the implement track until a merge-side event has been written about it,
 * and the merge track from then on.
 *
 * It only ever moves the one way, and that falls out of the log being append-only: a merge-side
 * event is never unwritten, so a repair pass or a revert after one leaves the ticket where it is
 * rather than sending it back.
 */
const trackOf = (events: readonly LifecycleEvent[], ticket: number): Track =>
    events.some(event => event.ticket === ticket && mergeSideStep(event.step)) ? "merge" : "implement"

/**
 * What a step last came to for this ticket, or nothing where it has not come to anything. A step
 * that only ever began has settled on nothing, so the trail has nothing to carry for it.
 */
const outcomeAt = (events: readonly LifecycleEvent[], ticket: number, step: Step): SettledOutcome | undefined => {
    const outcome = events.findLast(
        event => event.ticket === ticket && event.step === step && event.outcome !== "running",
    )?.outcome
    return outcome === "running" ? undefined : outcome
}

/**
 * The step the log started for this ticket and has not ended, or nothing where its last event ended.
 * Whether a process is still behind it is not asked and not answerable here (ADR-0030).
 *
 * It is read past a prepare pass, like every other reading of what a run left open: a pass is about
 * the step it was sent to, and that step is the one the trail carries it at (ADR-0012).
 */
const runningStep = (events: readonly LifecycleEvent[], ticket: number): Step | undefined =>
    running(events, ticket) ? brokenStep(events, ticket) : undefined

/**
 * The reason the ticket's last settled event gave, where it gave one. The last settled event rather
 * than the last event that carried a detail: a reason belongs to the step it was written about, so
 * a step that ended saying nothing says nothing rather than inheriting an older step's words.
 */
const detailOf = (events: readonly LifecycleEvent[], ticket: number): string | undefined =>
    events.findLast(event => event.ticket === ticket && event.outcome !== "running")?.detail

/**
 * A row's trail. A step the log started and has not ended is running; a step the log has already
 * settled has happened, and carries what it came to; everything else on the track is still ahead.
 *
 * The remainder of a row picked back up begins at its running step, so the operator reads what a
 * resume is about to do before it does it — and reads the same trail whether the run is alive or
 * long dead.
 */
const trailOf = (
    events: readonly LifecycleEvent[],
    ticket: number,
    track: Track,
    open: Step | undefined,
): readonly BoardStep[] =>
    TRACK_STEPS[track].map((step): BoardStep => {
        if (step === open) {
            return { step, state: "running" }
        }
        const outcome = outcomeAt(events, ticket, step)
        return outcome === undefined ? { step, state: "ahead" } : { step, state: "settled", outcome }
    })

/** The whole view, as a pure function of the manifest and the log. */
export const boardOf = (manifest: Manifest, events: readonly LifecycleEvent[]): BoardView => ({
    rows: manifest.tickets.map(ticket => {
        const track = trackOf(events, ticket.number)
        const open = runningStep(events, ticket.number)

        return {
            ticket: ticket.number,
            title: ticket.title,
            track,
            steps: trailOf(events, ticket.number, track, open),
            waiting: track === "implement" && implemented(events, ticket.number) && open === undefined,
            conclusion: cameTo(events, ticket.number),
            detail: detailOf(events, ticket.number),
        }
    }),
})
