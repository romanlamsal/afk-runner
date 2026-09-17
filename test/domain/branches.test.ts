import { describe, expect, it } from "vitest"
import { specBranch, ticketBranch } from "../../src/domain/branches.ts"

describe("specBranch", () => {
    it("should name the spec branch after the spec it belongs to", () => {
        // given
        const spec = 4

        // when
        const branch = specBranch(spec)

        // then
        expect(branch).toBe("afk/4/spec")
    })
})

describe("ticketBranch", () => {
    it("should give each ticket a branch of its own under its spec", () => {
        // given
        const spec = 4

        // when
        const branch = ticketBranch(spec, 7)

        // then
        expect(branch).toBe("afk/4/t7")
    })

    it("should never collide with the spec branch it lands on", () => {
        // given
        const spec = 4

        // when
        const branch = ticketBranch(spec, 7)

        // then
        expect(branch).not.toBe(specBranch(spec))
    })
})
