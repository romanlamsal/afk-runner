import { describe, expect, it } from "vitest"
import { readListed } from "../../src/infrastructure/tracker.ts"

/** What `gh pr list --json number,url,state,isDraft` prints, read into what the domain decides on. */
describe("readListed", () => {
    const listing = (state: string, isDraft: boolean): string =>
        JSON.stringify([{ number: 3, url: "https://example.invalid/pull/3", state, isDraft }])

    it.each([
        { state: "OPEN", read: "open" },
        { state: "CLOSED", read: "closed" },
        { state: "MERGED", read: "merged" },
    ] as const)("should read gh's $state as $read", ({ state, read }) => {
        // given
        const stdout = listing(state, false)

        // when
        const found = readListed(stdout)

        // then
        expect(found?.at(0)?.state).toBe(read)
    })

    it("should carry gh's draft flag across", () => {
        // given
        const stdout = listing("OPEN", true)

        // when
        const found = readListed(stdout)

        // then
        expect(found).toEqual([{ number: 3, url: "https://example.invalid/pull/3", state: "open", draft: true }])
    })

    it.each([
        { what: "no json at all", stdout: "no pull requests match your search" },
        { what: "a state gh does not print", stdout: listing("DRAFT", true) },
    ] as const)("should read nothing from $what", ({ stdout }) => {
        // given — what gh printed, from the table above

        // when
        const found = readListed(stdout)

        // then
        expect(found).toBeUndefined()
    })
})
