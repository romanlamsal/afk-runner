import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { ManifestStore } from "../domain/manifest.ts"
import { manifestPath } from "../domain/paths.ts"

/**
 * The manifest on disk, inside the target repository's run directory. The domain owns the path; the
 * only thing this knows that the domain does not is where the repository is.
 */
export const createFileManifestStore = ({ root }: { root: string }): ManifestStore => ({
    write: async (spec, manifest) => {
        const path = join(root, manifestPath(spec))
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, `${JSON.stringify(manifest, undefined, 4)}\n`, "utf8")
    },
})
