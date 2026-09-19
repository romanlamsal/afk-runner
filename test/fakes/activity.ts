import type { Activity } from "../../src/domain/activity.ts"

export type FakeActivity = {
    activity: Activity
    /** Record that the step writing to `path` wrote something at `at`. */
    write: (path: string, at: Date) => void
}

/** Every write a test recorded, by path: what the run directory's records would say. */
export const createFakeActivity = (): FakeActivity => {
    const written = new Map<string, Date[]>()
    return {
        activity: {
            lastWrite: async (_root, path, at) =>
                (written.get(path) ?? [])
                    .filter(write => write.getTime() <= at.getTime())
                    .reduce<Date | undefined>(
                        (latest, write) => (latest === undefined || write > latest ? write : latest),
                        undefined,
                    ),
        },
        write: (path, at) => {
            written.set(path, [...(written.get(path) ?? []), at])
        },
    }
}
