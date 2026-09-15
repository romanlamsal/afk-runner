import type { Manifest } from "../domain/manifest.ts"
import { executionOrder } from "../domain/schedule.ts"

/**
 * What `--plan-only` leaves on screen: the two commands the planner derived, and the order the
 * slate will hand the tickets out in — so that the schedule is read rather than derived from the
 * graph by hand. The numbers group what `maxParallel` slots hold; they are not layers (ADR-0001).
 */
export const planOutput = (manifest: Manifest, maxParallel: number): string[] => {
    const schedule = executionOrder(manifest.tickets, maxParallel).flatMap((group, index) =>
        group.map((ticket, place) => {
            const prefix = place === 0 ? `${index + 1}.`.padStart(4) : "    "
            return `${prefix} #${ticket.number} ${ticket.title}`
        }),
    )

    return [
        `spec #${manifest.spec}: ${manifest.tickets.length} tickets, ${maxParallel} at a time`,
        `setup:  ${manifest.setup}`,
        `verify: ${manifest.verify}`,
        "",
        ...schedule,
    ]
}
