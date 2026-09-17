/**
 * What afk asserts about an implementer's work, and the whole of it.
 *
 * There are exactly two assertions, and both are about **where the branch is**, never about what
 * moved while the agent ran. An idempotent implementer that correctly finds its work already done —
 * the expected case on a resumed run — passes both (ADR-0011).
 *
 * Being behind the spec branch is neither checked nor a failure: every ticket is rebased onto the
 * tip before it merges, so being behind is the normal case (ADR-0005).
 */

export type ImplementerWork = {
    /** The commit the ticket's worktree was cut from, and the base the implementer was given. */
    baseSha: string
    /** Where the ticket branch points now, or undefined when there is no such branch. */
    tip: string | undefined
    /** Whether the ticket branch contains `baseSha`. */
    onBase: boolean
}

/** What is wrong with the work, as the lifecycle event's `detail` should say it, or nothing. */
export const implementerFault = ({ baseSha, tip, onBase }: ImplementerWork): string | undefined => {
    if (tip === undefined) {
        return "the implementer left no branch behind"
    }
    if (!onBase) {
        return `the implementer built on something other than the base it was given (${baseSha})`
    }
    if (tip === baseSha) {
        return "the implementer committed nothing"
    }
    return undefined
}
