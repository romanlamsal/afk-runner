import { describe, expect, it } from "vitest"
import type { AgentResult } from "../../src/domain/agent.ts"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import type { Manifest } from "../../src/domain/manifest.ts"
import { PROFILES } from "../../src/domain/profiles.ts"
import type { PreparedRun } from "../../src/domain/run.ts"
import type { StepResult } from "../../src/service/attempt.ts"
import { createMergeService } from "../../src/service/merge.ts"
import { createFakeAgent } from "../fakes/agent.ts"
import { createFakeEventLog } from "../fakes/event-log.ts"
import { createFakeFix } from "../fakes/fix.ts"
import { createFakeGate } from "../fakes/gate.ts"
import { createFakeGit, type FakeRepository } from "../fakes/git.ts"

/**
 * One ticket through the merge track. What is asserted is what the service did through its ports —
 * where it rebased, where it put the resolver, and what reached the log.
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
    trunk: "main",
    branch: "afk/4/spec",
    gate: ".afk/4/gate",
    manifest: MANIFEST,
}

/** A spec branch a sibling already landed on, and a ticket branch cut before that happened. */
const REPOSITORY: FakeRepository = {
    branches: { main: ["cut"], "afk/4/spec": ["cut", "a-sibling"], "afk/4/t7": ["cut", "the-work"] },
    checkouts: { ".afk/4/t7": "afk/4/t7", ".afk/4/gate": "afk/4/spec" },
}

type Setup = {
    /** What the conflict resolver reported, if one was needed. */
    reply?: Partial<AgentResult>
    repository?: FakeRepository
    /** What the resolver did to the worktree. The default is one that finishes the rebase. */
    resolver?: "finishes" | "aborts" | "skips everything" | "gives up"
    /** The tickets whose gate goes red. */
    red?: readonly number[]
    /** The tickets whose red gate the one fix attempt makes green. */
    fixed?: readonly number[]
}

const harness = ({ reply, repository = REPOSITORY, resolver = "finishes", red = [], fixed = [] }: Setup = {}) => {
    const git = createFakeGit(repository)
    const agent = createFakeAgent(reply)
    const events = createFakeEventLog()
    const gate = createFakeGate(red)
    const fix = createFakeFix(fixed)

    const merge = createMergeService({
        agent: async invocation => {
            const result = await agent.run(invocation)
            if (resolver === "finishes") {
                git.resolve(invocation.cwd)
            }
            if (resolver === "aborts") {
                await git.git.abortRebase(invocation.root, invocation.cwd)
            }
            if (resolver === "skips everything") {
                git.resolveAway(invocation.cwd)
            }
            return result
        },
        events: events.log,
        gate: gate.gate,
        git: git.git,
        now: () => new Date("2026-09-15T11:18:38.314Z"),
        fix: fix.fix,
    })

    return {
        agent,
        events,
        gate,
        git,
        fix,
        merge: (ticket = 7): Promise<StepResult> => merge(RUN, { ticket, attempt: 1 }),
    }
}

const steps = (appended: readonly LifecycleEvent[]): string[] => appended.map(event => `${event.step} ${event.outcome}`)

describe("the merge service: a ticket that rebases cleanly", () => {
    it("should rebase the ticket onto the spec branch in the ticket's own worktree", async () => {
        // given
        const { merge, git } = harness()

        // when
        await merge()

        // then
        expect(git.rebases).toEqual([{ path: ".afk/4/t7", onto: "afk/4/spec" }])
    })

    it("should leave the ticket's work on the spec branch's tip", async () => {
        // given
        const { merge, git } = harness()

        // when
        await merge()

        // then
        expect(git.commitsOn("afk/4/t7")).toEqual(["cut", "a-sibling", "the-work"])
    })

    it("should rebase without probing first, even where nothing could conflict", async () => {
        // given — the ticket branch is already on the tip, so a fast path would skip the rebase
        const { merge, git } = harness({
            repository: {
                branches: { main: ["cut"], "afk/4/spec": ["cut"], "afk/4/t7": ["cut", "the-work"] },
                checkouts: { ".afk/4/t7": "afk/4/t7", ".afk/4/gate": "afk/4/spec" },
            },
        })

        // when
        await merge()

        // then
        expect(git.rebases).toHaveLength(1)
    })

    it("should write one start event and one end event for every step it took", async () => {
        // given
        const { merge, events } = harness()

        // when
        await merge()

        // then
        expect(steps(events.appended)).toEqual(["rebase running", "rebase ok", "merge running", "merge ok"])
    })

    it("should spend no resolver on a rebase that landed by itself", async () => {
        // given
        const { merge, agent } = harness()

        // when
        await merge()

        // then
        expect(agent.invocations).toEqual([])
    })
})

describe("the merge service: a ticket that conflicts", () => {
    const colliding: FakeRepository = { ...REPOSITORY, colliding: ["afk/4/t7"] }

    it("should record the conflict git stopped the rebase at, before any resolver is called", async () => {
        // given — ADR-0025: the log carries what git distinguished, so the reader sees which
        // tickets needed a resolver
        const { merge, events } = harness({ repository: colliding })

        // when
        await merge()

        // then
        expect(steps(events.appended)[1]).toBe("rebase conflicted")
    })

    it("should run the conflict resolver in the ticket's own worktree, which is where the branch is", async () => {
        // given
        const { merge, agent } = harness({ repository: colliding })

        // when
        await merge()

        // then
        expect(agent.invocations[0]?.cwd).toBe(".afk/4/t7")
    })

    it("should hand the resolver the verify command, so that it checks what it produced", async () => {
        // given
        const { merge, agent } = harness({ repository: colliding })

        // when
        await merge()

        // then
        expect(agent.invocations[0]?.prompt).toContain("npm run check")
    })

    it("should land the rebase the resolver finished", async () => {
        // given
        const { merge, git } = harness({ repository: colliding })

        // when
        await merge()

        // then
        expect(git.commitsOn("afk/4/t7")).toEqual(["cut", "a-sibling", "the-work"])
    })

    it("should keep the resolver's note, which is what the squash body says", async () => {
        // given
        const { merge, events } = harness({
            repository: colliding,
            reply: { structuredOutput: { note: "both sides added a field; kept both" } },
        })

        // when
        await merge()

        // then
        expect(events.appended.find(event => event.step === "resolve" && event.outcome === "ok")?.detail).toBe(
            "both sides added a field; kept both",
        )
    })

    it("should leave the note out rather than invent one when the resolver reported none", async () => {
        // given
        const { merge, events } = harness({ repository: colliding, reply: { structuredOutput: undefined } })

        // when
        await merge()

        // then
        expect(
            events.appended.find(event => event.step === "resolve" && event.outcome === "ok")?.detail,
        ).toBeUndefined()
    })

    it("should record the resolver's session id, read from the stream rather than generated", async () => {
        // given
        const { merge, events } = harness({ repository: colliding })

        // when
        await merge()

        // then
        expect(events.appended.find(event => event.step === "resolve")?.sessionId).toBe("session-from-the-stream")
    })

    it("should write the resolver its own transcript", async () => {
        // given
        const { merge, agent } = harness({ repository: colliding })

        // when
        await merge()

        // then
        expect(agent.invocations[0]?.transcriptPath).toBe(".afk/4/transcripts/20260915T111838314Z-t7-resolve-1.jsonl")
    })

    it("should end the rebase green once the resolver has finished it", async () => {
        // given
        const { merge, events } = harness({ repository: colliding })

        // when
        await merge()

        // then
        expect(steps(events.appended)).toEqual([
            "rebase running",
            "rebase conflicted",
            "resolve running",
            "resolve ok",
            "rebase ok",
            "merge running",
            "merge ok",
        ])
    })
})

describe("the merge service: landing a ticket on the spec branch", () => {
    it("should squash the ticket onto the spec branch in the gate worktree, its sole writer", async () => {
        // given
        const { merge, git } = harness()

        // when
        await merge()

        // then
        expect(git.commitsOn("afk/4/spec")).toEqual(["cut", "a-sibling", "squash-afk/4/t7"])
    })

    it.each([
        ["the implementer's own commit messages", "the-work"],
        ["the ticket trailer, which is the git-side record of what landed", "afk-ticket: 4/7"],
        ["the resolver's note, so that a reviewer learns an agent judged it", "Conflict resolution: kept both"],
    ] as const)("should give the squash %s", async (_name, expected) => {
        // given — a conflicting ticket, so that there is a note as well as commits
        const { merge, git } = harness({
            repository: { ...REPOSITORY, colliding: ["afk/4/t7"] },
            reply: { structuredOutput: { note: "kept both" } },
        })

        // when
        await merge()

        // then
        expect(git.messageOf("squash-afk/4/t7")).toContain(expected)
    })

    it("should fail the ticket rather than squash a body it could not read the commits for", async () => {
        // given
        const { merge, events } = harness({ repository: { ...REPOSITORY, unreadable: ["afk/4/t7"] } })

        // when
        await merge()

        // then
        expect(steps(events.appended)).toEqual(["rebase running", "rebase ok", "merge running", "merge failed"])
    })

    it("should never squash a ticket whose body it could not read", async () => {
        // given
        const { merge, git } = harness({ repository: { ...REPOSITORY, unreadable: ["afk/4/t7"] } })

        // when
        await merge()

        // then
        expect(git.commitsOn("afk/4/spec")).toEqual(["cut", "a-sibling"])
    })

    it("should run the gate after the merge, because a red result must name one merge", async () => {
        // given
        const { merge, gate } = harness()

        // when
        await merge()

        // then
        expect(gate.gated).toEqual([7])
    })

    it("should remove a verified ticket's worktree, whose work is on the spec branch now", async () => {
        // given
        const { merge, git } = harness()

        // when
        await merge()

        // then
        expect(git.removed).toEqual([".afk/4/t7"])
    })

    it("should spend no fix attempt on a ticket the gate proved first time", async () => {
        // given
        const { merge, fix } = harness()

        // when
        await merge()

        // then
        expect(fix.attempted).toEqual([])
    })

    it("should hand a red gate to the fix service rather than end the ticket there (ADR-0009)", async () => {
        // given
        const { merge, fix } = harness({ red: [7] })

        // when
        await merge()

        // then
        expect(fix.attempted).toEqual([7])
    })

    it("should keep the worktree of a ticket the fix attempt could not save, because somebody has to read it", async () => {
        // given
        const { merge, git } = harness({ red: [7] })

        // when
        await merge()

        // then
        expect(git.removed).toEqual([])
    })

    it("should remove the worktree of a ticket the one fix attempt made green", async () => {
        // given
        const { merge, git } = harness({ red: [7], fixed: [7] })

        // when
        await merge()

        // then
        expect(git.removed).toEqual([".afk/4/t7"])
    })

    it.each([
        ["the fix attempt could not save", [], { outcome: "failed" }],
        ["the one fix attempt made green", [7], { outcome: "ok" }],
    ] as const)("should report the fate of a ticket %s as the merge track's own", async (_name, fixed, expected) => {
        // given
        const { merge } = harness({ red: [7], fixed })

        // when
        const result = await merge()

        // then
        expect(result).toEqual(expected)
    })
})

describe("the merge service: a ticket the spec branch already carries", () => {
    /** What a run killed between a squash and its lifecycle event leaves behind. */
    const landed: FakeRepository = {
        ...REPOSITORY,
        branches: {
            main: ["cut"],
            "afk/4/spec": ["cut", "a-sibling", "already-squashed"],
            "afk/4/t7": ["cut", "the-work"],
        },
        messages: { "already-squashed": "Implement the slate (#7)\n\nafk-ticket: 4/7" },
    }

    it("should never rebase it again, because the branch already carries its work", async () => {
        // given
        const { merge, git } = harness({ repository: landed })

        // when
        await merge()

        // then
        expect(git.rebases).toEqual([])
    })

    it("should leave the spec branch exactly where it is rather than squash it twice", async () => {
        // given
        const { merge, git } = harness({ repository: landed })

        // when
        await merge()

        // then
        expect(git.commitsOn("afk/4/spec")).toEqual(["cut", "a-sibling", "already-squashed"])
    })

    it("should still gate it, because the gate runs after every merge without exception", async () => {
        // given
        const { merge, gate } = harness({ repository: landed })

        // when
        await merge()

        // then
        expect(gate.gated).toEqual([7])
    })

    it("should record the merge it found, so that the log says what git says", async () => {
        // given
        const { merge, events } = harness({ repository: landed })

        // when
        await merge()

        // then
        expect(steps(events.appended)).toEqual(["merge running", "merge ok"])
    })

    it("should fail the ticket rather than guess when it cannot read what the branch carries", async () => {
        // given
        const { merge, events } = harness({ repository: { ...REPOSITORY, unreadable: ["afk/4/spec"] } })

        // when
        await merge()

        // then
        expect(steps(events.appended)).toEqual(["merge running", "merge failed"])
    })
})

describe("the merge service: a rebase that cannot land", () => {
    const colliding: FakeRepository = { ...REPOSITORY, colliding: ["afk/4/t7"] }

    it("should fail the ticket when its worktree has uncommitted work a rebase would bury", async () => {
        // given
        const { merge, git } = harness()
        git.soil(".afk/4/t7")

        // when
        const result = await merge()

        // then
        expect(result).toEqual({ outcome: "failed" })
    })

    it("should never start a rebase over uncommitted work", async () => {
        // given
        const { merge, git } = harness()
        git.soil(".afk/4/t7")

        // when
        await merge()

        // then
        expect(git.rebases).toEqual([])
    })

    it("should record a rebase git refused to start as failed rather than as conflicted", async () => {
        // given — a ticket with no worktree to rebase in, which git will not start a rebase in
        const { merge, events } = harness({ repository: { ...REPOSITORY, checkouts: { ".afk/4/gate": "afk/4/spec" } } })

        // when
        await merge()

        // then
        expect(steps(events.appended)).toEqual(["rebase running", "rebase failed"])
    })

    it("should fail the ticket when the resolver exits non-zero", async () => {
        // given
        const { merge, events } = harness({
            repository: colliding,
            reply: { outcome: "failed", detail: "the session ended" },
            resolver: "gives up",
        })

        // when
        await merge()

        // then
        expect(steps(events.appended)).toEqual([
            "rebase running",
            "rebase conflicted",
            "resolve running",
            "resolve failed",
            "rebase failed",
        ])
    })

    it("should abort the rebase the failed resolver left behind, because the resolver never does", async () => {
        // given
        const { merge, git } = harness({
            repository: colliding,
            reply: { outcome: "failed", detail: "the session ended" },
            resolver: "gives up",
        })

        // when
        await merge()

        // then
        expect(await git.git.conflicted("/repo", ".afk/4/t7")).toBe(false)
    })

    it("should fail the ticket when the resolver exits zero on a tree that is still conflicted", async () => {
        // given
        const { merge, events } = harness({ repository: colliding, resolver: "gives up" })

        // when
        await merge()

        // then
        expect(events.appended.find(event => event.outcome === "failed")?.detail).toContain("unfinished")
    })

    it("should fail the ticket when the resolver made the conflict go away by dropping the ticket's work", async () => {
        // given — a rebase skipped commit by commit lands on the tip carrying nothing of its own
        const { merge, events } = harness({ repository: colliding, resolver: "skips everything" })

        // when
        await merge()

        // then
        expect(events.appended.find(event => event.outcome === "failed")?.detail).toContain("nothing of it is left")
    })

    it("should fail the ticket when the resolver aborted the rebase rather than landing it", async () => {
        // given — an abort leaves a tree that is clean, unconflicted and exactly where it started
        const { merge, events } = harness({ repository: colliding, resolver: "aborts" })

        // when
        await merge()

        // then
        expect(events.appended.find(event => event.outcome === "failed")?.detail).toContain("without landing it")
    })

    it("should leave the spec branch exactly where it was", async () => {
        // given
        const { merge, git } = harness({ repository: colliding, resolver: "gives up" })

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

describe("the merge service: the conflict resolver's profile", () => {
    /** A repository whose ticket branch conflicts, so that a resolver is invoked at all. */
    const colliding: FakeRepository = { ...REPOSITORY, colliding: ["afk/4/t7"] }

    it("should be the role's own, and no other role's", async () => {
        // given
        const { merge, agent } = harness({ repository: colliding })

        // when
        await merge()

        // then
        expect(agent.invocations.at(0)?.profile).toBe(PROFILES.resolver)
    })
})
