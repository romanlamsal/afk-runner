import { describe, expect, it } from "vitest"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import type { Manifest } from "../../src/domain/manifest.ts"
import type { PreparedRun } from "../../src/domain/run.ts"
import type { StepResult } from "../../src/service/attempt.ts"
import { createMergeService } from "../../src/service/merge.ts"
import { createFakeEventLog } from "../fakes/event-log.ts"
import { createFakeGit, type FakeRepository } from "../fakes/git.ts"

/**
 * The squash and its trailer cross-check, which is the whole of the merge step (ADR-0026). What is
 * asserted is what the service did through its ports — what it put on the spec branch, and what
 * reached the log.
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

/** A ticket already rebased onto the spec branch's tip, which is what a merge is handed. */
const REPOSITORY: FakeRepository = {
    branches: { main: ["cut"], "afk/4/spec": ["cut", "a-sibling"], "afk/4/t7": ["cut", "a-sibling", "the-work"] },
    checkouts: { ".afk/4/t7": "afk/4/t7", ".afk/4/gate": "afk/4/spec" },
}

type Setup = {
    repository?: FakeRepository
    /** What the log already carries, which is where the resolver's note is read back from. */
    log?: readonly LifecycleEvent[]
}

const harness = ({ repository = REPOSITORY, log = [] }: Setup = {}) => {
    const git = createFakeGit(repository)
    const events = createFakeEventLog(log)

    const merge = createMergeService({
        events: events.log,
        git: git.git,
        now: () => new Date("2026-09-15T11:18:38.314Z"),
    })

    return {
        events,
        git,
        merge: (ticket = 7): Promise<StepResult> => merge(RUN, { ticket }),
        /** Every event this merge appended, which is what the log carried before left out. */
        appended: (): readonly LifecycleEvent[] => events.appended.slice(log.length),
    }
}

const steps = (appended: readonly LifecycleEvent[]): string[] => appended.map(event => `${event.step} ${event.outcome}`)

describe("the merge service: landing a ticket on the spec branch", () => {
    it("should squash the ticket onto the spec branch in the gate worktree, its sole writer", async () => {
        // given
        const { merge, git } = harness()

        // when
        await merge()

        // then
        expect(git.commitsOn("afk/4/spec")).toEqual(["cut", "a-sibling", "squash-afk/4/t7"])
    })

    it("should write one start event and one end event", async () => {
        // given
        const { merge, appended } = harness()

        // when
        await merge()

        // then
        expect(steps(appended())).toEqual(["merge running", "merge ok"])
    })

    it("should report the landing, and leave proving it to the gate action that follows", async () => {
        // given
        const { merge } = harness()

        // when
        const result = await merge()

        // then
        expect(result).toEqual({ outcome: "ok" })
    })

    it.each([
        ["the implementer's own commit messages", "the-work"],
        ["the ticket trailer, which is the git-side record of what landed", "afk-ticket: 4/7"],
    ] as const)("should give the squash %s", async (_name, expected) => {
        // given
        const { merge, git } = harness()

        // when
        await merge()

        // then
        expect(git.messageOf("squash-afk/4/t7")).toContain(expected)
    })

    it("should quote the resolver's note, read back off the log rather than carried along", async () => {
        // given — a note an earlier process's resolve left behind (ADR-0007)
        const { merge, git } = harness({
            log: [
                {
                    ticket: 7,
                    step: "resolve",
                    outcome: "ok",
                    at: "2026-09-15T10:00:00.000Z",
                    detail: "kept both",
                },
            ],
        })

        // when
        await merge()

        // then
        expect(git.messageOf("squash-afk/4/t7")).toContain("Conflict resolution: kept both")
    })

    it("should fail the ticket rather than squash a body it could not read the commits for", async () => {
        // given
        const { merge, appended } = harness({ repository: { ...REPOSITORY, unreadable: ["afk/4/t7"] } })

        // when
        await merge()

        // then
        expect(steps(appended())).toEqual(["merge running", "merge failed"])
    })

    it("should never squash a ticket whose body it could not read", async () => {
        // given
        const { merge, git } = harness({ repository: { ...REPOSITORY, unreadable: ["afk/4/t7"] } })

        // when
        await merge()

        // then
        expect(git.commitsOn("afk/4/spec")).toEqual(["cut", "a-sibling"])
    })

    it("should halt the run for a ticket the manifest does not list", async () => {
        // given
        const { merge } = harness()

        // when
        const result = await merge(99)

        // then
        expect(result).toEqual({ outcome: "halted", reason: "#99 is not a ticket of spec #4" })
    })
})

describe("the merge service: a ticket the spec branch already carries", () => {
    /** What a run killed between a squash and its lifecycle event leaves behind. */
    const landed: FakeRepository = {
        ...REPOSITORY,
        branches: {
            main: ["cut"],
            "afk/4/spec": ["cut", "a-sibling", "already-squashed"],
            "afk/4/t7": ["cut", "a-sibling", "the-work"],
        },
        messages: { "already-squashed": "Implement the slate (#7)\n\nafk-ticket: 4/7" },
    }

    it("should leave the spec branch exactly where it is rather than squash it twice", async () => {
        // given
        const { merge, git } = harness({ repository: landed })

        // when
        await merge()

        // then
        expect(git.commitsOn("afk/4/spec")).toEqual(["cut", "a-sibling", "already-squashed"])
    })

    it("should record the merge it found, so that the log says what git says", async () => {
        // given
        const { merge, appended } = harness({ repository: landed })

        // when
        await merge()

        // then
        expect(steps(appended())).toEqual(["merge running", "merge ok"])
    })

    it("should fail the ticket rather than guess when it cannot read what the branch carries", async () => {
        // given
        const { merge, appended } = harness({ repository: { ...REPOSITORY, unreadable: ["afk/4/spec"] } })

        // when
        await merge()

        // then
        expect(steps(appended())).toEqual(["merge running", "merge failed"])
    })
})
