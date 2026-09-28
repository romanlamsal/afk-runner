import type { FoundPullRequest } from "../../src/domain/pull-request.ts"
import type {
    ClaimResult,
    CloseResult,
    FindResult,
    OpenResult,
    PullRequestRequest,
    Tracker,
    UpdateRequest,
    UpdateResult,
} from "../../src/domain/tracker.ts"

/**
 * The tracker port's fake. It has no real counterpart in the contract suite knowingly: a real run
 * would mutate a live repository, so this adapter is covered by review.
 */
export type FakeTracker = {
    tracker: Tracker
    /** Every ticket claimed, in the order it was claimed. */
    claimed: number[]
    /** Every pull request opened, which in a whole run is at most one. */
    opened: PullRequestRequest[]
    /** Every branch a pull request was closed for, in the order it was asked. */
    closed: string[]
    /** Every pull request rewritten, in the order it was asked. */
    updated: UpdateRequest[]
}

export type FakeTrackerSetup = {
    /** Why a claim fails. Undefined is a tracker that grants every one of them. */
    refusal?: string | undefined
    /** The tickets the refusal applies to. Undefined is every ticket. */
    refuses?: readonly number[] | undefined
    /** Why opening a pull request fails. Undefined is a tracker that opens it. */
    unopenable?: string | undefined
    /** What the tracker says the pull request's url is. */
    url?: string | undefined
    /** The branches the tracker has an open pull request for. */
    openFor?: readonly string[] | undefined
    /** Why closing a pull request fails. Undefined is a tracker that closes it. */
    unclosable?: string | undefined
    /** What the tracker finds for any head it is asked about. Undefined is none. */
    found?: readonly FoundPullRequest[] | undefined
    /** Why looking pull requests up fails. Undefined is a tracker that answers. */
    unfindable?: string | undefined
    /** Why rewriting a pull request fails. Undefined is a tracker that rewrites it. */
    unupdatable?: string | undefined
}

export const createFakeTracker = ({
    refusal,
    refuses,
    unopenable,
    openFor,
    unclosable,
    found = [],
    unfindable,
    unupdatable,
    url = "https://example.invalid/pull/1",
}: FakeTrackerSetup = {}): FakeTracker => {
    const claimed: number[] = []
    const updated: UpdateRequest[] = []
    const opened: PullRequestRequest[] = []
    const closed: string[] = []
    const open = new Set(openFor ?? [])
    return {
        claimed,
        opened,
        closed,
        updated,
        tracker: {
            claim: async (_root, ticket): Promise<ClaimResult> => {
                claimed.push(ticket)
                const refused = refusal !== undefined && (refuses === undefined || refuses.includes(ticket))
                return refused ? { ok: false, reason: refusal } : { ok: true }
            },
            openPullRequest: async (_root, request): Promise<OpenResult> => {
                opened.push(request)
                if (unopenable !== undefined) {
                    return { ok: false, reason: unopenable }
                }
                open.add(request.head)
                return { ok: true, url }
            },
            findPullRequests: async (): Promise<FindResult> =>
                unfindable === undefined ? { ok: true, found } : { ok: false, reason: unfindable },
            updatePullRequest: async (_root, request): Promise<UpdateResult> => {
                updated.push(request)
                return unupdatable === undefined ? { ok: true } : { ok: false, reason: unupdatable }
            },
            closePullRequest: async (_root, head): Promise<CloseResult> => {
                closed.push(head)
                if (!open.has(head)) {
                    return { ok: true, closed: false }
                }
                if (unclosable !== undefined) {
                    return { ok: false, reason: unclosable }
                }
                open.delete(head)
                return { ok: true, closed: true }
            },
        },
    }
}
