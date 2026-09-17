import type { RunRecordStore } from "../../src/domain/records.ts"
import type { FakeEventLog } from "./event-log.ts"

export type FakeRunRecords = {
    records: RunRecordStore
    /** Every run directory created, by the repository and the spec it was created for. */
    created: { root: string; spec: number }[]
    /** Every run directory removed, the same way. */
    removed: { root: string; spec: number }[]
}

export const createFakeRunRecords = ({
    unremovable,
    log,
}: {
    unremovable?: string | undefined
    /**
     * The event log this run directory holds, emptied when the directory goes. The log really does
     * live in there, so a test whose log still named a ticket afterwards would make starting over
     * untestable — the two fakes agree by construction rather than by each caller remembering.
     */
    log?: FakeEventLog
} = {}): FakeRunRecords => {
    const created: { root: string; spec: number }[] = []
    const removed: { root: string; spec: number }[] = []
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
                log?.appended.splice(0)
                return { ok: true }
            },
        },
    }
}
