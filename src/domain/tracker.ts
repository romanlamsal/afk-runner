/**
 * The tracker port. Exactly two writes reach it in a whole run — the claim when an implementer
 * starts, and the spec PR at the end — because anything a second reader needs has to reach the spec
 * branch's commits or it does not exist (ADR-0013).
 */

export type ClaimResult = { ok: true } | { ok: false; reason: string }

export type Tracker = {
    /**
     * Take the ticket, so that a colleague can see it is taken. It is never released: an unassigned
     * ticket looks unattempted, and an attempted-and-failed one is what you want to find later.
     */
    claim: (root: string, ticket: number) => Promise<ClaimResult>
}
