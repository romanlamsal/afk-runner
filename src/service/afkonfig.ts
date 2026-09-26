import { type AfkonfigFile, type Pinned, readAfkonfig } from "../domain/afkonfig.ts"
import type { Git } from "../domain/git.ts"

/** The driving port: what this repository's afkonfig pins, or what is wrong with it (ADR-0039). */
export type ReadAfkonfig = () => Promise<AfkonfigResult>

export type AfkonfigResult =
    /** No afkonfig, which pins nothing: the planner derives both commands. */
    | { outcome: "absent" }
    | { outcome: "pinned"; pinned: Pinned }
    /** An afkonfig that is there and wrong, and every correction it needs. */
    | { outcome: "invalid"; problems: readonly string[] }
    | { outcome: "refused"; reason: string }

export type ReadAfkonfigDeps = {
    /** Where afk was invoked. The afkonfig lives at this directory's git top level. */
    cwd: string
    git: Git
    afkonfig: AfkonfigFile
}

/**
 * Reading the afkonfig: one load through the port, and the domain's rule over what it exported.
 *
 * A file that would not import is as invalid as one that exported the wrong thing — both are there,
 * and both would be silently worked around by a planner if they were read as absent.
 */
export const createReadAfkonfigService =
    ({ cwd, git, afkonfig }: ReadAfkonfigDeps): ReadAfkonfig =>
    async () => {
        const root = await git.topLevel(cwd)
        if (root === undefined) {
            return {
                outcome: "refused",
                reason: "this is not a git worktree: run afk from inside the repository it is for",
            }
        }

        const loaded = await afkonfig.load(root)
        if (loaded.kind === "absent") {
            return { outcome: "absent" }
        }
        if (loaded.kind === "failed") {
            return { outcome: "invalid", problems: [`afkonfig.ts could not be imported: ${loaded.reason}`] }
        }

        const read = readAfkonfig(loaded.exports)
        return read.ok ? { outcome: "pinned", pinned: read.pinned } : { outcome: "invalid", problems: read.problems }
    }
