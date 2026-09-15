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

/** A repository to run the contract against: the port, and the things a test cannot ask it for. */
export type GitWorld = {
    git: Git
    root: string
    /** The branch every world starts with, carrying one commit. */
    trunk: string
    /** Commit on `branch`, creating it from trunk when it does not exist, and return the commit. */
    commit: (branch: string) => Promise<string>
    /** Commit on `branch`, which shares no history with trunk, and return the commit. */
    orphan: (branch: string) => Promise<string>
    /** Where `branch` is checked out, relative to the root — a branch has exactly one worktree. */
    worktree: (branch: string) => Promise<string>
    /** Commit on `branch` and on `onto` in a way that the two cannot both apply. */
    collide: (branch: string, onto: string) => Promise<void>
    /** Leave something uncommitted in the worktree at `path`. */
    soil: (path: string) => Promise<void>
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

    describe(`${name}: isClean`, () => {
        it("should call a worktree with nothing uncommitted in it clean", async () => {
            // given
            const world = await create()
            await world.commit("afk/4/t7")

            // when
            const clean = await world.git.isClean(world.root, await world.worktree("afk/4/t7"))

            // then
            expect(clean).toBe(true)
        })

        it("should call a worktree with uncommitted work in it dirty, because a rebase would bury it", async () => {
            // given
            const world = await create()
            await world.commit("afk/4/t7")
            const path = await world.worktree("afk/4/t7")
            await world.soil(path)

            // when
            const clean = await world.git.isClean(world.root, path)

            // then
            expect(clean).toBe(false)
        })
    })

    describe(`${name}: rebase`, () => {
        /** A spec branch a sibling landed on, and a ticket branch cut before that happened. */
        const behind = async (world: GitWorld): Promise<string> => {
            await world.commit("afk/4/spec")
            await world.commit("afk/4/t7")
            return world.worktree("afk/4/t7")
        }

        it("should land a branch whose commits apply to the tip it was rebased onto", async () => {
            // given
            const world = await create()
            const path = await behind(world)

            // when
            const rebased = await world.git.rebase(world.root, { path, onto: "afk/4/spec" })

            // then
            expect(rebased).toEqual({ outcome: "landed" })
        })

        it("should leave the rebased branch containing the tip it was rebased onto", async () => {
            // given
            const world = await create()
            const path = await behind(world)
            const tip = await world.git.revision(world.root, "afk/4/spec")

            // when
            await world.git.rebase(world.root, { path, onto: "afk/4/spec" })

            // then
            expect(await world.git.contains(world.root, { rev: "afk/4/t7", commit: tip ?? "" })).toBe(true)
        })

        it("should stop on a conflict rather than fail, because a conflict is what an agent is for", async () => {
            // given
            const world = await create()
            const path = await behind(world)
            await world.collide("afk/4/t7", "afk/4/spec")

            // when
            const rebased = await world.git.rebase(world.root, { path, onto: "afk/4/spec" })

            // then
            expect(rebased).toEqual({ outcome: "conflicted" })
        })

        it("should leave the worktree conflicted for the resolver that is called into it", async () => {
            // given
            const world = await create()
            const path = await behind(world)
            await world.collide("afk/4/t7", "afk/4/spec")
            await world.git.rebase(world.root, { path, onto: "afk/4/spec" })

            // when
            const conflicted = await world.git.conflicted(world.root, path)

            // then
            expect(conflicted).toBe(true)
        })

        it("should leave nothing conflicted where the rebase landed", async () => {
            // given
            const world = await create()
            const path = await behind(world)
            await world.git.rebase(world.root, { path, onto: "afk/4/spec" })

            // when
            const conflicted = await world.git.conflicted(world.root, path)

            // then
            expect(conflicted).toBe(false)
        })
    })

    describe(`${name}: abortRebase`, () => {
        const stopped = async (world: GitWorld): Promise<string> => {
            await world.commit("afk/4/spec")
            await world.commit("afk/4/t7")
            const path = await world.worktree("afk/4/t7")
            await world.collide("afk/4/t7", "afk/4/spec")
            await world.git.rebase(world.root, { path, onto: "afk/4/spec" })
            return path
        }

        it("should take the worktree out of the rebase git stopped in", async () => {
            // given
            const world = await create()
            const path = await stopped(world)

            // when
            await world.git.abortRebase(world.root, path)

            // then
            expect(await world.git.conflicted(world.root, path)).toBe(false)
        })

        it("should leave the branch where it started, which is why an abort cannot pass for a landing", async () => {
            // given
            const world = await create()
            const path = await stopped(world)
            const tip = await world.git.revision(world.root, "afk/4/spec")

            // when
            await world.git.abortRebase(world.root, path)

            // then
            expect(await world.git.contains(world.root, { rev: "afk/4/t7", commit: tip ?? "" })).toBe(false)
        })

        it("should accept a worktree with no rebase in it, so that every failure path can abort", async () => {
            // given
            const world = await create()
            await world.commit("afk/4/t7")

            // when
            const aborted = await world.git.abortRebase(world.root, await world.worktree("afk/4/t7"))

            // then
            expect(aborted).toEqual({ ok: true })
        })
    })
}
