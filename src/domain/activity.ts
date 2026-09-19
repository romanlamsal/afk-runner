/**
 * What a step has written, read back as when it last wrote anything. It is what tells a step that is
 * working from one that has gone quiet, and it is read from the step's own records rather than from
 * a file's modification time: a record carries the instant it was written at, so a replay reading
 * the same file reconstructs the same answer, and a modification time is nothing a replay can have.
 *
 * An agent step and a command step answer it the same way. A transcript is one JSON record per line,
 * and the records the agent writes carry a `timestamp`; a command log is one line per line of
 * output with an ISO instant in front of it. Either way a line is a record with an instant, and the
 * last write is the latest of them.
 */

/**
 * When a step last wrote anything. A driven port over the run directory, beside afk's other stores:
 * the domain says what it needs, never how.
 */
export type Activity = {
    /**
     * The latest instant the records at `path` — relative to the root — say something was written,
     * no later than `at`, or nothing where no record says so: a file that is not there yet, one
     * holding nothing, or one whose every record is after `at`.
     *
     * Bounded by `at` so that the answer is the one the file gave at that instant, which is what lets
     * the board be drawn for an instant other than now.
     */
    lastWrite: (root: string, path: string, at: Date) => Promise<Date | undefined>
}

/** `2026-09-19T20:05:38.162Z ` — the instant a command log line opens with. */
const LEADING_INSTANT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) /

/** An instant a clock can read, or nothing. An unreadable one is no instant, never the epoch. */
const instant = (text: string): Date | undefined => {
    const at = new Date(text)
    return Number.isNaN(at.getTime()) ? undefined : at
}

/** A transcript record's own `timestamp`, where the line is a record and carries one. */
const recordedAt = (line: string): Date | undefined => {
    try {
        const record: unknown = JSON.parse(line)
        if (typeof record !== "object" || record === null || !("timestamp" in record)) {
            return undefined
        }
        return typeof record.timestamp === "string" ? instant(record.timestamp) : undefined
    } catch {
        return undefined
    }
}

/**
 * The instant one line of a step's output says it was written at, or nothing where it says none — a
 * transcript record the agent did not stamp, a half-written last line, a blank one.
 */
export const writtenAt = (line: string): Date | undefined => {
    const leading = LEADING_INSTANT.exec(line)?.[1]
    return leading === undefined ? recordedAt(line) : instant(leading)
}

/** The latest instant the lines say something was written, no later than `at`. */
export const lastWriteIn = (lines: readonly string[], at: Date): Date | undefined =>
    lines
        .map(writtenAt)
        .filter((written): written is Date => written !== undefined && written.getTime() <= at.getTime())
        .reduce<Date | undefined>(
            (latest, written) => (latest === undefined || written > latest ? written : latest),
            undefined,
        )
