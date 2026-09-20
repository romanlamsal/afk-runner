import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { type Activity, lastWriteIn } from "../domain/activity.ts"

/**
 * When a step last wrote, read out of the transcript or command log it writes into the run
 * directory. The file is read whole on every ask: it is being appended to by another process, and
 * what it holds now is the only answer there is. A file not there yet is a step that has written
 * nothing yet, and so is one that cannot be read — the board this answers for must not fail a run.
 */
export const createFileActivity = (): Activity => ({
    lastWrite: async (root, path, at) => {
        try {
            return lastWriteIn((await readFile(join(root, path), "utf8")).split("\n"), at)
        } catch {
            return undefined
        }
    },
})
