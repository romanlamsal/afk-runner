import { type Action, onMergeTrack, repairFor } from "./decide.ts"
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
 * The weights a step is carried at, which is what makes a row answer three questions at once: what
 * has happened to this ticket, what is happening to it now, and what is still ahead of it.
 *
 * `interrupted` is the fourth, and it is the one thing the log alone can never say: a step the log
 * left `running` whose action the driver does not hold is a step whose process is gone, not a step
 * that is happening (ADR-0019). It is what a resumed run is full of, and telling it from `live` is
 * the reason the board takes the live action set at all.
 */
export const STEP_STATES = ["settled", "live", "interrupted", "ahead"] as const

export type StepState = (typeof STEP_STATES)[number]

/**
 * What a step ended as. `running` is not one of them, and that is the distinction the board rests
 * on: a step that began is not a step that ended, and only the driver can tell the two apart
 * (ADR-0019).
 */
export type SettledOutcome = Exclude<Outcome, "running">

/**
 * One step of a row's trail, at the weight that step is read at. A settled step carries what it
 * came to, so that a green step and a red one are different things on the row rather than the same
 * thing with a different word beside it.
 */
export type BoardStep =
    | { step: Step; state: "settled"; outcome: SettledOutcome }
    | { step: Step; state: "live" | "interrupted" | "ahead" }

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
     */
    conclusion: Conclusion | undefined
    /**
     * A ticket a resumed run has nothing left to try on: its step was interrupted and no prepare
     * pass would be sent to it, so the run has written it off rather than picked it back up.
     *
     * The repair itself needs no field of its own — a pass is sent to the step the trail already
     * marks interrupted, which is where the row's remaining trail begins.
     */
    beyondRepair: boolean
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
/**
 * The step a run left behind on a ticket nothing is running: what the log says began, and what a
 * resume will pick the ticket back up at. Nothing where the ticket is being worked, and nothing
 * where its last event ended.
 *
 * It is read past a prepare pass, like every other reading of what broke: a pass a killed run left
 * `running` is still about the step it was sent to, and that step is where the resume goes
 * (ADR-0012).
 */
const interruptedStep = (
    events: readonly LifecycleEvent[],
    inFlight: readonly Action[],
    ticket: number,
): Step | undefined => {
    const busy = inFlight.some(action => "ticket" in action && action.ticket === ticket)
    return !busy && running(events, ticket) ? brokenStep(events, ticket) : undefined
}

/**
 * The reason the ticket's last settled event gave, where it gave one. The last settled event rather
 * than the last event that carried a detail: a reason belongs to the step it was written about, so
 * a step that ended saying nothing says nothing rather than inheriting an older step's words.
 */
const detailOf = (events: readonly LifecycleEvent[], ticket: number): string | undefined =>
    events.findLast(event => event.ticket === ticket && event.outcome !== "running")?.detail

/**
 * A row's trail. A step the driver is running now is live; a step whose process is gone is
 * interrupted; a step the log has already settled has happened, and carries what it came to;
 * everything else on the track is still ahead.
 *
 * Live is read from the live action set and never from the log, because a `running` event is only a
 * step that is *happening* while the driver says so (ADR-0019). The remainder of an interrupted row
 * begins at the interrupted step, so the operator reads what the resume is about to do before it
 * does it.
 */
const trailOf = (
    events: readonly LifecycleEvent[],
    ticket: number,
    track: Track,
    live: Step | undefined,
    interrupted: Step | undefined,
): readonly BoardStep[] =>
    TRACK_STEPS[track].map((step): BoardStep => {
        if (step === live) {
            return { step, state: "live" }
        }
        if (step === interrupted) {
            return { step, state: "interrupted" }
        }
        const outcome = outcomeAt(events, ticket, step)
        return outcome === undefined ? { step, state: "ahead" } : { step, state: "settled", outcome }
    })

/** The whole view, as a pure function of the run's three inputs. */
export const boardOf = (
    manifest: Manifest,
    events: readonly LifecycleEvent[],
    inFlight: readonly Action[],
): BoardView => ({
    rows: manifest.tickets.map(ticket => {
        const track = trackOf(events, inFlight, ticket.number)
        const live = liveStep(inFlight, ticket.number)
        const interrupted = interruptedStep(events, inFlight, ticket.number)

        return {
            ticket: ticket.number,
            title: ticket.title,
            track,
            steps: trailOf(events, ticket.number, track, live, interrupted),
            waiting: track === "implement" && implemented(events, ticket.number) && live === undefined,
            conclusion: cameTo(events, ticket.number),
            // The one rule of recovery there is, asked rather than derived a second time: a pass is
            // sent to the step that broke, and a ticket no pass would help is one the run has
            // written off (ADR-0012).
            beyondRepair: interrupted !== undefined && repairFor(events, ticket.number) === undefined,
            detail: detailOf(events, ticket.number),
        }
    }),
})
