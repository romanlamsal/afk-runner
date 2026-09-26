import { stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { AFKONFIG_FILE, type AfkonfigFile, type AfkonfigLoad } from "../domain/afkonfig.ts"

/**
 * The afkonfig, loaded the way node loads any TypeScript: imported, with its types stripped, and so
 * executed. Parsing the literal instead would forbid anything computed and need a parser besides;
 * the file is the repository's own and checked in, trusted as far as its package scripts are
 * (ADR-0039).
 */

const isAbsent = async (path: string): Promise<boolean> => {
    try {
        await stat(path)
        return false
    } catch (error) {
        return error instanceof Error && "code" in error && error.code === "ENOENT"
    }
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export const createFileAfkonfig = (): AfkonfigFile => ({
    load: async (root): Promise<AfkonfigLoad> => {
        const path = join(root, AFKONFIG_FILE)
        if (await isAbsent(path)) {
            return { kind: "absent" }
        }

        try {
            const loaded: unknown = await import(pathToFileURL(path).href)
            return typeof loaded === "object" && loaded !== null
                ? { kind: "loaded", exports: Object.fromEntries(Object.entries(loaded)) }
                : { kind: "failed", reason: "it did not import as a module" }
        } catch (error) {
            return { kind: "failed", reason: reasonOf(error) }
        }
    },
    write: async (root, contents) => {
        await writeFile(join(root, AFKONFIG_FILE), contents, "utf8")
    },
})
