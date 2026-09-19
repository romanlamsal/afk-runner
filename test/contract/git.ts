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
    commit: (branch: string, message?: string) => Promise<string>
    /** Commit on `branch`, which shares no history with trunk, and return the commit. */
    orphan: (branch: string) => Promise<string>
    /** Where `branch` is checked out, relative to the root — a branch has exactly one worktree. */
    worktree: (branch: string) => Promise<string>
    /** Commit on `branch` and on `onto` in a way that the two cannot both apply. */
    collide: (branch: string, onto: string) => Promise<void>
    /** Leave something uncommitted in the worktree at `path`: a file git does not track. */
    soil: (path: string) => Promise<void>
    /** Change a file git tracks in the worktree at `path`, without committing it. */
    edit: (path: string) => Promise<void>
    /** Leave a file the repository ignores in the worktree at `path`, as an install does. */
    ignore: (path: string) => Promise<void>
    /** Whether what `ignore` left in the worktree at `path` is still there. */
    ignores: (path: string) => Promise<boolean>
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

    describe(`${name}: log`, () => {
        it("should be what the branch's own commits say, oldest first", async () => {
            // given
            const world = await create()
            await world.commit("afk/4/t7", "the first thing")
            await world.commit("afk/4/t7", "the second thing")

            // when
            const messages = await world.git.log(world.root, { rev: "afk/4/t7", notIn: world.trunk })

            // then
            expect(messages).toEqual(["the first thing", "the second thing"])
        })

        it("should be empty for a branch carrying nothing the other does not", async () => {
            // given
            const world = await create()
            await world.worktree("afk/4/t7")

            // when
            const messages = await world.git.log(world.root, { rev: "afk/4/t7", notIn: world.trunk })

            // then
            expect(messages).toEqual([])
        })

        it("should be nothing at all for a rev the repository does not have, which is not an empty range", async () => {
            // given
            const world = await create()

            // when
            const messages = await world.git.log(world.root, { rev: "afk/4/never", notIn: world.trunk })

            // then
            expect(messages).toBeUndefined()
        })
    })

    describe(`${name}: squashMerge`, () => {
        /** A spec branch in its own worktree, and a ticket branch with work waiting to land. */
        const landing = async (world: GitWorld): Promise<string> => {
            const gate = await world.worktree("afk/4/spec")
            await world.commit("afk/4/t7", "the ticket's own work")
            return gate
        }

        it("should put one commit on the receiving branch, carrying the message it was given", async () => {
            // given
            const world = await create()
            const gate = await landing(world)

            // when
            await world.git.squashMerge(world.root, { path: gate, branch: "afk/4/t7", message: "landed #7" })

            // then
            expect(await world.git.log(world.root, { rev: "afk/4/spec", notIn: world.trunk })).toEqual(["landed #7"])
        })

        it("should leave the folded branch exactly where it was", async () => {
            // given
            const world = await create()
            const gate = await landing(world)
            const tip = await world.git.revision(world.root, "afk/4/t7")

            // when
            await world.git.squashMerge(world.root, { path: gate, branch: "afk/4/t7", message: "landed #7" })

            // then
            expect(await world.git.revision(world.root, "afk/4/t7")).toBe(tip)
        })

        it("should put none of the folded branch's own history on the receiving branch", async () => {
            // given
            const world = await create()
            const gate = await landing(world)
            const tip = await world.git.revision(world.root, "afk/4/t7")

            // when
            await world.git.squashMerge(world.root, { path: gate, branch: "afk/4/t7", message: "landed #7" })

            // then
            expect(await world.git.contains(world.root, { rev: "afk/4/spec", commit: tip ?? "" })).toBe(false)
        })

        it("should keep a body with blank lines in it whole, which is what a squash body is", async () => {
            // given
            const world = await create()
            const gate = await landing(world)
            const body = "Squash-merge and gate (#7)\n\nfeat: the ticket's own work\n\nafk-ticket: 4/7"

            // when
            await world.git.squashMerge(world.root, { path: gate, branch: "afk/4/t7", message: body })

            // then
            expect(await world.git.log(world.root, { rev: "afk/4/spec", notIn: world.trunk })).toEqual([body])
        })

        it("should refuse a branch carrying nothing the receiving one does not already have", async () => {
            // given
            const world = await create()
            const gate = await world.worktree("afk/4/spec")
            await world.worktree("afk/4/t8")

            // when
            const merged = await world.git.squashMerge(world.root, {
                path: gate,
                branch: "afk/4/t8",
                message: "landed #8",
            })

            // then
            expect(merged.ok).toBe(false)
        })
    })

    describe(`${name}: revert`, () => {
        /** A spec branch in its own worktree with one ticket landed on it, and where that landed. */
        const landed = async (world: GitWorld): Promise<{ gate: string; merge: string }> => {
            const gate = await world.worktree("afk/4/spec")
            const merge = await world.commit("afk/4/spec", "landed #7")
            return { gate, merge }
        }

        it("should put a commit on the branch carrying the message it was given", async () => {
            // given
            const world = await create()
            const { gate, merge } = await landed(world)

            // when
            await world.git.revert(world.root, { path: gate, from: merge, message: "Revert landing #7" })

            // then
            expect(await world.git.log(world.root, { rev: "afk/4/spec", notIn: world.trunk })).toEqual([
                "landed #7",
                "Revert landing #7",
            ])
        })

        it("should leave what it undid in the branch's history, because a worktree may sit off it", async () => {
            // given
            const world = await create()
            const { gate, merge } = await landed(world)

            // when
            await world.git.revert(world.root, { path: gate, from: merge, message: "Revert landing #7" })

            // then
            expect(await world.git.contains(world.root, { rev: "afk/4/spec", commit: merge })).toBe(true)
        })

        it("should undo everything from the commit it was given onwards in one commit", async () => {
            // given — the squash, and what a fix agent committed on top of it trying to save it
            const world = await create()
            const { gate, merge } = await landed(world)
            await world.commit("afk/4/spec", "an attempt at fixing #7")

            // when
            await world.git.revert(world.root, { path: gate, from: merge, message: "Revert landing #7" })

            // then
            expect(await world.git.log(world.root, { rev: "afk/4/spec", notIn: world.trunk })).toEqual([
                "landed #7",
                "an attempt at fixing #7",
                "Revert landing #7",
            ])
        })

        it("should refuse a commit the branch does not carry", async () => {
            // given
            const world = await create()
            const gate = await world.worktree("afk/4/spec")
            const elsewhere = await world.orphan("afk/4/t7")

            // when
            const reverted = await world.git.revert(world.root, {
                path: gate,
                from: elsewhere,
                message: "Revert landing #7",
            })

            // then
            expect(reverted.ok).toBe(false)
        })
    })

    describe(`${name}: removeWorktree`, () => {
        it("should free the branch it held, so that it can be checked out somewhere else", async () => {
            // given
            const world = await create()
            await world.commit("afk/4/t7")
            await world.git.removeWorktree(world.root, await world.worktree("afk/4/t7"))

            // when
            const added = await world.git.checkoutWorktree(world.root, {
                path: "wt/elsewhere",
                branch: "afk/4/t7",
                startPoint: world.trunk,
            })

            // then
            expect(added).toEqual({ ok: true })
        })
    })

    describe(`${name}: removeWorktreesUnder`, () => {
        it.each([["wt/afk/4/t7"], ["wt/afk/4/t8"]] as const)(
            "should take the worktree at %s away, being registered under the path it was given",
            async path => {
                // given
                const world = await create()
                await world.commit("afk/4/t7")
                await world.commit("afk/4/t8")

                // when
                await world.git.removeWorktreesUnder(world.root, "wt")

                // then
                expect(await world.git.hasWorktree(world.root, path)).toBe(false)
            },
        )

        it("should leave a worktree registered elsewhere where it is", async () => {
            // given
            const world = await create()
            await world.commit("afk/4/t7")
            const path = await world.worktree("afk/4/t7")

            // when
            await world.git.removeWorktreesUnder(world.root, "somewhere-else")

            // then
            expect(await world.git.hasWorktree(world.root, path)).toBe(true)
        })

        it("should be content with a path nothing is registered under", async () => {
            // given
            const world = await create()

            // when
            const removed = await world.git.removeWorktreesUnder(world.root, ".afk/4")

            // then
            expect(removed).toEqual({ ok: true })
        })
    })

    describe(`${name}: deleteBranchesUnder`, () => {
        it.each([["afk/4/spec"], ["afk/4/t7"]] as const)(
            "should delete %s, which is named under the prefix",
            async branch => {
                // given
                const world = await create()
                await world.orphan("afk/4/spec")
                await world.orphan("afk/4/t7")

                // when
                await world.git.deleteBranchesUnder(world.root, "afk/4/")

                // then
                expect(await world.git.revision(world.root, branch)).toBeUndefined()
            },
        )

        it("should leave a branch named outside the prefix where it is", async () => {
            // given
            const world = await create()
            await world.orphan("afk/5/spec")

            // when
            await world.git.deleteBranchesUnder(world.root, "afk/4/")

            // then
            expect(await world.git.revision(world.root, "afk/5/spec")).toBeDefined()
        })

        it("should be content with a prefix no branch is named under", async () => {
            // given
            const world = await create()

            // when
            const deleted = await world.git.deleteBranchesUnder(world.root, "afk/4/")

            // then
            expect(deleted).toEqual({ ok: true })
        })

        it("should delete a branch a run's worktree held, once that worktree is gone", async () => {
            // given
            const world = await create()
            await world.commit("afk/4/t7")
            await world.git.removeWorktreesUnder(world.root, "wt")

            // when
            await world.git.deleteBranchesUnder(world.root, "afk/4/")

            // then
            expect(await world.git.revision(world.root, "afk/4/t7")).toBeUndefined()
        })

        it("should refuse a branch a worktree still has checked out, rather than reporting success over it", async () => {
            // given
            const world = await create()
            await world.commit("afk/4/t7")

            // when
            const deleted = await world.git.deleteBranchesUnder(world.root, "afk/4/")

            // then
            expect(deleted.ok).toBe(false)
        })
    })

    describe(`${name}: hasWorktree`, () => {
        it("should know a worktree it administers, so that a prepare pass has somewhere to go", async () => {
            // given
            const world = await create()
            await world.commit("afk/4/t7")

            // when
            const has = await world.git.hasWorktree(world.root, await world.worktree("afk/4/t7"))

            // then
            expect(has).toBe(true)
        })

        it("should know nothing of a path no worktree was ever made at", async () => {
            // given
            const world = await create()

            // when
            const has = await world.git.hasWorktree(world.root, ".afk/4/t7")

            // then
            expect(has).toBe(false)
        })

        it("should forget a worktree once it is removed, so a verified ticket's is not prepared", async () => {
            // given
            const world = await create()
            await world.commit("afk/4/t7")
            const path = await world.worktree("afk/4/t7")
            await world.git.removeWorktree(world.root, path)

            // when
            const has = await world.git.hasWorktree(world.root, path)

            // then
            expect(has).toBe(false)
        })
    })

    describe(`${name}: checkoutWorktree`, () => {
        it("should refuse a second worktree for a branch another already holds (ADR-0006)", async () => {
            // given
            const world = await create()
            await world.commit("afk/4/t7")

            // when
            const added = await world.git.checkoutWorktree(world.root, {
                path: "wt/elsewhere",
                branch: "afk/4/t7",
                startPoint: world.trunk,
            })

            // then
            expect(added.ok).toBe(false)
        })
    })

    describe(`${name}: resetWorktree`, () => {
        it("should put back a tracked file changed in the worktree", async () => {
            // given
            const world = await create()
            await world.commit("afk/4/spec")
            const path = await world.worktree("afk/4/spec")
            await world.edit(path)

            // when
            await world.git.resetWorktree(world.root, { path, branch: "afk/4/spec" })

            // then
            expect(await world.git.isClean(world.root, path)).toBe(true)
        })

        it("should leave the branch on the tip it was at", async () => {
            // given
            const world = await create()
            const tip = await world.commit("afk/4/spec")
            const path = await world.worktree("afk/4/spec")
            await world.edit(path)

            // when
            await world.git.resetWorktree(world.root, { path, branch: "afk/4/spec" })

            // then
            expect(await world.git.revision(world.root, "afk/4/spec")).toBe(tip)
        })

        it("should refuse a worktree that holds another branch, so that it is re-created instead", async () => {
            // given
            const world = await create()
            await world.commit("afk/4/t7")

            // when
            const reset = await world.git.resetWorktree(world.root, {
                path: await world.worktree("afk/4/t7"),
                branch: "afk/4/spec",
            })

            // then
            expect(reset.ok).toBe(false)
        })

        it("should refuse a path no worktree is registered at", async () => {
            // given
            const world = await create()

            // when
            const reset = await world.git.resetWorktree(world.root, { path: ".afk/4/gate", branch: "afk/4/spec" })

            // then
            expect(reset.ok).toBe(false)
        })

        it("should refuse a worktree stopped in a rebase, which holds no branch", async () => {
            // given
            const world = await create()
            await world.commit("afk/4/spec")
            await world.commit("afk/4/t7")
            const path = await world.worktree("afk/4/t7")
            await world.collide("afk/4/t7", "afk/4/spec")
            await world.git.rebase(world.root, { path, onto: "afk/4/spec" })

            // when
            const reset = await world.git.resetWorktree(world.root, { path, branch: "afk/4/t7" })

            // then
            expect(reset.ok).toBe(false)
        })
    })

    describe(`${name}: cleanWorktree`, () => {
        it("should take away an untracked file", async () => {
            // given
            const world = await create()
            await world.commit("afk/4/spec")
            const path = await world.worktree("afk/4/spec")
            await world.soil(path)

            // when
            await world.git.cleanWorktree(world.root, path)

            // then
            expect(await world.git.isClean(world.root, path)).toBe(true)
        })

        it("should leave an ignored file where it is, because that is the installed tree", async () => {
            // given
            const world = await create()
            await world.commit("afk/4/spec")
            const path = await world.worktree("afk/4/spec")
            await world.ignore(path)

            // when
            await world.git.cleanWorktree(world.root, path)

            // then
            expect(await world.ignores(path)).toBe(true)
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
