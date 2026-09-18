import { describe, expect, it } from "vitest"
import type { AgentUsage } from "../../src/domain/agent.ts"
import type { Progress } from "../../src/domain/events.ts"
import { PROFILES } from "../../src/domain/profiles.ts"
import type { PreparedRun } from "../../src/domain/run.ts"
import { createFinishService } from "../../src/service/finish.ts"
import { createFakeAgent } from "../fakes/agent.ts"
import { createFakeEventLog } from "../fakes/event-log.ts"
import { createFakeGit, type FakeRepository } from "../fakes/git.ts"
import { createFakeTracker, type FakeTrackerSetup } from "../fakes/tracker.ts"
import { manifestOf, ticket } from "../fixtures/manifest.ts"

/**
 * The finish service: the branch is pushed, an agent writes the prose, and the one pull request a
 * run opens is opened. What is asserted is what reached the remote and what the tracker was asked
 * for — the body's composition is the domain's, and it is asserted there.
 */

const RUN: PreparedRun = {
    root: "/repo",
    spec: 4,
    base: "main",
    branch: "afk/4/spec",
    gate: ".afk/4/gate",
    manifest: manifestOf([ticket(5), ticket(6)]),
}

const nothing: Progress = { verified: [], unverified: [], failed: [], skipped: [] }

const WROTE = { title: "Layerless afk", summary: "One branch, one pull request." }

const harness = ({
    repository = { branches: { "afk/4/spec": ["spec-1"] } },
    tracker: setup = {},
    wrote = WROTE,
    writerFails = false,
    usage,
}: {
    repository?: FakeRepository
    tracker?: FakeTrackerSetup
    wrote?: unknown
    writerFails?: boolean
    /** What the writer's stream reported it consumed. */
    usage?: AgentUsage
} = {}) => {
    const git = createFakeGit(repository)
    const tracker = createFakeTracker(setup)
    const agent = createFakeAgent({
        outcome: writerFails ? "failed" : "ok",
        structuredOutput: wrote,
        detail: writerFails ? "the writer's session died" : "",
        usage,
    })

    const events = createFakeEventLog()

    const finish = createFinishService({
        agent: agent.run,
        events: events.log,
        git: git.git,
        now: () => new Date("2026-09-15T11:18:38.314Z"),
        tracker: tracker.tracker,
    })

    return {
        agent,
        events,
        git,
        tracker,
        finish: (progress: Partial<Progress>) => finish(RUN, { ...nothing, ...progress }),
    }
}

describe("the finish service: a run that verified something", () => {
    it("should push the spec branch", async () => {
        // given
        const { finish, git } = harness()

        // when
        await finish({ verified: [5, 6] })

        // then
        expect(git.pushed).toEqual(["afk/4/spec"])
    })

    it("should open the pull request from the spec branch onto the branch it was cut from", async () => {
        // given
        const { finish, tracker } = harness()

        // when
        await finish({ verified: [5, 6] })

        // then
        expect(tracker.opened).toEqual([expect.objectContaining({ head: "afk/4/spec", base: "main" })])
    })

    it("should open it ready for review when every ticket was verified", async () => {
        // given
        const { finish, tracker } = harness()

        // when
        await finish({ verified: [5, 6] })

        // then
        expect(tracker.opened.at(0)?.draft).toBe(false)
    })

    it("should open a draft when a ticket did not land", async () => {
        // given
        const { finish, tracker } = harness()

        // when
        await finish({ verified: [5], failed: [6] })

        // then
        expect(tracker.opened.at(0)).toEqual(expect.objectContaining({ draft: true }))
    })

    it("should carry the title the writer wrote", async () => {
        // given
        const { finish, tracker } = harness()

        // when
        await finish({ verified: [5, 6] })

        // then
        expect(tracker.opened.at(0)?.title).toBe("Layerless afk")
    })

    it("should close every verified ticket and no other", async () => {
        // given
        const { finish, tracker } = harness()

        // when
        await finish({ verified: [5], failed: [6] })

        // then
        expect(tracker.opened.at(0)?.body).toContain("Closes #5")
    })

    it("should report where the pull request is", async () => {
        // given
        const { finish } = harness({ tracker: { url: "https://example.invalid/pull/9" } })

        // when
        const finished = await finish({ verified: [5, 6] })

        // then
        expect(finished).toEqual({ outcome: "opened", draft: false, url: "https://example.invalid/pull/9" })
    })

    it("should run the writer in the gate worktree, where the spec branch is checked out", async () => {
        // given
        const { finish, agent } = harness()

        // when
        await finish({ verified: [5, 6] })

        // then
        expect(agent.invocations.at(0)?.cwd).toBe(".afk/4/gate")
    })

    it("should write the writer's transcript under the run directory", async () => {
        // given
        const { finish, agent } = harness()

        // when
        await finish({ verified: [5, 6] })

        // then
        expect(agent.invocations.at(0)?.transcriptPath).toContain(".afk/4/transcripts/")
    })

    it.each([
        { what: "failed outright", wrote: undefined, writerFails: true },
        { what: "reported nothing afk could use", wrote: { title: "" }, writerFails: false },
    ] as const)("should still open the pull request when the writer $what", async ({ wrote, writerFails }) => {
        // given
        const { finish, tracker } = harness({ wrote, writerFails })

        // when
        await finish({ verified: [5, 6] })

        // then
        expect(tracker.opened.at(0)?.title).toBe("Spec #4")
    })
})

describe("the finish service: a run that verified nothing", () => {
    it("should open no pull request at all", async () => {
        // given
        const { finish, tracker } = harness()

        // when
        await finish({ failed: [5], skipped: [6] })

        // then
        expect(tracker.opened).toEqual([])
    })

    it("should not push the branch either", async () => {
        // given
        const { finish, git } = harness()

        // when
        await finish({ failed: [5], skipped: [6] })

        // then
        expect(git.pushed).toEqual([])
    })

    it("should say what became of the tickets instead", async () => {
        // given
        const { finish } = harness()

        // when
        const finished = await finish({ failed: [5], skipped: [6] })

        // then
        expect(finished).toEqual({
            outcome: "failed",
            reason: "no ticket of spec #4 was verified, so there is no pull request to open: failed: #5, skipped: #6",
        })
    })
})

describe("the finish service: what it does not report success over", () => {
    it("should name the branch when the push failed", async () => {
        // given
        const { finish } = harness({ repository: { push: { ok: false, reason: "remote rejected" } } })

        // when
        const finished = await finish({ verified: [5, 6] })

        // then
        expect(finished).toEqual({
            outcome: "failed",
            reason: "afk/4/spec could not be pushed: remote rejected",
        })
    })

    it("should open no pull request when the push failed", async () => {
        // given
        const { finish, tracker } = harness({ repository: { push: { ok: false, reason: "remote rejected" } } })

        // when
        await finish({ verified: [5, 6] })

        // then
        expect(tracker.opened).toEqual([])
    })

    it("should name the branch when the pull request could not be opened", async () => {
        // given
        const { finish } = harness({ tracker: { unopenable: "a pull request for afk/4/spec already exists" } })

        // when
        const finished = await finish({ verified: [5, 6] })

        // then
        expect(finished).toEqual({
            outcome: "failed",
            reason:
                "the pull request for afk/4/spec could not be opened: " +
                "a pull request for afk/4/spec already exists",
        })
    })
})

describe("the finish service: the pull request writer's profile", () => {
    it("should be the role's own, and no other role's", async () => {
        // given
        const { finish, agent } = harness()

        // when
        await finish({ verified: [5, 6] })

        // then
        expect(agent.invocations.at(0)?.profile).toBe(PROFILES.pullRequestWriter)
    })
})

/**
 * The `pull-request` step. It is about the run rather than about one ticket, so its events carry no
 * ticket (ADR-0028) — and it gets a start and an end like every other step, which is what makes the
 * writer's consumption a reading rather than an argument (ADR-0011, ADR-0027).
 */
describe("the finish service: the pull-request step", () => {
    it("should write one start event and one end event", async () => {
        // given
        const { finish, events } = harness()

        // when
        await finish({ verified: [5, 6] })

        // then
        expect(events.appended.map(event => `${event.step} ${event.outcome}`)).toEqual([
            "pull-request running",
            "pull-request ok",
        ])
    })

    it("should name no ticket, the step being about the run", async () => {
        // given
        const { finish, events } = harness()

        // when
        await finish({ verified: [5, 6] })

        // then
        expect(events.appended.every(event => event.ticket === undefined)).toBe(true)
    })

    it("should record what the writer consumed on the end event", async () => {
        // given
        const usage = {
            inputTokens: 1600,
            outputTokens: 29700,
            cacheReadInputTokens: 1600,
            cacheCreationInputTokens: 86,
        }
        const { finish, events } = harness({ usage })

        // when
        await finish({ verified: [5, 6] })

        // then
        expect(events.appended.at(-1)?.usage).toEqual(usage)
    })

    it("should record the writer's failure while the run carries on regardless", async () => {
        // given
        const { finish, events } = harness({ writerFails: true })

        // when
        await finish({ verified: [5, 6] })

        // then
        expect(events.appended.at(-1)?.outcome).toBe("failed")
    })

    it("should write nothing where it opens nothing, no writer having run", async () => {
        // given
        const { finish, events } = harness()

        // when
        await finish({ verified: [] })

        // then
        expect(events.appended).toEqual([])
    })
})
