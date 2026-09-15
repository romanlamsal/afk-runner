import { attempts, type LifecycleEvent, running, settled, unattempted, verified } from "./events.ts"
import type { Manifest, Ticket } from "./manifest.ts"
import { slateOrder } from "./schedule.ts"

/**
 * Every scheduling and recovery rule afk has, in one pure function of the manifest, the event log
 * and the run's parameters. The driver races what this returns and re-asks; it holds no rules.
 *
 * Because the decision is read out of the log and nothing else, **resume is not a code path**: a
 * resumed run is this same function called against a non-empty log. There is no mode to get wrong.
 */

export type Action =
    /** Give a ticket to an implementer. `attempt` is counted from the log, never stored. */
    | { kind: "implement"; ticket: number; attempt: number }
    /** Record that a ticket will not land, because something it is blocked by will not either. */
    | { kind: "skip"; ticket: number }
    /** Nothing is running and nothing more can start. */
    | { kind: "finish" }

export type RunParameters = {
    /**
     * The driver's live action set, passed in — **never derived from events**. A `running` event
     * that is not in here is a step whose process is gone, which is exactly what a killed run
     * leaves behind and what makes resume a derivation rather than a mode.
     */
    inFlight: readonly Action[]
    /** Implementer slots. */
    maxParallel: number
    /** The first interrupt: start nothing new, let what is running finish (ADR-0016). */
    draining: boolean
}

const ticketsOf = (actions: readonly Action[]): ReadonlySet<number> =>
    new Set(actions.flatMap(action => ("ticket" in action ? [action.ticket] : [])))

/**
 * The tickets nothing can land any more: the ones that failed or were skipped, and everything
 * blocked by one of those, transitively. A blocker outside the manifest is not this run's work, so
 * it cannot doom anything.
 */
const doomed = (manifest: Manifest, events: readonly LifecycleEvent[]): ReadonlySet<number> => {
    const dead = new Set(manifest.tickets.map(ticket => ticket.number).filter(ticket => settled(events, ticket)))

    for (let spread = true; spread; ) {
        spread = false
        for (const ticket of manifest.tickets) {
            if (!dead.has(ticket.number) && ticket.blockedBy.some(blocker => dead.has(blocker))) {
                dead.add(ticket.number)
                spread = true
            }
        }
    }

    return dead
}

/**
 * What to start now.
 *
 * A ticket is on the slate once every blocker of its is **verified** — merged but not gated does not
 * count — and the slate is handed out most-dependents-first so that starting a blocker late never
 * stalls the pool (ADR-0001).
 */
export const nextActions = (
    manifest: Manifest,
    events: readonly LifecycleEvent[],
    { inFlight, maxParallel, draining }: RunParameters,
): readonly Action[] => {
    const busy = ticketsOf(inFlight)
    const idle = (): readonly Action[] => (inFlight.length === 0 ? [{ kind: "finish" }] : [])

    if (draining) {
        return idle()
    }

    const dead = doomed(manifest, events)
    const ofThisRun = new Set(manifest.tickets.map(ticket => ticket.number))

    // ADR-0010: a dependent that was already in flight when its blocker died finishes first and is
    // skipped afterwards, so nothing is skipped out from under a running implementer.
    const skips: Action[] = manifest.tickets
        .filter(
            ticket =>
                dead.has(ticket.number) &&
                !settled(events, ticket.number) &&
                !busy.has(ticket.number) &&
                !running(events, ticket.number),
        )
        .map(ticket => ({ kind: "skip", ticket: ticket.number }))

    const ready = (ticket: Ticket): boolean =>
        ticket.blockedBy.every(blocker => !ofThisRun.has(blocker) || verified(events, blocker))

    const slots = maxParallel - inFlight.filter(action => action.kind === "implement").length
    const starts: Action[] = slateOrder(manifest.tickets)
        .filter(
            ticket =>
                !busy.has(ticket.number) &&
                !dead.has(ticket.number) &&
                unattempted(events, ticket.number) &&
                ready(ticket),
        )
        .slice(0, Math.max(slots, 0))
        .map(ticket => ({
            kind: "implement",
            ticket: ticket.number,
            attempt: attempts(events, ticket.number, "implement") + 1,
        }))

    const actions = [...skips, ...starts]
    return actions.length > 0 ? actions : idle()
}
