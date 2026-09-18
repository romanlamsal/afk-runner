import type { PullRequest } from "./pull-request.ts"

/**
 * The tracker port. Exactly two writes reach it in a whole run — the claim when an implementer
 * starts, and the spec PR at the end — because anything a second reader needs has to reach the spec
 * branch's commits or it does not exist (ADR-0013).
 *
 * Starting over adds the only other write there is, and it is the undoing of one of those two:
 * closing the pull request a previous run opened. What it never undoes is a claim.
 */

export type ClaimResult = { ok: true } | { ok: false; reason: string }

export type PullRequestRequest = PullRequest & {
    /** The branch the pull request carries: the spec branch, already pushed. */
    head: string
    /** What it is opened against: the branch the spec branch was cut from (ADR-0018, ADR-0032). */
    base: string
}

export type CloseResult =
    /** `closed` is false where there was no open pull request to close, which is not a failure. */
    { ok: true; closed: boolean } | { ok: false; reason: string }

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
    /**
     * Close the pull request opened from `head`, so that starting over leaves no review of work
     * that no longer exists. Absence is the ordinary case: a run that died during implementation
     * never opened one.
     */
    closePullRequest: (root: string, head: string) => Promise<CloseResult>
}
