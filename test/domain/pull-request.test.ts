import { describe, expect, it } from "vitest"
import type { Progress } from "../../src/domain/events.ts"
import {
    composePullRequest,
    noPullRequestReason,
    readPullRequestSummary,
    wholeSpec,
} from "../../src/domain/pull-request.ts"

const nothing: Progress = { verified: [], unverified: [], failed: [], skipped: [] }

const progress = (some: Partial<Progress>): Progress => ({ ...nothing, ...some })

const SUMMARY = { title: "Layerless afk", summary: "The runner stops batching tickets into layers." }

const compose = (tickets: readonly number[], some: Partial<Progress>) =>
    composePullRequest({ spec: 4, tickets, progress: progress(some), summary: SUMMARY })

/** The same, for a writer that reported nothing afk could use. */
const composeUnwritten = (tickets: readonly number[], some: Partial<Progress>) =>
    composePullRequest({ spec: 4, tickets, progress: progress(some), summary: undefined })

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
        const tickets = [5]

        // when
        const pullRequest = compose(tickets, { verified: [5] })

        // then
        expect(pullRequest.title).toBe("Layerless afk")
    })

    it("should title the spec itself where the writer produced nothing", () => {
        // given
        const tickets = [5]

        // when
        const pullRequest = composeUnwritten(tickets, { verified: [5] })

        // then
        expect(pullRequest.title).toBe("Spec #4")
    })

    it("should open with the summary the writer wrote", () => {
        // given
        const tickets = [5]

        // when
        const pullRequest = compose(tickets, { verified: [5] })

        // then
        expect(pullRequest.body.startsWith("The runner stops batching tickets into layers.")).toBe(true)
    })

    it("should say the writer produced no summary rather than inventing one", () => {
        // given
        const tickets = [5]

        // when
        const pullRequest = composeUnwritten(tickets, { verified: [5] })

        // then
        expect(pullRequest.body).toContain("afk's pull request writer produced no summary")
    })

    it("should close one ticket per verified ticket", () => {
        // given
        const tickets = [5, 6]

        // when
        const pullRequest = compose(tickets, { verified: [5, 6] })

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
        const tickets = [5, 6]

        // when
        const pullRequest = compose(tickets, some)

        // then
        expect(pullRequest.body).not.toContain("Closes #6")
    })

    it("should be ready for review when every ticket was verified", () => {
        // given
        const tickets = [5, 6]

        // when
        const pullRequest = compose(tickets, { verified: [5, 6] })

        // then
        expect(pullRequest.draft).toBe(false)
    })

    it("should say nothing about a shortfall when every ticket was verified", () => {
        // given
        const tickets = [5, 6]

        // when
        const pullRequest = compose(tickets, { verified: [5, 6] })

        // then
        expect(pullRequest.body).not.toContain("not the whole of spec #4")
    })

    it.each([
        { what: "a ticket that failed", some: { verified: [5], failed: [6] } },
        { what: "a ticket that was skipped", some: { verified: [5], skipped: [6] } },
        { what: "a ticket the gate never proved", some: { verified: [5], unverified: [6] } },
        { what: "a ticket nothing happened to", some: { verified: [5] } },
    ] as const)("should be a draft for a run with $what", ({ some }) => {
        // given
        const tickets = [5, 6]

        // when
        const pullRequest = compose(tickets, some)

        // then
        expect(pullRequest.draft).toBe(true)
    })

    it.each([
        { what: "failed", some: { verified: [5], failed: [6, 7] }, names: "- failed: #6, #7" },
        { what: "skipped", some: { verified: [5], skipped: [6, 7] }, names: "- skipped: #6, #7" },
        { what: "unverified", some: { verified: [5], unverified: [6] }, names: "- not proven by the gate: #6" },
        { what: "unattempted", some: { verified: [5] }, names: "- never attempted: #6, #7" },
    ] as const)("should name every ticket that was $what", ({ some, names }) => {
        // given
        const tickets = [5, 6, 7]

        // when
        const pullRequest = compose(tickets, some)

        // then
        expect(pullRequest.body).toContain(names)
    })

    it("should say which spec the shortfall is against", () => {
        // given
        const tickets = [5, 6]

        // when
        const pullRequest = compose(tickets, { verified: [5], failed: [6] })

        // then
        expect(pullRequest.body).toContain("This pull request is not the whole of spec #4:")
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
