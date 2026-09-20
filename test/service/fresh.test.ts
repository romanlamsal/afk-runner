import { describe, expect, it } from "vitest"
import type { Holder } from "../../src/domain/lock.ts"
import { createFreshService, type FreshResult } from "../../src/service/fresh.ts"
import { createFakeGit, type FakeGit, type FakeRepository } from "../fakes/git.ts"
import { createFakeRunLock, type FakeRunLock } from "../fakes/run-lock.ts"
import { createFakeRunRecords, type FakeRunRecords } from "../fakes/run-records.ts"
import { createFakeTakeOver } from "../fakes/takeover.ts"
import { createFakeTracker, type FakeTracker, type FakeTrackerSetup } from "../fakes/tracker.ts"

/**
 * Starting over: everything one spec's run left behind, taken away in one command. What is asserted
 * is what the repository and the tracker look like afterwards — and, twice over, what was left
 * alone: the operator's own branches, and every claim the run made.
 */

/** A run that got as far as a pushed spec branch, two tickets and the worktrees for both. */
const RAN: FakeRepository = {
    branches: {
        main: ["trunk-1"],
        "afk/4/spec": ["trunk-1", "squash-5"],
        "afk/4/t5": ["trunk-1", "work-5"],
        "afk/4/t6": ["trunk-1", "work-6"],
    },
    checkouts: { ".afk/4/gate": "afk/4/spec", ".afk/4/t5": "afk/4/t5", ".afk/4/t6": "afk/4/t6" },
    remoteBranches: ["main", "afk/4/spec"],
}

type Harness = {
    fresh: () => Promise<FreshResult>
    git: FakeGit
    records: FakeRunRecords
    tracker: FakeTracker
    lock: FakeRunLock
}

const harness = ({
    repository = RAN,
    tracker: setup = { openFor: ["afk/4/spec"] },
    unremovable,
    heldBy,
    takesOver = false,
}: {
    repository?: FakeRepository
    tracker?: FakeTrackerSetup
    /** Why the run directory will not go, for a machine that holds on to it. */
    unremovable?: string
    /** Who holds the run lock already, if anybody (ADR-0036). */
    heldBy?: Holder
    /** What the operator said to taking over a live holder, where they were asked (ADR-0035). */
    takesOver?: boolean
} = {}): Harness => {
    const git = createFakeGit(repository)
    const records = createFakeRunRecords({ unremovable })
    const tracker = createFakeTracker(setup)
    const lock = createFakeRunLock({ heldBy })
    const service = createFreshService({
        cwd: "/repo/packages/thing",
        git: git.git,
        lock: lock.lock,
        self: { pid: 1 },
        records: records.records,
        tracker: tracker.tracker,
        takeOver: createFakeTakeOver(lock, takesOver),
    })

    return { git, records, tracker, lock, fresh: () => service(4) }
}

describe("the fresh service: a run thrown away", () => {
    it("should take away every worktree the run registered", async () => {
        // given
        const { fresh, git } = harness()

        // when
        await fresh()

        // then
        expect(git.checkedOut()).toEqual([])
    })

    it("should remove the run directory", async () => {
        // given
        const { fresh, records } = harness()

        // when
        await fresh()

        // then
        expect(records.removed).toEqual([{ root: "/repo", spec: 4 }])
    })

    it("should delete every branch this spec's run owns", async () => {
        // given
        const { fresh, git } = harness()

        // when
        await fresh()

        // then
        expect(git.localBranches()).toEqual(["main"])
    })

    it("should delete this spec's branches on the remote too", async () => {
        // given
        const { fresh, git } = harness()

        // when
        await fresh()

        // then
        expect(git.onRemote()).toEqual(["main"])
    })

    it("should close the pull request the run opened", async () => {
        // given
        const { fresh, tracker } = harness()

        // when
        await fresh()

        // then
        expect(tracker.closed).toEqual(["afk/4/spec"])
    })

    it("should report the pull request it closed, because that is the one thing it undid off this machine", async () => {
        // given
        const { fresh } = harness()

        // when
        const result = await fresh()

        // then
        expect(result).toEqual({ outcome: "cleared", pullRequest: true })
    })

    it("should never release a claim, so that an attempted ticket stays findable", async () => {
        // given
        const { fresh, tracker } = harness()

        // when
        await fresh()

        // then
        expect(tracker.claimed).toEqual([])
    })
})

describe("the fresh service: a spec with nothing left of it", () => {
    const nothing = { repository: { branches: { main: ["trunk-1"] } }, tracker: {} }

    it("should clear it anyway, because the flag says what to throw away rather than what exists", async () => {
        // given
        const { fresh } = harness(nothing)

        // when
        const result = await fresh()

        // then
        expect(result).toEqual({ outcome: "cleared", pullRequest: false })
    })

    it("should leave the operator's own branches where they are", async () => {
        // given
        const { fresh, git } = harness(nothing)

        // when
        await fresh()

        // then
        expect(git.localBranches()).toEqual(["main"])
    })
})

describe("the fresh service: what it will not do", () => {
    it("should refuse a directory that is not in a repository", async () => {
        // given
        const { fresh } = harness({ repository: { root: undefined } })

        // when
        const result = await fresh()

        // then
        expect(result).toEqual({ outcome: "failed", reason: expect.stringContaining("not a git worktree") })
    })

    it("should report a branch git would not delete rather than reporting success over it", async () => {
        // given: a worktree outside the run directory holds the spec branch, so git refuses to delete it
        const { fresh } = harness({
            repository: { ...RAN, checkouts: { ...RAN.checkouts, "elsewhere/gate": "afk/4/spec" } },
        })

        // when
        const result = await fresh()

        // then
        expect(result).toEqual({ outcome: "failed", reason: expect.stringContaining("afk/4/spec") })
    })

    it("should leave the run directory where it is when a worktree could not be taken away, because deleting it would strand the worktree", async () => {
        // given
        const { fresh, records } = harness({
            repository: { ...RAN, worktreeRemoval: { ok: false, reason: "is locked" } },
        })

        // when
        await fresh()

        // then
        expect(records.removed).toEqual([])
    })

    it("should keep the run directory when the pull request could not be closed, so that the event log and the transcripts survive a retry", async () => {
        // given
        const { fresh, records } = harness({
            tracker: { openFor: ["afk/4/spec"], unclosable: "gh: not authenticated" },
        })

        // when
        await fresh()

        // then
        expect(records.removed).toEqual([])
    })

    it("should report a run directory that would not go, rather than reporting a clean slate", async () => {
        // given
        const { fresh } = harness({ unremovable: "EBUSY: resource busy or locked" })

        // when
        const result = await fresh()

        // then
        expect(result).toEqual({ outcome: "failed", reason: expect.stringContaining("EBUSY") })
    })

    it("should report a remote that refused the deletion", async () => {
        // given
        const { fresh } = harness({ repository: { ...RAN, deleteRemote: { ok: false, reason: "protected branch" } } })

        // when
        const result = await fresh()

        // then
        expect(result).toEqual({ outcome: "failed", reason: expect.stringContaining("protected branch") })
    })

    it("should report a pull request the tracker would not close", async () => {
        // given
        const { fresh } = harness({ tracker: { openFor: ["afk/4/spec"], unclosable: "gh: not authenticated" } })

        // when
        const result = await fresh()

        // then
        expect(result).toEqual({ outcome: "failed", reason: expect.stringContaining("gh: not authenticated") })
    })

    it("should leave the branches alone when the pull request could not be closed, so that a retry still finds them", async () => {
        // given
        const { fresh, git } = harness({ tracker: { openFor: ["afk/4/spec"], unclosable: "gh: not authenticated" } })

        // when
        await fresh()

        // then
        expect(git.localBranches()).toContain("afk/4/spec")
    })
})

describe("the fresh service: the run lock", () => {
    it("should throw nothing away while another afk holds the run, naming it", async () => {
        // given
        const { fresh } = harness({ heldBy: { pid: 7 } })

        // when
        const result = await fresh()

        // then
        expect(result).toEqual({ outcome: "failed", reason: expect.stringContaining("afk process 7") })
    })

    it("should leave the run's worktrees alone while another afk holds the run", async () => {
        // given
        const { fresh, git } = harness({ heldBy: { pid: 7 } })

        // when
        await fresh()

        // then
        expect(git.checkedOut()).toContain(".afk/4/gate")
    })

    it("should throw away a run whose lock names a process that no longer exists", async () => {
        // given
        const harnessed = harness({ heldBy: { pid: 7 } })
        harnessed.lock.die(7)

        // when
        const result = await harnessed.fresh()

        // then
        expect(result.outcome).toBe("cleared")
    })
})

describe("the fresh service: taking over a live run", () => {
    it("should throw the run away once the operator has taken it over", async () => {
        // given
        const { fresh } = harness({ heldBy: { pid: 7 }, takesOver: true })

        // when
        const result = await fresh()

        // then
        expect(result.outcome).toBe("cleared")
    })
})
