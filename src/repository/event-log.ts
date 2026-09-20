import { appendFile, mkdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { type EventLog, type LifecycleEvent, type RunBoundary, readEvent } from "../domain/events.ts"
import { eventLogPath } from "../domain/paths.ts"

/** How often a follower looks at the file. Small enough that a frame follows an append, and no more. */
const POLL_MS = 200

/** A wait that an abort cuts short, so that a follower told to stop is not left sleeping. */
const pause = (ms: number, signal: AbortSignal | undefined): Promise<void> =>
    new Promise(resolve => {
        const done = (): void => {
            clearTimeout(timer)
            signal?.removeEventListener("abort", done)
            resolve()
        }
        const timer = setTimeout(done, ms)
        signal?.addEventListener("abort", done, { once: true })
    })

/**
 * The event log on disk: one JSON object per line, opened for append.
 *
 * The format is the durability argument. A line is written whole or it is not, so a run killed
 * mid-write costs the last line and never the file — and a line that does not parse is dropped on
 * read rather than failing everything before it (ADR-0011).
 *
 * `pollMs` is how long a follower waits between looks. It is a parameter so that a test can watch a
 * file without waiting on it, and nothing else ever passes one.
 */
export const createFileEventLog = ({ pollMs = POLL_MS }: { pollMs?: number } = {}): EventLog => {
    const contentsOf = (root: string, spec: number): Promise<string | undefined> =>
        readFile(join(root, eventLogPath(spec)), "utf8").catch(() => undefined)

    const appendLine = async (root: string, spec: number, record: LifecycleEvent | RunBoundary): Promise<void> => {
        const path = join(root, eventLogPath(spec))
        await mkdir(dirname(path), { recursive: true })
        await appendFile(path, `${JSON.stringify(record)}\n`, "utf8")
    }

    const eventsIn = (contents: string | undefined): readonly LifecycleEvent[] =>
        contents === undefined
            ? []
            : contents.split("\n").flatMap((line): LifecycleEvent[] => {
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

    return {
        read: async (root, spec) => eventsIn(await contentsOf(root, spec)),

        append: async (root, spec, event) => appendLine(root, spec, event),

        appendBoundary: async (root, spec, boundary) => appendLine(root, spec, boundary),

        /**
         * Polling, and not a file watch: a poll is one read of a file nothing else is waiting on, so
         * a run is undisturbed by being followed and a second follower costs it nothing (ADR-0030).
         * It also needs nothing to exist yet — a spec whose log has not been written is a log with
         * no events, and the first append is a change like any other.
         *
         * The file's bytes are what "changed" is decided on. The log is append-only, so bytes that
         * are the same are a log that has not moved, and a torn last line that is completed later is
         * a change even where it parsed to nothing before.
         */
        follow: async function* (root, spec, signal) {
            let seen: string | undefined
            let looked = false

            while (signal?.aborted !== true) {
                const contents = await contentsOf(root, spec)
                if (!looked || contents !== seen) {
                    seen = contents
                    looked = true
                    yield eventsIn(contents)
                }
                await pause(pollMs, signal)
            }
        },
    }
}
