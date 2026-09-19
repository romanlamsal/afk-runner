import { describe, expect, it } from "vitest"
import { heldByAnother, refusalToShare } from "../../src/domain/lock.ts"

describe("heldByAnother", () => {
    it.each([
        ["nobody", undefined, false],
        ["the asking process", { pid: 1 }, false],
        ["another process", { pid: 7 }, true],
    ] as const)("should answer whether a lock held by %s is held by another", (_, holder, expected) => {
        // given
        const self = { pid: 1 }

        // when
        const held = heldByAnother(holder, self)

        // then
        expect(held).toBe(expected)
    })
})

describe("refusalToShare", () => {
    it("should name the process holding the run", () => {
        // given
        const holder = { pid: 4242 }

        // when
        const refusal = refusalToShare(4, holder)

        // then
        expect(refusal).toContain("afk process 4242")
    })
})
