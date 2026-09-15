import { describe, expect, it } from "vitest"
import type { Git } from "../../src/domain/git.ts"

/**
 * The git port's contract: one suite, written against the port and run twice — against the fake and
 * against real git in a temporary repository. It is what stops the fake drifting into a fiction
 * that passes while the real adapter breaks.
 *
 * It covers the reads the post-implementer assertions rest on. `contains` in particular is the
 * question "is this branch still built on what it was handed", and a fake that answered it with a
 * flag a test set would prove nothing at all.
 */

/** A repository to run the contract against: the port, and the two things a test cannot ask it for. */
export type GitWorld = {
    git: Git
    root: string
    /** The branch every world starts with, carrying one commit. */
    trunk: string
    /** Commit on `branch`, creating it from trunk when it does not exist, and return the commit. */
    commit: (branch: string) => Promise<string>
    /** Commit on `branch`, which shares no history with trunk, and return the commit. */
    orphan: (branch: string) => Promise<string>
}

export const describeGitContract = (name: string, create: () => Promise<GitWorld>): void => {
    describe(`${name}: revision`, () => {
        it("should resolve a branch to the commit it points at", async () => {
            // given
            const world = await create()
            const made = await world.commit("afk/4/t7")

            // when
            const resolved = await world.git.revision(world.root, "afk/4/t7")

            // then
            expect(resolved).toBe(made)
        })

        it("should resolve a commit to itself, so that a recorded base reads back", async () => {
            // given
            const world = await create()
            const made = await world.commit("afk/4/t7")

            // when
            const resolved = await world.git.revision(world.root, made)

            // then
            expect(resolved).toBe(made)
        })

        it("should be nothing for a branch the repository does not have", async () => {
            // given
            const world = await create()

            // when
            const resolved = await world.git.revision(world.root, "afk/4/t7")

            // then
            expect(resolved).toBeUndefined()
        })

        it("should follow a branch as it moves, rather than the commit it once pointed at", async () => {
            // given
            const world = await create()
            await world.commit("afk/4/t7")
            const second = await world.commit("afk/4/t7")

            // when
            const resolved = await world.git.revision(world.root, "afk/4/t7")

            // then
            expect(resolved).toBe(second)
        })
    })

    describe(`${name}: contains`, () => {
        it("should say a branch contains the commit it was cut from", async () => {
            // given
            const world = await create()
            const base = await world.git.revision(world.root, world.trunk)
            await world.commit("afk/4/t7")

            // when
            const onBase = await world.git.contains(world.root, {
                rev: "afk/4/t7",
                commit: base ?? "",
            })

            // then
            expect(onBase).toBe(true)
        })

        it("should say a branch contains its own tip", async () => {
            // given
            const world = await create()
            const made = await world.commit("afk/4/t7")

            // when
            const onBase = await world.git.contains(world.root, { rev: "afk/4/t7", commit: made })

            // then
            expect(onBase).toBe(true)
        })

        it("should say a branch built elsewhere does not contain the base it was meant to build on", async () => {
            // given
            const world = await create()
            const base = await world.git.revision(world.root, world.trunk)
            await world.orphan("afk/4/t7")

            // when
            const onBase = await world.git.contains(world.root, {
                rev: "afk/4/t7",
                commit: base ?? "",
            })

            // then
            expect(onBase).toBe(false)
        })

        it("should say trunk does not contain a commit made after it on another branch", async () => {
            // given
            const world = await create()
            const later = await world.commit("afk/4/t7")

            // when
            const onBase = await world.git.contains(world.root, { rev: world.trunk, commit: later })

            // then
            expect(onBase).toBe(false)
        })
    })
}
