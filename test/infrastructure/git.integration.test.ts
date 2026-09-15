import { execFile } from "node:child_process"
import { access, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { createGit } from "../../src/infrastructure/git.ts"

/**
 * The git adapter against real git, in throwaway repositories. Everything here is a claim about what
 * git does, which is exactly the half a fake cannot make.
 */
const run = promisify(execFile)

const git = createGit()

const sh = async (cwd: string, ...args: string[]): Promise<string> => (await run("git", args, { cwd })).stdout.trim()

const commit = async (root: string, message: string): Promise<void> => {
    await writeFile(join(root, `${message}.txt`), `${message}\n`, "utf8")
    await sh(root, "add", ".")
    await sh(root, "commit", "-m", message)
}

/** A repository with one commit on `main` and no remote. */
const repository = async (): Promise<string> => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "afk-git-")))
    await sh(root, "init", "-b", "main")
    await sh(root, "config", "user.email", "afk@example.com")
    await sh(root, "config", "user.name", "afk")
    await commit(root, "first")
    return root
}

/** The same, cloned from a bare origin, so that there is something to be ahead of and behind. */
const cloned = async (): Promise<{ root: string; origin: string }> => {
    const source = await repository()
    const origin = await realpath(await mkdtemp(join(tmpdir(), "afk-origin-")))
    await sh(origin, "init", "--bare", "-b", "main")
    await sh(source, "remote", "add", "origin", origin)
    await sh(source, "push", "-u", "origin", "main")

    const parent = await realpath(await mkdtemp(join(tmpdir(), "afk-clone-")))
    const root = join(parent, "clone")
    await sh(parent, "clone", origin, root)
    await sh(root, "config", "user.email", "afk@example.com")
    await sh(root, "config", "user.name", "afk")
    return { root, origin: source }
}

describe("createGit().topLevel", () => {
    it("should resolve the repository from a directory inside it", async () => {
        // given
        const root = await repository()
        await mkdir(join(root, "packages/thing"), { recursive: true })

        // when
        const found = await git.topLevel(join(root, "packages/thing"))

        // then
        expect(found).toBe(root)
    })

    it("should find no repository outside a worktree", async () => {
        // given
        const nowhere = await realpath(await mkdtemp(join(tmpdir(), "afk-nowhere-")))

        // when
        const found = await git.topLevel(nowhere)

        // then
        expect(found).toBeUndefined()
    })
})

describe("createGit().inspectTrunk", () => {
    it("should take the branch a repository with no origin/HEAD is usually trunked on", async () => {
        // given
        const root = await repository()

        // when
        const trunk = await git.inspectTrunk(root)

        // then
        expect(trunk?.branch).toBe("main")
    })

    it("should report a repository with no remote as uncompared rather than behind", async () => {
        // given
        const root = await repository()

        // when
        const trunk = await git.inspectTrunk(root)

        // then
        expect(trunk).toEqual(expect.objectContaining({ compared: false, ahead: 0, behind: 0 }))
    })

    it("should report a working tree with an uncommitted file as dirty", async () => {
        // given
        const root = await repository()
        await writeFile(join(root, "scratch.txt"), "in progress\n", "utf8")

        // when
        const trunk = await git.inspectTrunk(root)

        // then
        expect(trunk?.dirty).toBe(true)
    })

    it("should take trunk from origin/HEAD when the repository names one", async () => {
        // given
        const { root } = await cloned()

        // when
        const trunk = await git.inspectTrunk(root)

        // then
        expect(trunk?.branch).toBe("main")
    })

    it("should count an unpushed commit as ahead", async () => {
        // given
        const { root } = await cloned()
        await commit(root, "unpushed")

        // when
        const trunk = await git.inspectTrunk(root)

        // then
        expect(trunk).toEqual(expect.objectContaining({ ahead: 1, behind: 0, compared: true }))
    })

    it("should count a commit pushed by someone else as behind", async () => {
        // given
        const { root, origin } = await cloned()
        await commit(origin, "theirs")
        await sh(origin, "push", "origin", "main")

        // when
        const trunk = await git.inspectTrunk(root)

        // then
        expect(trunk).toEqual(expect.objectContaining({ ahead: 0, behind: 1, compared: true }))
    })

    it("should leave the local trunk where it was, having fetched only to compare", async () => {
        // given
        const { root, origin } = await cloned()
        const before = await sh(root, "rev-parse", "main")
        await commit(origin, "theirs")
        await sh(origin, "push", "origin", "main")

        // when
        await git.inspectTrunk(root)

        // then
        expect(await sh(root, "rev-parse", "main")).toBe(before)
    })

    it("should find no trunk when the branch origin names is not in this checkout", async () => {
        // given
        const { root } = await cloned()
        await sh(root, "checkout", "-q", "-b", "feature")
        await sh(root, "branch", "-q", "-D", "main")

        // when
        const trunk = await git.inspectTrunk(root)

        // then
        expect(trunk).toBeUndefined()
    })
})

describe("createGit().checkoutWorktree", () => {
    it("should create the branch from the start point it was given", async () => {
        // given
        const root = await repository()

        // when
        await git.checkoutWorktree(root, { path: ".afk/4/gate", branch: "afk/4/spec", startPoint: "main" })

        // then
        expect(await sh(root, "rev-parse", "afk/4/spec")).toBe(await sh(root, "rev-parse", "main"))
    })

    it("should check the branch out at the path it was given", async () => {
        // given
        const root = await repository()

        // when
        await git.checkoutWorktree(root, { path: ".afk/4/gate", branch: "afk/4/spec", startPoint: "main" })

        // then
        expect(await sh(join(root, ".afk/4/gate"), "rev-parse", "--abbrev-ref", "HEAD")).toBe("afk/4/spec")
    })

    it("should keep the commits an earlier run put on the branch when it re-creates the worktree", async () => {
        // given
        const root = await repository()
        await git.checkoutWorktree(root, { path: ".afk/4/gate", branch: "afk/4/spec", startPoint: "main" })
        await commit(join(root, ".afk/4/gate"), "landed")
        const landed = await sh(root, "rev-parse", "afk/4/spec")

        // when
        await git.checkoutWorktree(root, { path: ".afk/4/gate", branch: "afk/4/spec", startPoint: "main" })

        // then
        expect(await sh(root, "rev-parse", "afk/4/spec")).toBe(landed)
    })

    // The regression this pins: a dead run leaves its worktree registered with git, and the next
    // run must be able to cut the same ticket a worktree again rather than fail on the leftover.
    it("should replace a worktree a killed run left registered", async () => {
        // given
        const root = await repository()
        await git.checkoutWorktree(root, { path: ".afk/4/gate", branch: "afk/4/spec", startPoint: "main" })

        // when
        const again = await git.checkoutWorktree(root, {
            path: ".afk/4/gate",
            branch: "afk/4/spec",
            startPoint: "main",
        })

        // then
        expect(again).toEqual({ ok: true })
    })

    it("should replace a directory a killed run left behind without git knowing", async () => {
        // given
        const root = await repository()
        await mkdir(join(root, ".afk/4/gate"), { recursive: true })
        await writeFile(join(root, ".afk/4/gate/leftover.txt"), "from a run that died\n", "utf8")

        // when
        const checkout = await git.checkoutWorktree(root, {
            path: ".afk/4/gate",
            branch: "afk/4/spec",
            startPoint: "main",
        })

        // then
        expect(checkout).toEqual({ ok: true })
    })

    // The regression this pins: git refuses a second checkout of a branch, which is why the
    // conflict resolver is called into the ticket's own worktree rather than one of its own
    // (ADR-0005). A resolver with a worktree of its own is a path that could never work.
    it("should say what git said when the branch is checked out somewhere else already", async () => {
        // given
        const root = await repository()
        await sh(root, "worktree", "add", join(root, "elsewhere"), "-b", "afk/4/spec")

        // when
        const checkout = await git.checkoutWorktree(root, {
            path: ".afk/4/gate",
            branch: "afk/4/spec",
            startPoint: "main",
        })

        // then
        expect(checkout).toEqual({ ok: false, reason: expect.stringContaining("already") })
    })

    it("should leave the invoking worktree on the branch it was on", async () => {
        // given
        const root = await repository()
        const before = await sh(root, "rev-parse", "--abbrev-ref", "HEAD")

        // when
        await git.checkoutWorktree(root, { path: ".afk/4/gate", branch: "afk/4/spec", startPoint: "main" })

        // then
        expect(await sh(root, "rev-parse", "--abbrev-ref", "HEAD")).toBe(before)
    })
})

/** A spec branch and a ticket branch, each in a worktree of its own, both touching one file. */
const colliding = async (): Promise<string> => {
    const root = await repository()
    for (const [branch, path, text] of [
        ["afk/4/spec", ".afk/4/gate", "theirs"],
        ["afk/4/t7", ".afk/4/t7", "ours"],
    ] as const) {
        await git.checkoutWorktree(root, { path, branch, startPoint: "main" })
        await writeFile(join(root, path, "collision.txt"), `${text}\n`, "utf8")
        await sh(join(root, path), "add", ".")
        await sh(join(root, path), "commit", "-m", text)
    }
    return root
}

describe("createGit().rebase", () => {
    it("should report a rebase git refused to start as failed rather than conflicted", async () => {
        // given
        const root = await repository()
        await git.checkoutWorktree(root, { path: ".afk/4/t7", branch: "afk/4/t7", startPoint: "main" })

        // when
        const rebased = await git.rebase(root, { path: ".afk/4/t7", onto: "afk/4/nothing-named-this" })

        // then
        expect(rebased).toEqual({ outcome: "failed", reason: expect.stringContaining("afk/4/nothing-named-this") })
    })

    it("should call a rebase whose conflicts are staged but never continued conflicted still", async () => {
        // given — what an agent that resolved the files and stopped there leaves behind
        const root = await colliding()
        await git.rebase(root, { path: ".afk/4/t7", onto: "afk/4/spec" })
        await sh(join(root, ".afk/4/t7"), "add", ".")

        // when
        const conflicted = await git.conflicted(root, ".afk/4/t7")

        // then
        expect(conflicted).toBe(true)
    })

    // Where the branch itself ends up is the contract suite's to pin; this is about the other
    // branch — the one nothing in the merge track may move until the ticket lands (ADR-0006).
    it("should leave the spec branch untouched by a rebase that could not land", async () => {
        // given
        const root = await colliding()
        const before = await sh(root, "rev-parse", "afk/4/spec")
        await git.rebase(root, { path: ".afk/4/t7", onto: "afk/4/spec" })

        // when
        await git.abortRebase(root, ".afk/4/t7")

        // then
        expect(await sh(root, "rev-parse", "afk/4/spec")).toBe(before)
    })
})

/**
 * A spec branch carrying a ticket's merge and a fix agent's attempt to save it, and the commit the
 * merge landed as. Where a branch ends up after a revert is the contract suite's; what is here is
 * the claim no fake can make — that the tree really is back.
 */
const merged = async (): Promise<{ root: string; landed: string }> => {
    const root = await repository()
    await git.checkoutWorktree(root, { path: ".afk/4/gate", branch: "afk/4/spec", startPoint: "main" })
    const gate = join(root, ".afk/4/gate")

    await commit(gate, "the-ticket")
    const landed = await sh(gate, "rev-parse", "HEAD")
    await commit(gate, "the-fix-attempt")

    return { root, landed }
}

const there = async (path: string): Promise<boolean> => {
    try {
        await access(path)
        return true
    } catch {
        return false
    }
}

describe("createGit().revert", () => {
    it.each([["the-ticket"], ["the-fix-attempt"]] as const)(
        "should take %s's work out of the worktree, which is what the re-gate then proves",
        async file => {
            // given
            const { root, landed } = await merged()

            // when
            await git.revert(root, { path: ".afk/4/gate", from: landed, message: "Revert #7" })

            // then
            expect(await there(join(root, ".afk/4/gate", `${file}.txt`))).toBe(false)
        },
    )

    it("should leave the worktree clean, so that the next merge has somewhere to land", async () => {
        // given
        const { root, landed } = await merged()

        // when
        await git.revert(root, { path: ".afk/4/gate", from: landed, message: "Revert #7" })

        // then
        expect(await git.isClean(root, ".afk/4/gate")).toBe(true)
    })

    it("should report a revert git refused rather than a silent one, because a ref that moved goes unchecked otherwise", async () => {
        // given — uncommitted work over the very file the revert has to take away
        const { root, landed } = await merged()
        await writeFile(join(root, ".afk/4/gate/the-ticket.txt"), "in progress\n", "utf8")

        // when
        const reverted = await git.revert(root, { path: ".afk/4/gate", from: landed, message: "Revert #7" })

        // then
        expect(reverted.ok).toBe(false)
    })

    it("should leave the worktree clean when git refused, rather than half-undone", async () => {
        // given
        const { root, landed } = await merged()
        await writeFile(join(root, ".afk/4/gate/the-ticket.txt"), "in progress\n", "utf8")

        // when
        await git.revert(root, { path: ".afk/4/gate", from: landed, message: "Revert #7" })

        // then
        expect(await git.isClean(root, ".afk/4/gate")).toBe(true)
    })
})

/** A clone with a spec branch carrying one commit, which is what the end of a run pushes. */
const toPush = async (): Promise<{ root: string; landed: string }> => {
    const { root } = await cloned()
    await git.checkoutWorktree(root, { path: ".afk/4/gate", branch: "afk/4/spec", startPoint: "main" })
    const gate = join(root, ".afk/4/gate")

    await commit(gate, "the-ticket")
    return { root, landed: await sh(gate, "rev-parse", "HEAD") }
}

describe("createGit().push", () => {
    it("should put the spec branch on the remote, which is what the pull request is opened from", async () => {
        // given
        const { root, landed } = await toPush()

        // when
        await git.push(root, "afk/4/spec")

        // then
        expect(await sh(root, "ls-remote", "origin", "refs/heads/afk/4/spec")).toContain(landed)
    })

    it("should set the branch's upstream, so that pushing it again needs no arguments", async () => {
        // given
        const { root } = await toPush()

        // when
        await git.push(root, "afk/4/spec")

        // then
        expect(await sh(root, "rev-parse", "--abbrev-ref", "afk/4/spec@{upstream}")).toBe("origin/afk/4/spec")
    })

    it("should leave trunk where it was: a push moves nothing the operator can see", async () => {
        // given
        const { root } = await toPush()
        const before = await sh(root, "rev-parse", "main")

        // when
        await git.push(root, "afk/4/spec")

        // then
        expect(await sh(root, "rev-parse", "main")).toBe(before)
    })

    it("should report a push there is no remote for, rather than reporting success over it", async () => {
        // given — a repository with no origin at all
        const root = await repository()
        await git.checkoutWorktree(root, { path: ".afk/4/gate", branch: "afk/4/spec", startPoint: "main" })

        // when
        const pushed = await git.push(root, "afk/4/spec")

        // then
        expect(pushed.ok).toBe(false)
    })

    it("should say what git said when it refused", async () => {
        // given
        const root = await repository()

        // when
        const pushed = await git.push(root, "afk/4/spec")

        // then
        expect(pushed).toEqual({ ok: false, reason: expect.stringContaining("origin") })
    })
})
