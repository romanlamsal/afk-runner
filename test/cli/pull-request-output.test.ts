import { describe, expect, it } from "vitest"
import { pullRequestOutput } from "../../src/cli/pull-request-output.ts"

describe("pullRequestOutput", () => {
    it.each([
        {
            what: "a ready pull request it opened",
            finished: { outcome: "opened", draft: false, url: "https://example.invalid/pull/1" },
            line: "pull request opened: https://example.invalid/pull/1",
        },
        {
            what: "a draft it opened",
            finished: { outcome: "opened", draft: true, url: "https://example.invalid/pull/1" },
            line: "draft pull request opened: https://example.invalid/pull/1",
        },
        {
            what: "a pull request it updated ready for review",
            finished: { outcome: "updated", draft: false, url: "https://example.invalid/pull/1" },
            line: "pull request updated: https://example.invalid/pull/1",
        },
        {
            what: "a draft it updated",
            finished: { outcome: "updated", draft: true, url: "https://example.invalid/pull/1" },
            line: "draft pull request updated: https://example.invalid/pull/1",
        },
        {
            what: "a draft the operator closed",
            finished: { outcome: "left", draft: true, url: "https://example.invalid/pull/1" },
            line: "draft pull request closed, not reopened: https://example.invalid/pull/1",
        },
        {
            what: "one the tracker named no url for",
            finished: { outcome: "opened", draft: false, url: undefined },
            line: "pull request opened",
        },
    ] as const)("should say where to find $what", ({ finished, line }) => {
        // given — what the finish came back with, from the table above

        // when
        const lines = pullRequestOutput(finished)

        // then
        expect(lines).toEqual([line])
    })
})
