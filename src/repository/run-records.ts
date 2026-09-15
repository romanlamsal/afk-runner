import { access, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { eventLogPath, runDirectory, runIgnorePath } from "../domain/paths.ts"
import type { RunRecordStore } from "../domain/records.ts"

/**
 * `*` matches the ignore file too, so the run directory disappears from the repository's status
 * whole: a directory holding nothing but ignored files is not reported, and nothing inside it — a
 * transcript, a worktree, a copied `.env` — can be staged by accident (ADR-0013).
 */
const IGNORE_EVERYTHING = ["# afk's run directory is machine-local, and ignores itself.", "*", ""].join("\n")

const exists = (path: string): Promise<boolean> =>
    access(path).then(
        () => true,
        () => false,
    )

/** The run directory on disk. One spec's manifest, event log, worktrees and transcripts live in it. */
export const createFileRunRecordStore = (): RunRecordStore => ({
    create: async (root, spec) => {
        await mkdir(join(root, runDirectory(spec)), { recursive: true })
        await writeFile(join(root, runIgnorePath(spec)), IGNORE_EVERYTHING, "utf8")
    },
    // `force`, so that a spec whose directory is already gone is what was asked for rather than a
    // failure. What the worktrees under it left behind goes with it — git's administration of them
    // is taken away first, and that is the caller's ordering to keep.
    //
    // A directory that will not go — a busy mount, a file the operator cannot write — is reported
    // rather than thrown: it is the last step of starting over, and throwing it past the service
    // would report nothing at all.
    remove: async (root, spec) => {
        try {
            await rm(join(root, runDirectory(spec)), { recursive: true, force: true })
            return { ok: true }
        } catch (error) {
            return { ok: false, reason: error instanceof Error ? error.message : String(error) }
        }
    },
    hasEventLog: (root, spec) => exists(join(root, eventLogPath(spec))),
})
