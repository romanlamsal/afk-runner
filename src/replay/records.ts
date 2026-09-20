import { stat } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import type { LifecycleEvent } from "../domain/events.ts"
import { AFK_DIR } from "../domain/paths.ts"

/**
 * Where the records a replay colours itself from are: the transcripts an agent wrote and the logs
 * the operator's commands wrote, which is what says whether a running step had gone quiet.
 *
 * A step's start event names its writer relative to the repository root, so a replay has to find
 * that root again from the one path it was handed. It is derivable from a log sitting where afk put
 * it, and from nothing else: a log somebody copied off a machine on its own carries no records.
 *
 * A replay that cannot see the records draws without the colour rather than inventing a silence
 * (ADR-0034), and that is decided once for the whole replay because the board's is a single
 * question: a view is handed writes or it is not. So the directories the log's own writers sit in
 * have to be there, every one of them — a step that wrote nothing has no file, which is a silence
 * worth showing, but a directory that is gone is a silence nothing can vouch for.
 */

/** The run directory a log sits in, where it is sitting in one: `<root>/.afk/<spec>`. */
const runDirectoryOf = (events: string): string | undefined => {
    const held = dirname(resolve(events))
    return basename(dirname(held)) === AFK_DIR ? held : undefined
}

/**
 * The repository root a log's stored paths are relative to: the directory `.afk/<spec>/events.jsonl`
 * hangs off, or nothing where the log is not sitting in a run directory.
 */
export const recordsRootOf = (events: string): string | undefined => {
    const held = runDirectoryOf(events)
    return held === undefined ? undefined : resolve(held, "..", "..")
}

/** Every directory the log's steps wrote their records into, each named once. */
export const recordedIn = (log: readonly LifecycleEvent[]): readonly string[] => [
    ...new Set(
        log.flatMap(event => {
            const written = event.transcriptPath ?? event.logPath
            return written === undefined ? [] : [dirname(written)]
        }),
    ),
]

/** Whether there is a directory at `path` — the transcripts or the commands a run left behind. */
const directory = async (path: string): Promise<boolean> =>
    stat(path)
        .then(entry => entry.isDirectory())
        .catch(() => false)

/**
 * The root to read a run's records under, or nothing where there are none to read: a log outside a
 * run directory, a log naming no records at all, or a run whose record directories have been
 * deleted. Nothing is the board's "claim no silence".
 */
export const recordsRoot = async (events: string, log: readonly LifecycleEvent[]): Promise<string | undefined> => {
    const root = recordsRootOf(events)
    const held = recordedIn(log)
    if (root === undefined || held.length === 0) {
        return undefined
    }
    const kept = await Promise.all(held.map(async where => directory(join(root, where))))
    return kept.every(Boolean) ? root : undefined
}
