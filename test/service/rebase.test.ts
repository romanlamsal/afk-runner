import { describe, expect, it } from "vitest"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import type { Manifest } from "../../src/domain/manifest.ts"
import type { PreparedRun } from "../../src/domain/run.ts"
import type { StepResult } from "../../src/service/attempt.ts"
import { createRebaseService } from "../../src/service/rebase.ts"
import { createFakeEventLog } from "../fakes/event-log.ts"
import { createFakeGit, type FakeRepository } from "../fakes/git.ts"

/**
 * The head of the merge track, on its own. What is asserted is what the service did through its
 * ports — where it rebased, and what reached the log.
 */

const MANIFEST: Manifest = {
    spec: 4,
    setup: "npm ci",
    verify: "npm run check",
    tickets: [{ number: 7, title: "Implement the slate", blockedBy: [] }],
}

const RUN: PreparedRun = {
    root: "/repo",
    spec: 4,
    base: "main",
    branch: "afk/4/spec",
    gate: ".afk/4/gate",
    manifest: MANIFEST,
}

/** A spec branch a sibling already landed on, and a ticket branch cut before that happened. */
const REPOSITORY: FakeRepository = {
    branches: { main: ["cut"], "afk/4/spec": ["cut", "a-sibling"], "afk/4/t7": ["cut", "the-work"] },
    checkouts: { ".afk/4/t7": "afk/4/t7", ".afk/4/gate": "afk/4/spec" },
}

const harness = (repository: FakeRepository = REPOSITORY) => {
    const git = createFakeGit(repository)
    const events = createFakeEventLog()

    const rebase = createRebaseService({
        events: events.log,
        git: git.git,
        now: () => new Date("2026-09-15T11:18:38.314Z"),
    })

    return { events, git, rebase: (ticket = 7): Promise<StepResult> => rebase(RUN, { ticket }) }
}

const steps = (appended: readonly LifecycleEvent[]): string[] => appended.map(event => `${event.step} ${event.outcome}`)

describe("the rebase service: a ticket that rebases cleanly", () => {
    it("should rebase the ticket onto the spec branch in the ticket's own worktree", async () => {
        // given
        const { rebase, git } = harness()

        // when
        await rebase()

        // then
        expect(git.rebases).toEqual([{ path: ".afk/4/t7", onto: "afk/4/spec" }])
    })

    it("should leave the ticket's work on the spec branch's tip", async () => {
        // given
        const { rebase, git } = harness()

        // when
        await rebase()

        // then
        expect(git.commitsOn("afk/4/t7")).toEqual(["cut", "a-sibling", "the-work"])
    })

    it("should rebase without probing first, even where nothing could conflict", async () => {
        // given — the ticket branch is already on the tip, so a fast path would skip the rebase
        const { rebase, git } = harness({
            branches: { main: ["cut"], "afk/4/spec": ["cut"], "afk/4/t7": ["cut", "the-work"] },
            checkouts: { ".afk/4/t7": "afk/4/t7", ".afk/4/gate": "afk/4/spec" },
        })

        // when
        await rebase()

        // then
        expect(git.rebases).toHaveLength(1)
    })

    it("should write one start event and one end event", async () => {
        // given
        const { rebase, events } = harness()

        // when
        await rebase()

        // then
        expect(steps(events.appended)).toEqual(["rebase running", "rebase ok"])
    })

    it("should leave the spec branch where it is, because landing on it is the merge's move", async () => {
        // given
        const { rebase, git } = harness()

        // when
        await rebase()

        // then
        expect(git.commitsOn("afk/4/spec")).toEqual(["cut", "a-sibling"])
    })
})

describe("the rebase service: a ticket that conflicts", () => {
    const colliding: FakeRepository = { ...REPOSITORY, colliding: ["afk/4/t7"] }

    it("should record the conflict git stopped the rebase at, rather than a failure", async () => {
        // given — ADR-0025: the log carries what git distinguished, so the reader sees which
        // tickets needed a resolver
        const { rebase, events } = harness(colliding)

        // when
        await rebase()

        // then
        expect(steps(events.appended)).toEqual(["rebase running", "rebase conflicted"])
    })

    it("should leave the conflict in the worktree, because the resolve is somebody else's move", async () => {
        // given
        const { rebase, git } = harness(colliding)

        // when
        await rebase()

        // then
        expect(await git.git.conflicted("/repo", ".afk/4/t7")).toBe(true)
    })
})

describe("the rebase service: a rebase that cannot start", () => {
    it("should fail the ticket when its worktree has uncommitted work a rebase would bury", async () => {
        // given
        const { rebase, git } = harness()
        git.soil(".afk/4/t7")

        // when
        const result = await rebase()

        // then
        expect(result).toEqual({ outcome: "failed" })
    })

    it("should never start a rebase over uncommitted work", async () => {
        // given
        const { rebase, git } = harness()
        git.soil(".afk/4/t7")

        // when
        await rebase()

        // then
        expect(git.rebases).toEqual([])
    })

    it("should record a rebase git refused to start as failed rather than as conflicted", async () => {
        // given — a ticket with no worktree to rebase in, which git will not start a rebase in
        const { rebase, events } = harness({ ...REPOSITORY, checkouts: { ".afk/4/gate": "afk/4/spec" } })

        // when
        await rebase()

        // then
        expect(steps(events.appended)).toEqual(["rebase running", "rebase failed"])
    })

    it("should name the spec branch as the fault when it points at no commit to rebase onto", async () => {
        // given
        const { rebase, events } = harness({
            branches: { main: ["cut"], "afk/4/t7": ["cut", "the-work"] },
            checkouts: { ".afk/4/t7": "afk/4/t7" },
        })

        // when
        await rebase()

        // then
        expect(events.appended.at(-1)?.detail).toContain("names no commit")
    })

    it("should halt the run for a ticket the manifest does not list", async () => {
        // given
        const { rebase } = harness()

        // when
        const result = await rebase(99)

        // then
        expect(result).toEqual({ outcome: "halted", reason: "#99 is not a ticket of spec #4" })
    })
})
