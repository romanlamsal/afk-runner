import type { EventLog, LifecycleEvent } from "../../src/domain/events.ts"

export type FakeEventLog = {
    log: EventLog
    /** Every event appended, oldest first. The log a test asserts on. */
    appended: LifecycleEvent[]
}

/** `existing` is the log a previous run left behind; an empty one is a spec nothing has happened to. */
export const createFakeEventLog = (existing: readonly LifecycleEvent[] = []): FakeEventLog => {
    const appended = [...existing]
    return {
        appended,
        log: {
            read: async () => [...appended],
            append: async (_root, _spec, event) => {
                appended.push(event)
            },
        },
    }
}
