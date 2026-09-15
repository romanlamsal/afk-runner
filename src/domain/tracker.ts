import type { PullRequest } from "./pull-request.ts"

/**
 * The tracker port. Exactly two writes reach it in a whole run — the claim when an implementer
 * starts, and the spec PR at the end — because anything a second reader needs has to reach the spec
 * branch's commits or it does not exist (ADR-0013).
 */

export type ClaimResult = { ok: true } | { ok: false; reason: string }

export type PullRequestRequest = PullRequest & {
    /** The branch the pull request carries: the spec branch, already pushed. */
    head: string
    /** What it is opened against: the trunk the spec branch was cut from (ADR-0018). */
    base: string
}

export type OpenResult =
    /** The pull request exists. `url` is what the tracker printed for it, where it printed one. */
    { ok: true; url: string | undefined } | { ok: false; reason: string }

export type Tracker = {
    /**
     * Take the ticket, so that a colleague can see it is taken. It is never released: an unassigned
     * ticket looks unattempted, and an attempted-and-failed one is what you want to find later.
     */
    claim: (root: string, ticket: number) => Promise<ClaimResult>
    /**
     * Open the one pull request a run opens, and stop there. Merging it is the operator's act: it is
     * the single irreversible thing in the whole run, and afk does not do irreversible things
     * unattended.
     */
    openPullRequest: (root: string, request: PullRequestRequest) => Promise<OpenResult>
}
