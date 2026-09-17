import { type Action, onMergeTrack } from "./decide.ts"
import { implemented, type LifecycleEvent, MERGE_SIDE_STEPS, mergeSideStep, type Step } from "./events.ts"
import type { Manifest } from "./manifest.ts"

/**
 * The board: the live view of a run, derived from the manifest, the event log **and** the driver's
 * live action set — the same three inputs `nextActions` takes, which is what makes this the second
 * pure function of them (ADR-0029).
 *
 * Nothing here is written down. Liveness is not recordable, so the board is observed rather than
 * recorded and afk keeps no watcher of its own.
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
 * is never a step of its own on a row — it is read at the step it was sent to repair, which is the
 * step `onMergeTrack` already routes it by.
 */
export const TRACK_STEPS: Record<Track, readonly Step[]> = {
    implement: ["setup", "implement"],
    merge: MERGE_SIDE_STEPS,
}

/**
 * The three weights a step is carried at, which is what makes a row answer three questions at once:
 * what has happened to this ticket, what is happening to it now, and what is still ahead of it.
 */
export const STEP_STATES = ["settled", "live", "ahead"] as const

export type StepState = (typeof STEP_STATES)[number]

/** One step of a row's trail, at the weight that step is read at. */
export type BoardStep = {
    step: Step
    state: StepState
}

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
}

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
 * `show` is synchronous, returns void and never throws. A terminal write must not be able to fail a
 * run, so an adapter that cannot write swallows it rather than raising through the driver's loop.
 */
export type Board = {
    show: (view: BoardView) => void
}

/**
 * The track a ticket is on: the implement track until a merge-side step has happened to it or is
 * happening to it, and the merge track from then on.
 *
 * It only ever moves the one way, and that falls out of the log being append-only: a merge-side
 * event is never unwritten, so a repair pass or a revert after one leaves the ticket where it is
 * rather than sending it back. The live action set is read too, so the ticket the merge track has
 * just been handed is already there in the frame that announces it.
 */
const trackOf = (events: readonly LifecycleEvent[], inFlight: readonly Action[], ticket: number): Track =>
    events.some(event => event.ticket === ticket && mergeSideStep(event.step)) ||
    inFlight.some(action => "ticket" in action && action.ticket === ticket && onMergeTrack(action))
        ? "merge"
        : "implement"

/**
 * The step of a ticket's the driver is running now, or nothing where it is running none of them.
 *
 * A prepare pass is read at the step it was sent to repair rather than as a step of its own, which
 * is why it needs no rule here: `brokenStep` is on the ticket's track already.
 */
const stepOf = (action: Action): Step | undefined => {
    switch (action.kind) {
        case "prepare":
            return action.brokenStep
        case "skip":
        case "finish":
            return undefined
        default:
            return action.kind
    }
}

const liveStep = (inFlight: readonly Action[], ticket: number): Step | undefined =>
    inFlight
        .flatMap(action => ("ticket" in action && action.ticket === ticket ? [stepOf(action)] : []))
        .find(step => step !== undefined)

/**
 * A row's trail. A step the driver is running now is live; a step the log has already mentioned has
 * happened; everything else on the track is still ahead.
 *
 * Live is read from the live action set and never from the log, because a `running` event is only a
 * step that is *happening* while the driver says so (ADR-0019).
 */
const trailOf = (
    events: readonly LifecycleEvent[],
    ticket: number,
    track: Track,
    live: Step | undefined,
): readonly BoardStep[] =>
    TRACK_STEPS[track].map(step => ({
        step,
        state:
            step === live
                ? "live"
                : events.some(event => event.ticket === ticket && event.step === step)
                  ? "settled"
                  : "ahead",
    }))

/** The whole view, as a pure function of the run's three inputs. */
export const boardOf = (
    manifest: Manifest,
    events: readonly LifecycleEvent[],
    inFlight: readonly Action[],
): BoardView => ({
    rows: manifest.tickets.map(ticket => {
        const track = trackOf(events, inFlight, ticket.number)
        const live = liveStep(inFlight, ticket.number)

        return {
            ticket: ticket.number,
            title: ticket.title,
            track,
            steps: trailOf(events, ticket.number, track, live),
            waiting: track === "implement" && implemented(events, ticket.number) && live === undefined,
        }
    }),
})
