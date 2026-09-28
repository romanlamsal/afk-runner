import { describe, expect, it } from "vitest"
import type { AgentUsage } from "../../src/domain/agent.ts"
import type { Progress } from "../../src/domain/events.ts"
import { PROFILES } from "../../src/domain/profiles.ts"
import type { PreparedRun } from "../../src/domain/run.ts"
import { createFinishService } from "../../src/service/finish.ts"
import { createFakeAgent } from "../fakes/agent.ts"
import { createFakeEventLog } from "../fakes/event-log.ts"
import { createFakeGit, type FakeRepository } from "../fakes/git.ts"
import { createFakeTracker, type FakeTracker, type FakeTrackerSetup } from "../fakes/tracker.ts"
import { manifestOf, ticket } from "../fixtures/manifest.ts"

/**
 * The finish service: the branch is pushed, an agent writes a ready pull request's prose, and
 * the one pull request a spec has is opened or updated. What is asserted is what reached the remote and what the tracker was asked
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

    it("should close every verified ticket", async () => {
        // given
        const { finish, tracker } = harness()

        // when
        await finish({ verified: [5, 6] })

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

describe("the finish service: a partial spec", () => {
    it("should open a draft titled for the spec itself", async () => {
        // given
        const { finish, tracker } = harness()

        // when
        await finish({ verified: [5], failed: [6] })

        // then
        expect(tracker.opened.at(0)?.title).toBe("Spec #4")
    })

    it("should run no writer, a draft carrying no prose", async () => {
        // given
        const { finish, agent } = harness()

        // when
        await finish({ verified: [5], failed: [6] })

        // then
        expect(agent.invocations).toEqual([])
    })

    it("should write no pull-request step, no writer having run", async () => {
        // given
        const { finish, events } = harness()

        // when
        await finish({ verified: [5], failed: [6] })

        // then
        expect(events.appended).toEqual([])
    })
})

/**
 * A spec has one spec PR across all its runs (ADR-0040): what is found for the spec branch decides
 * whether this run opens one, updates the one there is, or leaves a closed draft closed.
 */
describe("the finish service: a spec branch that already had a pull request", () => {
    const OPEN_DRAFT = { number: 3, url: "https://example.invalid/pull/3", state: "open", draft: true } as const
    const CLOSED_DRAFT = { ...OPEN_DRAFT, state: "closed" } as const

    it("should update an open draft ready for review once the spec is whole", async () => {
        // given
        const { finish, tracker } = harness({ tracker: { found: [OPEN_DRAFT] } })

        // when
        await finish({ verified: [5, 6] })

        // then
        expect(tracker.updated).toEqual([
            expect.objectContaining({ number: 3, title: "Layerless afk", markAs: "ready" }),
        ])
    })

    it("should update an open draft and keep it a draft while the spec is partial", async () => {
        // given
        const { finish, tracker } = harness({ tracker: { found: [OPEN_DRAFT] } })

        // when
        await finish({ verified: [5], failed: [6] })

        // then
        expect(tracker.updated).toEqual([expect.objectContaining({ number: 3, title: "Spec #4", markAs: undefined })])
    })

    it("should open nothing beside the one it updated", async () => {
        // given
        const { finish, tracker } = harness({ tracker: { found: [OPEN_DRAFT] } })

        // when
        await finish({ verified: [5, 6] })

        // then
        expect(tracker.opened).toEqual([])
    })

    it("should report the one it updated", async () => {
        // given
        const { finish } = harness({ tracker: { found: [OPEN_DRAFT] } })

        // when
        const finished = await finish({ verified: [5, 6] })

        // then
        expect(finished).toEqual({ outcome: "updated", draft: false, url: "https://example.invalid/pull/3" })
    })

    it("should open a ready one over a draft the operator closed once the spec is whole", async () => {
        // given
        const { finish, tracker } = harness({ tracker: { found: [CLOSED_DRAFT] } })

        // when
        await finish({ verified: [5, 6] })

        // then
        expect(tracker.opened).toEqual([expect.objectContaining({ draft: false })])
    })

    it.each([
        { what: "open nothing", read: (tracker: FakeTracker) => tracker.opened },
        { what: "update nothing", read: (tracker: FakeTracker) => tracker.updated },
    ] as const)("should $what where the operator closed the draft and the spec is still partial", async ({ read }) => {
        // given
        const { finish, tracker } = harness({ tracker: { found: [CLOSED_DRAFT] } })

        // when
        await finish({ verified: [5], failed: [6] })

        // then
        expect(read(tracker)).toEqual([])
    })

    it("should still push the branch where it leaves the closed draft closed", async () => {
        // given
        const { finish, git } = harness({ tracker: { found: [CLOSED_DRAFT] } })

        // when
        await finish({ verified: [5], failed: [6] })

        // then
        expect(git.pushed).toEqual(["afk/4/spec"])
    })

    it("should report the closed draft it left closed", async () => {
        // given
        const { finish } = harness({ tracker: { found: [CLOSED_DRAFT] } })

        // when
        const finished = await finish({ verified: [5], failed: [6] })

        // then
        expect(finished).toEqual({ outcome: "left", draft: true, url: "https://example.invalid/pull/3" })
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

describe("the finish service: what the tracker would not answer", () => {
    it("should name the branch when its pull requests could not be looked up", async () => {
        // given
        const { finish } = harness({ tracker: { unfindable: "gh is not authenticated" } })

        // when
        const finished = await finish({ verified: [5, 6] })

        // then
        expect(finished).toEqual({
            outcome: "failed",
            reason: "the pull requests for afk/4/spec could not be looked up: gh is not authenticated",
        })
    })

    it("should name the branch when its pull request could not be updated", async () => {
        // given
        const found = [{ number: 3, url: "https://example.invalid/pull/3", state: "open", draft: true }] as const
        const { finish } = harness({ tracker: { found, unupdatable: "gh timed out" } })

        // when
        const finished = await finish({ verified: [5, 6] })

        // then
        expect(finished).toEqual({
            outcome: "failed",
            reason: "the pull request for afk/4/spec could not be updated: gh timed out",
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
