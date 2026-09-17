import type { EventLog, LifecycleEvent } from "../../src/domain/events.ts"

export type FakeEventLog = {
    log: EventLog
    /** Every event appended, oldest first. The log a test asserts on. */
    appended: LifecycleEvent[]
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
    return {
        appended,
        log: {
            read: async () => [...appended],
            append: async (_root, _spec, event) => {
                appended.push(event)
            },
            follow: async function* () {
                yield [...appended]
                for (const change of changes) {
                    appended.push(...change)
                    yield [...appended]
                }
            },
        },
    }
}
