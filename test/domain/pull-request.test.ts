import { describe, expect, it } from "vitest"
import type { Progress } from "../../src/domain/events.ts"
import {
    composeDraftPullRequest,
    composePullRequest,
    type FoundPullRequest,
    noPullRequestReason,
    pullRequestMove,
    readPullRequestSummary,
    wholeSpec,
} from "../../src/domain/pull-request.ts"

const nothing: Progress = { verified: [], unverified: [], failed: [], skipped: [] }

const progress = (some: Partial<Progress>): Progress => ({ ...nothing, ...some })

const SUMMARY = { title: "Layerless afk", summary: "The runner stops batching tickets into layers." }

const compose = (worked: Progress) => composePullRequest({ spec: 4, progress: worked, summary: SUMMARY })

/** The same, for a writer that reported nothing afk could use. */
const composeUnwritten = (worked: Progress) => composePullRequest({ spec: 4, progress: worked, summary: undefined })

describe("readPullRequestSummary", () => {
    it("should read what the writer reported", () => {
        // given
        const reported = { title: "Layerless afk", summary: "One branch, one pull request." }

        // when
        const read = readPullRequestSummary(reported)

        // then
        expect(read).toEqual(reported)
    })

    it.each([
        { what: "nothing at all", raw: undefined },
        { what: "a string where the object should be", raw: "Layerless afk" },
    ] as const)("should read neither half from a writer that reported $what", ({ raw }) => {
        // given — output the writer produced, from the table above

        // when
        const read = readPullRequestSummary(raw)

        // then
        expect(read).toEqual({ title: undefined, summary: undefined })
    })

    it.each([
        { what: "an empty summary", raw: { title: "Layerless afk", summary: "" }, half: "title" },
        { what: "no summary at all", raw: { title: "Layerless afk" }, half: "title" },
        { what: "an empty title", raw: { title: "", summary: "One branch." }, half: "summary" },
    ] as const)("should keep the $half of a writer that reported $what", ({ raw, half }) => {
        // given — output the writer produced, from the table above

        // when
        const read = readPullRequestSummary(raw)

        // then
        expect(read[half]).toBeDefined()
    })

    it("should drop the half the writer left empty", () => {
        // given
        const reported = { title: "Layerless afk", summary: "" }

        // when
        const read = readPullRequestSummary(reported)

        // then
        expect(read.summary).toBeUndefined()
    })
})

describe("wholeSpec", () => {
    it.each([
        { what: "every ticket verified", tickets: [5, 6], some: { verified: [5, 6] }, whole: true },
        { what: "a ticket that failed", tickets: [5, 6], some: { verified: [5], failed: [6] }, whole: false },
        { what: "a ticket nothing happened to", tickets: [5, 6], some: { verified: [5] }, whole: false },
    ] as const)("should be $whole for a run with $what", ({ tickets, some, whole }) => {
        // given — a run's tickets and what became of them, from the table above

        // when
        const every = wholeSpec(tickets, progress(some))

        // then
        expect(every).toBe(whole)
    })
})

describe("composePullRequest", () => {
    it("should take the title the writer wrote", () => {
        // given
        const worked = progress({ verified: [5] })

        // when
        const pullRequest = compose(worked)

        // then
        expect(pullRequest.title).toBe("Layerless afk")
    })

    it("should title the spec itself where the writer produced nothing", () => {
        // given
        const worked = progress({ verified: [5] })

        // when
        const pullRequest = composeUnwritten(worked)

        // then
        expect(pullRequest.title).toBe("Spec #4")
    })

    it("should open with the summary the writer wrote", () => {
        // given
        const worked = progress({ verified: [5] })

        // when
        const pullRequest = compose(worked)

        // then
        expect(pullRequest.body.startsWith("The runner stops batching tickets into layers.")).toBe(true)
    })

    it("should say the writer produced no summary rather than inventing one", () => {
        // given
        const worked = progress({ verified: [5] })

        // when
        const pullRequest = composeUnwritten(worked)

        // then
        expect(pullRequest.body).toContain("afk's pull request writer produced no summary")
    })

    it("should close one ticket per verified ticket", () => {
        // given
        const worked = progress({ verified: [5, 6] })

        // when
        const pullRequest = compose(worked)

        // then
        expect(pullRequest.body.endsWith("Closes #5\nCloses #6")).toBe(true)
    })

    it.each([
        { what: "merged but never proven", some: { verified: [5], unverified: [6] } },
        { what: "failed", some: { verified: [5], failed: [6] } },
        { what: "skipped", some: { verified: [5], skipped: [6] } },
        { what: "never attempted", some: { verified: [5] } },
    ] as const)("should close no ticket that was $what", ({ some }) => {
        // given
        const worked = progress(some)

        // when
        const pullRequest = compose(worked)

        // then
        expect(pullRequest.body).not.toContain("Closes #6")
    })

    it("should be ready for review", () => {
        // given
        const worked = progress({ verified: [5] })

        // when
        const pullRequest = compose(worked)

        // then
        expect(pullRequest.draft).toBe(false)
    })
})

describe("composeDraftPullRequest", () => {
    const draft = (tickets: readonly number[], some: Partial<Progress>) =>
        composeDraftPullRequest({ spec: 4, tickets, progress: progress(some) })

    it("should title the spec itself, no writer having run", () => {
        // given
        const tickets = [5, 6]

        // when
        const pullRequest = draft(tickets, { verified: [5] })

        // then
        expect(pullRequest.title).toBe("Spec #4")
    })

    it("should say it is a backup of a spec afk has not finished", () => {
        // given
        const tickets = [5, 6]

        // when
        const pullRequest = draft(tickets, { verified: [5] })

        // then
        expect(
            pullRequest.body.startsWith("afk has not finished spec #4; this draft is a backup of its spec branch."),
        ).toBe(true)
    })

    it("should be a draft", () => {
        // given
        const tickets = [5, 6]

        // when
        const pullRequest = draft(tickets, { verified: [5] })

        // then
        expect(pullRequest.draft).toBe(true)
    })

    it.each([
        { what: "verified", some: { verified: [5, 6] }, names: "- verified: #5, #6" },
        { what: "failed", some: { verified: [5], failed: [6, 7] }, names: "- failed: #6, #7" },
        { what: "skipped", some: { verified: [5], skipped: [6, 7] }, names: "- skipped: #6, #7" },
        { what: "unverified", some: { verified: [5], unverified: [6] }, names: "- not proven by the gate: #6" },
        { what: "unattempted", some: { verified: [5] }, names: "- never attempted: #6, #7" },
    ] as const)("should name every ticket that was $what", ({ some, names }) => {
        // given
        const tickets = [5, 6, 7]

        // when
        const pullRequest = draft(tickets, some)

        // then
        expect(pullRequest.body).toContain(names)
    })

    it("should close no ticket, a draft being rewritten before it can be merged", () => {
        // given
        const tickets = [5, 6]

        // when
        const pullRequest = draft(tickets, { verified: [5] })

        // then
        expect(pullRequest.body).not.toContain("Closes")
    })
})

describe("pullRequestMove", () => {
    const found = (state: FoundPullRequest["state"], draft: boolean, number = 1): FoundPullRequest => ({
        number,
        url: `https://example.invalid/pull/${number}`,
        state,
        draft,
    })

    it.each([
        { what: "a whole spec with nothing found", existing: [], whole: true },
        { what: "a partial spec with nothing found", existing: [], whole: false },
        { what: "a whole spec whose draft was closed", existing: [found("closed", true)], whole: true },
        { what: "a whole spec whose pull request was merged", existing: [found("merged", false)], whole: true },
    ] as const)("should open a new pull request for $what", ({ existing, whole }) => {
        // given — what the tracker found for the spec branch, from the table above

        // when
        const move = pullRequestMove(existing, whole)

        // then
        expect(move).toEqual({ move: "open" })
    })

    it.each([
        { what: "a draft over a partial spec", existing: found("open", true), whole: false, markAs: undefined },
        { what: "a draft over a whole spec", existing: found("open", true), whole: true, markAs: "ready" },
        { what: "a ready one over a whole spec", existing: found("open", false), whole: true, markAs: undefined },
        { what: "a ready one over a partial spec", existing: found("open", false), whole: false, markAs: "draft" },
    ] as const)("should update the open pull request for $what", ({ existing, whole, markAs }) => {
        // given — the open pull request the tracker found, from the table above, beside a closed one
        const listed = [found("closed", true, 7), existing]

        // when
        const move = pullRequestMove(listed, whole)

        // then
        expect(move).toEqual({ move: "update", number: 1, url: "https://example.invalid/pull/1", markAs })
    })

    it("should leave a closed draft closed over a partial spec", () => {
        // given
        const existing = [found("closed", true, 7)]

        // when
        const move = pullRequestMove(existing, false)

        // then
        expect(move).toEqual({ move: "leave", url: "https://example.invalid/pull/7" })
    })
})

describe("noPullRequestReason", () => {
    it("should say that nothing was proven", () => {
        // given
        const worked = progress({ failed: [5] })

        // when
        const reason = noPullRequestReason(4, worked)

        // then
        expect(reason.startsWith("no ticket of spec #4 was verified, so there is no pull request to open")).toBe(true)
    })

    it("should name what became of the tickets instead", () => {
        // given
        const worked = progress({ failed: [5], skipped: [6] })

        // when
        const reason = noPullRequestReason(4, worked)

        // then
        expect(reason).toContain("failed: #5, skipped: #6")
    })

    it("should say so where nothing was attempted at all", () => {
        // given
        const worked = nothing

        // when
        const reason = noPullRequestReason(4, worked)

        // then
        expect(reason).toContain("nothing was attempted")
    })
})
