import { describe, expect, it } from "vitest"
import { readResolutionNote, resolverFault } from "../../src/domain/resolution.ts"

/**
 * What afk reads out of the conflict resolver and what it asserts about what it left behind. The
 * second is the interesting one: an aborted rebase and one that never conflicted look alike.
 */

describe("readResolutionNote", () => {
    it("should take the note the resolver reported", () => {
        // given
        const reported = { note: "both sides added a field; kept both" }

        // when
        const note = readResolutionNote(reported)

        // then
        expect(note).toBe("both sides added a field; kept both")
    })

    it.each([
        ["nothing at all", undefined],
        ["an empty note", { note: "" }],
        ["something else entirely", { summary: "resolved" }],
    ] as const)("should read no note from %s", (_name, reported) => {
        // given
        const output: unknown = reported

        // when
        const note = readResolutionNote(output)

        // then
        expect(note).toBeUndefined()
    })
})

describe("resolverFault", () => {
    it("should accept a branch left on the tip, ahead of it, with nothing conflicted", () => {
        // given
        const work = { conflicted: false, onTip: true, ahead: true }

        // when
        const fault = resolverFault(work)

        // then
        expect(fault).toBeUndefined()
    })

    it.each([
        ["left the rebase unfinished", { conflicted: true, onTip: false, ahead: false }, "unfinished"],
        // What aborting looks like from outside: nothing conflicted, and nothing moved.
        ["ended the rebase without landing it", { conflicted: false, onTip: false, ahead: true }, "without landing it"],
        // What skipping every one of the ticket's commits looks like: on the tip, and only the tip.
        ["resolved the ticket away", { conflicted: false, onTip: true, ahead: false }, "nothing of it is left"],
    ] as const)("should fault a resolver that %s", (_name, work, said) => {
        // given
        const left = work

        // when
        const fault = resolverFault(left)

        // then
        expect(fault).toContain(said)
    })
})
