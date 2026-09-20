import { describe, expect, it } from "vitest"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import { recordedIn, recordsRootOf } from "../../src/replay/records.ts"

const AT = "2026-09-15T11:00:00.000Z"

/**
 * Finding the root a log's stored paths are relative to. A step names its transcript relative to the
 * repository root, and a replay is handed one path, so the root is either derivable from where the
 * log sits or there is none.
 */

describe("recordsRootOf", () => {
    it.each([
        ["a log where afk put it", "/repo/.afk/52/events.jsonl", "/repo"],
        ["a log in a nested checkout", "/home/x/work/repo/.afk/7/events.jsonl", "/home/x/work/repo"],
        ["a log somebody copied out on its own", "/tmp/events.jsonl", undefined],
        ["a log carried off under another name", "/tmp/run-1117/events.jsonl", undefined],
    ] as const)("should read the root of %s", (_case, events, root) => {
        // given
        const path = events

        // when
        const read = recordsRootOf(path)

        // then
        expect(read).toBe(root)
    })
})

describe("recordedIn", () => {
    it("should name each directory the log's steps wrote into, once", () => {
        // given
        const log: readonly LifecycleEvent[] = [
            { ticket: 7, step: "implement", outcome: "running", at: AT, transcriptPath: ".afk/9/transcripts/a.jsonl" },
            { ticket: 8, step: "implement", outcome: "running", at: AT, transcriptPath: ".afk/9/transcripts/b.jsonl" },
            { ticket: 7, step: "gate", outcome: "running", at: AT, logPath: ".afk/9/commands/c.log" },
            { ticket: 8, step: "setup", outcome: "ok", at: AT },
        ]

        // when
        const held = recordedIn(log)

        // then
        expect(held).toEqual([".afk/9/transcripts", ".afk/9/commands"])
    })
})
