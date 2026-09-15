import { describe, expect, it } from "vitest"
import { mergedTickets, squashMessage, ticketTrailer } from "../../src/domain/squash.ts"

/**
 * The squash body is what a reviewer of the spec PR reads, so everything here is a question about
 * prose: what it keeps, what it leaves out, and what a machine can read back out of it.
 */

const message = (over: Partial<Parameters<typeof squashMessage>[0]> = {}): string =>
    squashMessage({
        spec: 4,
        ticket: 9,
        title: "Squash-merge and gate",
        commits: ["feat: squash a ticket onto the spec branch"],
        note: undefined,
        ...over,
    })

describe("squashMessage", () => {
    it("should open with the ticket's title and number", () => {
        // given
        const commits = ["feat: squash a ticket onto the spec branch"]

        // when
        const composed = message({ commits })

        // then
        expect(composed.split("\n")[0]).toBe("Squash-merge and gate (#9)")
    })

    it.each([
        ["every one of the implementer's commit messages, oldest first", "the first thing\n\nthe second thing"],
        ["the resolver's note, so that a reviewer learns an agent judged something", "Conflict resolution: kept both"],
        ["the ticket trailer, which is the git-side record of what landed", "afk-ticket: 4/9"],
    ] as const)("should carry %s", (_name, expected) => {
        // given
        const commits = ["the first thing", "the second thing"]

        // when
        const composed = message({ commits, note: "kept both" })

        // then
        expect(composed).toContain(expected)
    })

    it.each([
        ["a ticket that never conflicted", undefined],
        ["a resolver that reported no note", "   "],
    ] as const)("should say nothing about a conflict for %s", (_name, note) => {
        // given — the note from the table

        // when
        const composed = message({ note })

        // then
        expect(composed).not.toContain("Conflict resolution")
    })

    it("should carry no conflict trailer, because nothing would ever read one", () => {
        // given — git reads the last paragraph as the trailers, and only that one
        const note = "kept both"

        // when
        const composed = message({ note })

        // then
        expect(composed.split("\n\n").at(-1)).toBe("afk-ticket: 4/9")
    })

    it("should drop a commit message that is empty rather than leave a hole in the body", () => {
        // given
        const commits = ["feat: the only thing", ""]

        // when
        const composed = message({ commits })

        // then
        expect(composed).toBe("Squash-merge and gate (#9)\n\nfeat: the only thing\n\nafk-ticket: 4/9")
    })
})

describe("mergedTickets", () => {
    it("should read back the ticket a squash commit afk composed says it carried", () => {
        // given
        const messages = [message()]

        // when
        const merged = mergedTickets(4, messages)

        // then
        expect(merged).toEqual([9])
    })

    it("should name every ticket on the branch, in the order the commits are in", () => {
        // given
        const messages = [message({ ticket: 7 }), message({ ticket: 9 })]

        // when
        const merged = mergedTickets(4, messages)

        // then
        expect(merged).toEqual([7, 9])
    })

    it("should ignore a trailer for another spec, whose tickets are not this run's", () => {
        // given
        const messages = [`landed elsewhere\n\n${ticketTrailer(5, 9)}`]

        // when
        const merged = mergedTickets(4, messages)

        // then
        expect(merged).toEqual([])
    })

    it("should ignore a commit nothing of afk's landed", () => {
        // given
        const messages = ["docs: written by hand, before the run"]

        // when
        const merged = mergedTickets(4, messages)

        // then
        expect(merged).toEqual([])
    })
})
