import type { Manifest, ManifestRead, ManifestStore } from "../../src/domain/manifest.ts"

export type FakeManifestStore = {
    store: ManifestStore
    /** Every manifest written, by the repository and the spec it was written for. */
    written: { root: string; spec: number; manifest: Manifest }[]
}

/** `stored` is what a spec's manifest already is on disk; undefined is a repository that has none. */
export const createFakeManifestStore = (stored?: ManifestRead): FakeManifestStore => {
    const written: { root: string; spec: number; manifest: Manifest }[] = []
    return {
        written,
        store: {
            read: async () => stored,
            write: async (root, spec, manifest) => {
                written.push({ root, spec, manifest })
            },
        },
    }
}
