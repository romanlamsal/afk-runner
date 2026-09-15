import type { ClaimResult, Tracker } from "../../src/domain/tracker.ts"

/**
 * The tracker port's fake. It has no real counterpart in the contract suite knowingly: a real run
 * would mutate a live repository, so this adapter is covered by review.
 */
export type FakeTracker = {
    tracker: Tracker
    /** Every ticket claimed, in the order it was claimed. */
    claimed: number[]
}

export type FakeTrackerSetup = {
    /** Why a claim fails. Undefined is a tracker that grants every one of them. */
    refusal?: string | undefined
    /** The tickets the refusal applies to. Undefined is every ticket. */
    refuses?: readonly number[] | undefined
}

export const createFakeTracker = ({ refusal, refuses }: FakeTrackerSetup = {}): FakeTracker => {
    const claimed: number[] = []
    return {
        claimed,
        tracker: {
            claim: async (_root, ticket): Promise<ClaimResult> => {
                claimed.push(ticket)
                const refused = refusal !== undefined && (refuses === undefined || refuses.includes(ticket))
                return refused ? { ok: false, reason: refusal } : { ok: true }
            },
        },
    }
}
