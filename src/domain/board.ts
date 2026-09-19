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
    statusOf,
} from "./events.ts"
import type { Manifest } from "./manifest.ts"

/**
 * The board: the view of a run, derived from what the run directory holds — the manifest and the
 * event log — and an instant handed in (ADR-0034). It claims nothing about liveness, so it says what
 * the log says — which is what lets it be drawn by anything that can read the run directory rather
 * than only by the process running it.
 *
 * Nothing here is written down. What the driver holds and the log does not — which of its steps has
 * a process behind it — stays the driver's, because scheduling needs it and a view does not.
 */

/**
 * The two tracks a run is made of (CONTEXT.md). The view still says which one a ticket is on,
 * because the waiting derivation needs it; nothing in the layout reads it any more, since a row
 * spans every step whatever track it sits on (ADR-0031).
 */
export const TRACKS = ["implement", "merge"] as const

export type Track = (typeof TRACKS)[number]

/**
 * The steps a row carries, in the order a ticket takes them, and the same list on every row. A
 * ticket reaching the merge track therefore changes what its trail says rather than where its row
 * is, which is what lets one block hold the whole run (ADR-0031).
 *
 * The merge-side tail is read from where the schedule reads it, so that the board and the seriality
 * rule can never disagree about what the merge track is.
 *
 * `prepare` is not on the list, and that is the domain's existing rule rather than a new one: a pass
 * is never a step of its own on a row — it is read at the step it was sent to repair, which is the
 * step `onMergeTrack` already routes it by.
 */
export const TRAIL_STEPS: readonly Step[] = ["setup", "implement", ...MERGE_SIDE_STEPS]

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
    /**
     * The issue title as the manifest carries it. Nothing draws it: a fixed trail leaves a title
     * twenty-one columns on an eighty-column terminal, and the number identifies the row already
     * (ADR-0031). It stays on the view because the view is what the run knows about a ticket.
     */
    title: string
    track: Track
    /** The trail across every step, in the order a ticket takes them, whatever track it is on. */
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
    /**
     * How long the step the log left running has been going, in milliseconds: from its start event
     * to the instant the view was derived at. Nothing where no step is running, so that a settled
     * row does not look busy — and nothing where the start event carried no instant a clock reads.
     *
     * It is read off the log and a clock handed in, never off a process, so a replay handed the
     * replayed instant reproduces it exactly. It says how long, not whether: a step whose process is
     * gone counts up like one that is working (ADR-0034).
     */
    elapsed: number | undefined
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
    /**
     * When the last thing happened, as the log's most recent event carries it, or nothing where the
     * log holds no event at all — a run that has not started has no last thing, and a placeholder
     * for one would be the board claiming something the log does not say.
     *
     * It is read off the event rather than from the instant the view is derived at, which is what
     * makes it the log's time and not the time now (ADR-0030). A row's elapsed figure is the only
     * thing the instant is used for (ADR-0034).
     */
    at: string | undefined
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
/**
 * How long the ticket's running step has been going at `now`, or nothing where it has none. The
 * start is the ticket's last event, because a ticket with a step running is one whose last word is
 * that step's start; a prepare pass is timed from its own start, since the pass is what is running.
 */
const elapsedOf = (events: readonly LifecycleEvent[], ticket: number, now: Date): number | undefined => {
    const last = statusOf(events, ticket)
    if (last?.outcome !== "running") {
        return undefined
    }
    const started = new Date(last.at).getTime()
    // An unreadable instant is no instant rather than time zero; a clock behind the log is no time.
    return Number.isNaN(started) ? undefined : Math.max(0, now.getTime() - started)
}

const detailOf = (events: readonly LifecycleEvent[], ticket: number): string | undefined =>
    events.findLast(event => event.ticket === ticket && event.outcome !== "running")?.detail

/**
 * A row's trail. A step the log started and has not ended is running; a step the log has already
 * settled has happened, and carries what it came to; everything else is still ahead.
 *
 * The remainder of a row picked back up begins at its running step, so the operator reads what a
 * resume is about to do before it does it — and reads the same trail whether the run is alive or
 * long dead.
 */
const trailOf = (events: readonly LifecycleEvent[], ticket: number, open: Step | undefined): readonly BoardStep[] =>
    TRAIL_STEPS.map((step): BoardStep => {
        if (step === open) {
            return { step, state: "running" }
        }
        const outcome = outcomeAt(events, ticket, step)
        return outcome === undefined ? { step, state: "ahead" } : { step, state: "settled", outcome }
    })

/**
 * The whole view, as a pure function of the manifest, the log and the instant it is derived at. The
 * instant is handed in rather than read, so the same three inputs are the same view wherever they
 * are drawn — a live run passes the time now, a replay the replayed instant (ADR-0034).
 */
export const boardOf = (manifest: Manifest, events: readonly LifecycleEvent[], now: Date): BoardView => ({
    // The log is append-only, so its last line is the last thing that happened: the order it was
    // written in is the order it happened in, and no event is ever rewritten (ADR-0011).
    at: events.at(-1)?.at,
    rows: manifest.tickets.map(ticket => {
        const track = trackOf(events, ticket.number)
        const open = runningStep(events, ticket.number)

        return {
            ticket: ticket.number,
            title: ticket.title,
            track,
            steps: trailOf(events, ticket.number, open),
            waiting: track === "implement" && implemented(events, ticket.number) && open === undefined,
            conclusion: cameTo(events, ticket.number),
            detail: detailOf(events, ticket.number),
            elapsed: elapsedOf(events, ticket.number, now),
        }
    }),
})
