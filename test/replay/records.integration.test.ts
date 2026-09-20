import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import { commandLogPath, eventLogPath, transcriptPath } from "../../src/domain/paths.ts"
import { recordsRoot } from "../../src/replay/records.ts"

/**
 * Whether a run left the records a replay colours itself from. It is a question about directories
 * that are there or are not, so it is asked of a real one.
 */

const SPEC = 9
const STARTED = new Date("2026-09-15T11:00:00.000Z")

const TRANSCRIPT = transcriptPath(SPEC, "t7-implement-1", STARTED)
const COMMANDS = commandLogPath(SPEC, "t7-gate", STARTED)

/** An implementer that wrote a transcript, and a gate that wrote a command log. */
const LOG: readonly LifecycleEvent[] = [
    { ticket: 7, step: "implement", outcome: "running", at: STARTED.toISOString(), transcriptPath: TRANSCRIPT },
    { ticket: 7, step: "gate", outcome: "running", at: STARTED.toISOString(), logPath: COMMANDS },
]

/** A run directory on disk, holding a log and whichever of its record directories a case kept. */
const run = async (kept: readonly string[]): Promise<{ root: string; events: string }> => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "afk-replay-")))
    const events = join(root, eventLogPath(SPEC))
    await mkdir(dirname(events), { recursive: true })
    await writeFile(events, "")
    for (const held of kept) {
        await mkdir(join(root, dirname(held)), { recursive: true })
    }
    return { root, events }
}

describe("recordsRoot", () => {
    it("should be the repository root for a run that kept its records, so the replay can read them", async () => {
        // given
        const { root, events } = await run([TRANSCRIPT, COMMANDS])

        // when
        const read = await recordsRoot(events, LOG)

        // then
        expect(read).toBe(root)
    })

    it.each([
        ["whose records are gone", []],
        ["that kept only what its commands wrote", [COMMANDS]],
        ["that kept only what its agents wrote", [TRANSCRIPT]],
    ] as const)("should be nothing for a run %s, so the replay claims no silence", async (_case, kept) => {
        // given
        const { events } = await run(kept)

        // when
        const read = await recordsRoot(events, LOG)

        // then
        expect(read).toBeUndefined()
    })
})
