import { type Action, onMergeTrack } from "./decide.ts"
import { type LifecycleEvent, mergeSideStep } from "./events.ts"
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

/** One ticket's line. Every ticket of the spec has exactly one, from the first frame to the last. */
export type BoardRow = {
    ticket: number
    /** The issue title as the manifest carries it. Fitting it to a terminal is the frame's job. */
    title: string
    track: Track
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

/** The whole view, as a pure function of the run's three inputs. */
export const boardOf = (
    manifest: Manifest,
    events: readonly LifecycleEvent[],
    inFlight: readonly Action[],
): BoardView => ({
    rows: manifest.tickets.map(ticket => ({
        ticket: ticket.number,
        title: ticket.title,
        track: trackOf(events, inFlight, ticket.number),
    })),
})
