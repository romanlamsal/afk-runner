import type { ClaimResult, OpenResult, PullRequestRequest, Tracker } from "../../src/domain/tracker.ts"

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
}

export const createFakeTracker = ({
    refusal,
    refuses,
    unopenable,
    url = "https://example.invalid/pull/1",
}: FakeTrackerSetup = {}): FakeTracker => {
    const claimed: number[] = []
    const opened: PullRequestRequest[] = []
    return {
        claimed,
        opened,
        tracker: {
            claim: async (_root, ticket): Promise<ClaimResult> => {
                claimed.push(ticket)
                const refused = refusal !== undefined && (refuses === undefined || refuses.includes(ticket))
                return refused ? { ok: false, reason: refusal } : { ok: true }
            },
            openPullRequest: async (_root, request): Promise<OpenResult> => {
                opened.push(request)
                return unopenable === undefined ? { ok: true, url } : { ok: false, reason: unopenable }
            },
        },
    }
}
