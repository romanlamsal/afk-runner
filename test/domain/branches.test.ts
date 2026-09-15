import { describe, expect, it } from "vitest"
import { specBranch } from "../../src/domain/branches.ts"

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
