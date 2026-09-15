import { appendFile, mkdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { type EventLog, type LifecycleEvent, readEvent } from "../domain/events.ts"
import { eventLogPath } from "../domain/paths.ts"

/**
 * The event log on disk: one JSON object per line, opened for append.
 *
 * The format is the durability argument. A line is written whole or it is not, so a run killed
 * mid-write costs the last line and never the file — and a line that does not parse is dropped on
 * read rather than failing everything before it (ADR-0011).
 */
export const createFileEventLog = (): EventLog => ({
    read: async (root, spec) => {
        const contents = await readFile(join(root, eventLogPath(spec)), "utf8").catch(() => undefined)
        if (contents === undefined) {
            return []
        }

        return contents.split("\n").flatMap((line): LifecycleEvent[] => {
            if (line.trim() === "") {
                return []
            }
            try {
                const event = readEvent(JSON.parse(line))
                return event === undefined ? [] : [event]
            } catch {
                return []
            }
        })
    },

    append: async (root, spec, event) => {
        const path = join(root, eventLogPath(spec))
        await mkdir(dirname(path), { recursive: true })
        await appendFile(path, `${JSON.stringify(event)}\n`, "utf8")
    },
})
