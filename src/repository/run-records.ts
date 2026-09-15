import { access, mkdir, writeFile } from "node:fs/promises"
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
    hasEventLog: (root, spec) => exists(join(root, eventLogPath(spec))),
})
