import { describe, expect, it } from "vitest"
import {
    eventLogPath,
    gateWorktree,
    manifestPath,
    runDirectory,
    runIgnorePath,
    transcriptPath,
} from "../../src/domain/paths.ts"

describe("runDirectory", () => {
    it("should keep every spec's run in its own directory", () => {
        // given
        const spec = 4

        // when
        const path = runDirectory(spec)

        // then
        expect(path).toBe(".afk/4")
    })
})

describe("manifestPath", () => {
    it("should put the manifest in the spec's run directory", () => {
        // given
        const spec = 4

        // when
        const path = manifestPath(spec)

        // then
        expect(path).toBe(".afk/4/manifest.json")
    })
})

describe("eventLogPath", () => {
    it("should put the event log in the spec's run directory", () => {
        // given
        const spec = 4

        // when
        const path = eventLogPath(spec)

        // then
        expect(path).toBe(".afk/4/events.jsonl")
    })
})

describe("runIgnorePath", () => {
    it("should put the ignore file inside the directory it ignores", () => {
        // given
        const spec = 4

        // when
        const path = runIgnorePath(spec)

        // then
        expect(path).toBe(".afk/4/.gitignore")
    })
})

describe("gateWorktree", () => {
    it("should put the gate worktree in the spec's run directory", () => {
        // given
        const spec = 4

        // when
        const path = gateWorktree(spec)

        // then
        expect(path).toBe(".afk/4/gate")
    })
})

describe("transcriptPath", () => {
    it("should name a transcript so that transcripts sort chronologically", () => {
        // given
        const at = new Date("2026-09-15T11:18:38.314Z")

        // when
        const path = transcriptPath(4, "planner", at)

        // then
        expect(path).toBe(".afk/4/transcripts/20260915T111838314Z-planner.jsonl")
    })
})
