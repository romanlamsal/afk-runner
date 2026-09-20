import { describe, expect, it } from "vitest"
import { lastWriteIn, lastWrites, writtenAt } from "../../src/domain/activity.ts"
import { createFakeActivity } from "../fakes/activity.ts"

/**
 * Reading a step's own records for when they were written. A transcript line and a command log line
 * are read by the one function, which is what makes an agent step and a command step go quiet the
 * same way.
 */
const AT = "2026-09-15T11:18:38.314Z"

describe("writtenAt: the instant a line of output carries", () => {
    it.each([
        ["a transcript record", JSON.stringify({ type: "assistant", timestamp: AT }), new Date(AT)],
        ["a command log line", `${AT} PASS test/domain/board.test.ts`, new Date(AT)],
        ["a transcript record with no timestamp", JSON.stringify({ type: "system" }), undefined],
        ["a transcript record with an unreadable timestamp", JSON.stringify({ timestamp: "soon" }), undefined],
        ["a half-written line", '{"type":"assistant","timest', undefined],
        ["a blank line", "", undefined],
    ] as const)("should read %s", (_case, line, at) => {
        // given
        const written = line

        // when
        const read = writtenAt(written)

        // then
        expect(read).toEqual(at)
    })
})

describe("lastWriteIn: the latest instant a file's lines carry", () => {
    const line = (at: string): string => `${at} output`

    it.each([
        ["the latest of them", "2026-09-15T12:00:00.000Z", new Date("2026-09-15T11:30:00.000Z")],
        [
            "none written after the instant asked about",
            "2026-09-15T11:20:00.000Z",
            new Date("2026-09-15T11:10:00.000Z"),
        ],
        ["nothing where every line is later", "2026-09-15T11:00:00.000Z", undefined],
    ] as const)("should be %s", (_case, until, last) => {
        // given
        const lines = [line("2026-09-15T11:10:00.000Z"), line("2026-09-15T11:30:00.000Z"), ""]

        // when
        const written = lastWriteIn(lines, new Date(until))

        // then
        expect(written).toEqual(last)
    })
})

describe("lastWrites: what every running step of a run last wrote", () => {
    it("should answer each path as of the instant asked about, so one view reads one moment", async () => {
        // given
        const fake = createFakeActivity()
        fake.write("transcripts/a.jsonl", new Date("2026-09-15T11:10:00.000Z"))
        fake.write("transcripts/a.jsonl", new Date("2026-09-15T11:40:00.000Z"))
        fake.write("commands/b.log", new Date("2026-09-15T11:20:00.000Z"))

        // when
        const writes = await lastWrites(
            fake.activity,
            "/repo",
            ["transcripts/a.jsonl", "commands/b.log", "transcripts/gone.jsonl"],
            new Date("2026-09-15T11:30:00.000Z"),
        )

        // then
        expect(writes).toEqual(
            new Map([
                ["transcripts/a.jsonl", new Date("2026-09-15T11:10:00.000Z")],
                ["commands/b.log", new Date("2026-09-15T11:20:00.000Z")],
                ["transcripts/gone.jsonl", undefined],
            ]),
        )
    })
})
