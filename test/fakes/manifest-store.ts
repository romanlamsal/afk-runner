import type { Manifest, ManifestStore } from "../../src/domain/manifest.ts"

export type FakeManifestStore = {
    store: ManifestStore
    /** Every manifest written, by the spec it was written for. */
    written: { spec: number; manifest: Manifest }[]
}

export const createFakeManifestStore = (): FakeManifestStore => {
    const written: { spec: number; manifest: Manifest }[] = []
    return {
        written,
        store: {
            write: async (spec, manifest) => {
                written.push({ spec, manifest })
            },
        },
    }
}
