import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { type ManifestStore, readStoredManifest } from "../domain/manifest.ts"
import { manifestPath } from "../domain/paths.ts"

/**
 * The manifest on disk, inside the target repository's run directory. The domain owns the path and
 * the rules a manifest must satisfy; the only thing this knows that the domain does not is where the
 * repository is, and that is handed to it per call because afk discovers it at run start.
 */
export const createFileManifestStore = (): ManifestStore => ({
    read: async (root, spec) => {
        const contents = await readFile(join(root, manifestPath(spec)), "utf8").catch(() => undefined)
        if (contents === undefined) {
            return undefined
        }
        try {
            return readStoredManifest(JSON.parse(contents), spec)
        } catch (error) {
            const said = error instanceof Error ? error.message : String(error)
            return { ok: false, reason: `${manifestPath(spec)} is not JSON: ${said}` }
        }
    },
    write: async (root, spec, manifest) => {
        const path = join(root, manifestPath(spec))
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, `${JSON.stringify(manifest, undefined, 4)}\n`, "utf8")
    },
})
