import type { Ticket } from "./manifest.ts"

/**
 * The order tickets run in. A ticket is on the slate once every blocker of its is verified, and the
 * slate is ordered by how much work each ticket unblocks, so the longest chain starts first.
 *
 * A blocker that is not itself a ticket of this spec cannot be waited for by this run, so it does
 * not hold anything back: the planner decides membership, and what it left out is not this run's
 * work.
 */

/** Blocker number to the tickets directly blocked by it. */
const dependents = (tickets: readonly Ticket[]): ReadonlyMap<number, readonly number[]> => {
    const map = new Map<number, number[]>()
    for (const ticket of tickets) {
        for (const blocker of ticket.blockedBy) {
            const known = map.get(blocker)
            if (known === undefined) {
                map.set(blocker, [ticket.number])
            } else {
                known.push(ticket.number)
            }
        }
    }
    return map
}

/**
 * How many tickets wait on each ticket, directly or through another ticket. This is the weight the
 * slate is ordered by, and it is load-bearing rather than cosmetic: starting a blocker late stalls
 * the pool (ADR-0001).
 */
export const transitiveDependentCounts = (tickets: readonly Ticket[]): ReadonlyMap<number, number> => {
    const direct = dependents(tickets)

    const reachable = (from: number): number => {
        const seen = new Set<number>()
        const pending = [from]
        for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
            for (const dependent of direct.get(next) ?? []) {
                if (!seen.has(dependent)) {
                    seen.add(dependent)
                    pending.push(dependent)
                }
            }
        }
        return seen.size
    }

    return new Map(tickets.map(ticket => [ticket.number, reachable(ticket.number)]))
}

/** Transitive dependent count descending, ties broken by the order the manifest lists them in. */
export const slateOrder = (tickets: readonly Ticket[]): readonly Ticket[] => {
    const counts = transitiveDependentCounts(tickets)
    const weight = (ticket: Ticket): number => counts.get(ticket.number) ?? 0
    return [...tickets].sort((left, right) => weight(right) - weight(left))
}

/**
 * Drain the tickets in slate order, taking at most `capacity` of them per pass, and report what was
 * left: a ticket that never became ready is one no order of verification can reach.
 */
const drain = (
    tickets: readonly Ticket[],
    capacity: number,
): { taken: readonly (readonly Ticket[])[]; stuck: readonly Ticket[] } => {
    const taken: Ticket[][] = []
    const done = new Set<number>()
    const known = new Set(tickets.map(ticket => ticket.number))
    let remaining = slateOrder(tickets)

    const ready = (ticket: Ticket): boolean =>
        ticket.blockedBy.every(blocker => !known.has(blocker) || done.has(blocker))

    while (remaining.length > 0) {
        const pass = remaining.filter(ready).slice(0, capacity)
        if (pass.length === 0) {
            break
        }
        for (const ticket of pass) {
            done.add(ticket.number)
        }
        taken.push(pass)
        remaining = remaining.filter(ticket => !done.has(ticket.number))
    }

    return { taken, stuck: remaining }
}

/**
 * The tickets that can never start, because their blockers are each other. Nothing downstream can
 * recover from one, so a manifest carrying one is refused rather than run (`readPlannedManifest`).
 */
export const deadlocked = (tickets: readonly Ticket[]): readonly Ticket[] =>
    drain(tickets, Number.POSITIVE_INFINITY).stuck

/**
 * The schedule as the operator reads it before committing an evening to it: the tickets in the
 * order the slate will hand them out, grouped by what `maxParallel` slots can hold.
 *
 * The groups are a reading aid and not a barrier — there are no layers (ADR-0001). Slots roll: a
 * ticket starts the moment a slot frees and its blockers are verified, so a run interleaves across
 * these groups. What the grouping shows faithfully is the order and the concurrency.
 */
export const executionOrder = (tickets: readonly Ticket[], maxParallel: number): readonly (readonly Ticket[])[] =>
    drain(tickets, maxParallel).taken
