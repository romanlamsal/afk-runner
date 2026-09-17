import { describe, expect, it } from "vitest"
import { fixerFault } from "../../src/domain/fix.ts"

/**
 * What afk asserts about the fix agent's one attempt. Both questions are about the gate worktree,
 * which is the spec branch's only writer: whether the fix is on the branch, and whether there is a
 * fix at all.
 */

describe("fixerFault", () => {
    it("should accept a fix that was committed on the spec branch", () => {
        // given
        const work = { clean: true, moved: true }

        // when
        const fault = fixerFault(work)

        // then
        expect(fault).toBeUndefined()
    })

    it("should refuse a fix left uncommitted, because the gate would prove a tree nothing keeps", () => {
        // given
        const work = { clean: false, moved: true }

        // when
        const fault = fixerFault(work)

        // then
        expect(fault).toBe("the fix agent left work uncommitted in the gate worktree")
    })

    it("should refuse a fix agent that committed nothing, because the gate would read exactly as it did", () => {
        // given
        const work = { clean: true, moved: false }

        // when
        const fault = fixerFault(work)

        // then
        expect(fault).toBe("the fix agent committed nothing, so the spec branch is exactly as the gate found it")
    })
})
