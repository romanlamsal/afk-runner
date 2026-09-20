import type { EventLog, LifecycleEvent, RunBoundary } from "../../src/domain/events.ts"

export type FakeEventLog = {
    log: EventLog
    /** Every event appended, oldest first. The log a test asserts on. */
    appended: LifecycleEvent[]
    /** Every run boundary appended, oldest first. Kept beside the events, as the log's `read` keeps them apart. */
    boundaries: RunBoundary[]
}

export type FakeEventLogOptions = {
    /**
     * What a run writes into this log while it is being followed: one group per change, appended
     * when the follower asks for the next state. It is scripted rather than raced so that a test
     * about a growing log is a test and not a schedule.
     *
     * A follower that has been given every change is a log with nothing more coming, and the stream
     * ends there — which is the one thing the file adapter's never does, because a file can always
     * be appended to again.
     */
    changes?: readonly (readonly LifecycleEvent[])[]
}

/** `existing` is the log a previous run left behind; an empty one is a spec nothing has happened to. */
export const createFakeEventLog = (
    existing: readonly LifecycleEvent[] = [],
    { changes = [] }: FakeEventLogOptions = {},
): FakeEventLog => {
    const appended = [...existing]
    const boundaries: RunBoundary[] = []
    return {
        appended,
        boundaries,
        log: {
            read: async () => [...appended],
            append: async (_root, _spec, event) => {
                appended.push(event)
            },
            appendBoundary: async (_root, _spec, boundary) => {
                boundaries.push(boundary)
            },
            follow: async function* (_root, _spec, signal) {
                yield [...appended]
                for (const change of changes) {
                    if (signal?.aborted === true) {
                        return
                    }
                    appended.push(...change)
                    yield [...appended]
                }
            },
        },
    }
}
