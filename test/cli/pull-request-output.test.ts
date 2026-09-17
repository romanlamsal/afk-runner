import { describe, expect, it } from "vitest"
import { pullRequestOutput } from "../../src/cli/pull-request-output.ts"

describe("pullRequestOutput", () => {
    it.each([
        {
            what: "a ready pull request",
            opened: { draft: false, url: "https://example.invalid/pull/1" },
            line: "pull request: https://example.invalid/pull/1",
        },
        {
            what: "a draft",
            opened: { draft: true, url: "https://example.invalid/pull/1" },
            line: "draft pull request: https://example.invalid/pull/1",
        },
        {
            what: "one the tracker named no url for",
            opened: { draft: false, url: undefined },
            line: "pull request opened",
        },
    ] as const)("should say where to find $what", ({ opened, line }) => {
        // given — what the tracker came back with, from the table above

        // when
        const lines = pullRequestOutput(opened)

        // then
        expect(lines).toEqual([line])
    })
})
