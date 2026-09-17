import type { RunRecordStore } from "../../src/domain/records.ts"

export type FakeRunRecords = {
    records: RunRecordStore
    /** Every run directory created, by the repository and the spec it was created for. */
    created: { root: string; spec: number }[]
    /** Every run directory removed, the same way. */
    removed: { root: string; spec: number }[]
}

export const createFakeRunRecords = ({
    unremovable,
    onRemove,
}: {
    unremovable?: string | undefined
    /**
     * Called when the run directory goes. The event log lives in that directory, so a test whose
     * log kept saying "there is a run" afterwards would make starting over untestable.
     */
    onRemove?: () => void
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
                onRemove?.()
                return { ok: true }
            },
        },
    }
}
