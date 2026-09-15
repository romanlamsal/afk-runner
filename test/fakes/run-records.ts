import type { RunRecordStore } from "../../src/domain/records.ts"

export type FakeRunRecords = {
    records: RunRecordStore
    /** Every run directory created, by the repository and the spec it was created for. */
    created: { root: string; spec: number }[]
}

export const createFakeRunRecords = ({ events = false }: { events?: boolean } = {}): FakeRunRecords => {
    const created: { root: string; spec: number }[] = []
    return {
        created,
        records: {
            create: async (root, spec) => {
                created.push({ root, spec })
            },
            hasEventLog: async () => events,
        },
    }
}
