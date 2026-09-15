import type { RunRecordStore } from "../../src/domain/records.ts"

export type FakeRunRecords = {
    records: RunRecordStore
    /** Every run directory created, by the repository and the spec it was created for. */
    created: { root: string; spec: number }[]
    /** Every run directory removed, the same way. */
    removed: { root: string; spec: number }[]
}

export const createFakeRunRecords = ({
    events = false,
    unremovable,
}: {
    events?: boolean
    unremovable?: string | undefined
} = {}): FakeRunRecords => {
    const created: { root: string; spec: number }[] = []
    const removed: { root: string; spec: number }[] = []
    // The event log lives in the run directory, so removing the directory takes it with it. A fake
    // that kept answering "there is a run" afterwards would make starting over untestable.
    let hasEvents = events
    return {
        created,
        removed,
        records: {
            create: async (root, spec) => {
                created.push({ root, spec })
            },
            remove: async (root, spec) => {
                if (unremovable !== undefined) {
                    return { ok: false, reason: unremovable }
                }
                removed.push({ root, spec })
                hasEvents = false
                return { ok: true }
            },
            hasEventLog: async () => hasEvents,
        },
    }
}
