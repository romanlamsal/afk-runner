import type { Progress } from "../domain/events.ts"

/**
 * What a run leaves on screen once the slate is worked: which tickets an implementer got through,
 * which failed, and which were skipped because something they were blocked by will not land.
 *
 * A line appears only when it has tickets on it, so a clean run says one thing rather than three.
 */
const named = (tickets: readonly number[]): string => tickets.map(ticket => `#${ticket}`).join(", ")

export const progressOutput = (progress: Progress): string[] =>
    (
        [
            ["implemented", progress.implemented],
            ["failed", progress.failed],
            ["skipped", progress.skipped],
        ] as const
    )
        .filter(([, tickets]) => tickets.length > 0)
        .map(([label, tickets]) => `${`${label}:`.padEnd(14)}${named(tickets)}`)
