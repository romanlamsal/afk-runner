import type { Manifest, ManifestRead, ManifestStore } from "../../src/domain/manifest.ts"

export type FakeManifestStore = {
    store: ManifestStore
    /** Every manifest written, by the repository and the spec it was written for. */
    written: { root: string; spec: number; manifest: Manifest }[]
}

/**
 * `stored` is what a spec's manifest already is on disk; undefined is a repository that has none.
 *
 * A write is readable afterwards, because a real store round-trips: a fake that kept answering
 * "there is no manifest" after one was written could not tell `--plan-only` followed by
 * `--implement-only` from a spec nothing had planned.
 */
export const createFakeManifestStore = (stored?: ManifestRead): FakeManifestStore => {
    const written: { root: string; spec: number; manifest: Manifest }[] = []
    return {
        written,
        store: {
            read: async () => {
                const last = written.at(-1)
                return last === undefined ? stored : { ok: true, manifest: last.manifest }
            },
            write: async (root, spec, manifest) => {
                written.push({ root, spec, manifest })
            },
        },
    }
}
