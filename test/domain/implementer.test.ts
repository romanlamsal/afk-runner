import { describe, expect, it } from "vitest"
import { type ImplementerWork, implementerFault } from "../../src/domain/implementer.ts"

/**
 * The two post-implementer assertions, and the whole of what afk asserts about an implementer's
 * work. Both are about where the branch is; neither is about what moved while the agent ran.
 */

const work = (overrides: Partial<ImplementerWork> = {}): ImplementerWork => ({
    baseSha: "base",
    tip: "commit",
    onBase: true,
    ...overrides,
})

describe("implementerFault", () => {
    it("should accept work that is on the base it was given and ahead of it", () => {
        // given
        const done = work()

        // when
        const fault = implementerFault(done)

        // then
        expect(fault).toBeUndefined()
    })

    it("should reject an implementer that left no branch behind", () => {
        // given
        const done = work({ tip: undefined })

        // when
        const fault = implementerFault(done)

        // then
        expect(fault).toBe("the implementer left no branch behind")
    })

    it("should reject work built on something other than the base it was given", () => {
        // given
        const done = work({ onBase: false })

        // when
        const fault = implementerFault(done)

        // then
        expect(fault).toContain("other than the base it was given")
    })

    it("should reject a branch still sitting on its base, because nothing was committed", () => {
        // given
        const done = work({ tip: "base" })

        // when
        const fault = implementerFault(done)

        // then
        expect(fault).toBe("the implementer committed nothing")
    })
})
