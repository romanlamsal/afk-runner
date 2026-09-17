import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import { createFileEventLog } from "../../src/repository/event-log.ts"

/**
 * The event log against a real file. The format is the durability argument — one JSON object per
 * line, opened for append — so it is asserted against the file system rather than against a fake
 * that would simply agree (ADR-0011).
 */
const log = createFileEventLog()

const root = async (): Promise<string> => realpath(await mkdtemp(join(tmpdir(), "afk-events-")))

const event = (ticket: number, outcome: LifecycleEvent["outcome"]): LifecycleEvent => ({
    ticket,
    step: "implement",
    outcome,
    at: "2026-09-15T11:18:38.314Z",
})

describe("createFileEventLog", () => {
    it("should read back nothing for a spec that has no log", async () => {
        // given
        const repository = await root()

        // when
        const events = await log.read(repository, 4)

        // then
        expect(events).toEqual([])
    })

    it("should read back what it appended, oldest first", async () => {
        // given
        const repository = await root()
        await log.append(repository, 4, event(10, "running"))

        // when
        await log.append(repository, 4, event(10, "ok"))

        // then
        expect(await log.read(repository, 4)).toEqual([event(10, "running"), event(10, "ok")])
    })

    it("should write one JSON object per line, so that a torn write costs only the last line", async () => {
        // given
        const repository = await root()
        await log.append(repository, 4, event(10, "running"))

        // when
        await log.append(repository, 4, event(11, "running"))

        // then
        expect((await readFile(join(repository, ".afk/4/events.jsonl"), "utf8")).trimEnd().split("\n")).toHaveLength(2)
    })

    it("should never rewrite an event, so an outcome settles by appending", async () => {
        // given
        const repository = await root()
        await log.append(repository, 4, event(10, "running"))
        await log.append(repository, 4, event(10, "failed"))

        // when
        const events = await log.read(repository, 4)

        // then
        expect(events.map(one => one.outcome)).toEqual(["running", "failed"])
    })

    it("should drop a half-written last line rather than lose the file", async () => {
        // given — exactly what a run killed mid-append leaves behind
        const repository = await root()
        await log.append(repository, 4, event(10, "running"))
        await writeFile(join(repository, ".afk/4/events.jsonl"), '{"ticket":11,"step":"imple', { flag: "a" })

        // when
        const events = await log.read(repository, 4)

        // then
        expect(events).toEqual([event(10, "running")])
    })

    it("should drop a line that does not parse without losing the ones after it", async () => {
        // given
        const repository = await root()
        await log.append(repository, 4, event(10, "running"))
        await writeFile(join(repository, ".afk/4/events.jsonl"), "not json at all\n", { flag: "a" })
        await log.append(repository, 4, event(10, "ok"))

        // when
        const events = await log.read(repository, 4)

        // then
        expect(events).toEqual([event(10, "running"), event(10, "ok")])
    })
})
