import { describe, expect, it } from "vitest"
import { manifestPath, runDirectory, transcriptPath } from "../../src/domain/paths.ts"

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
