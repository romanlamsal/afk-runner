import { describe, expect, it } from "vitest"
import type { AgentResult } from "../../src/domain/agent.ts"
import type { BrokenStep, LifecycleEvent } from "../../src/domain/events.ts"
import type { Manifest } from "../../src/domain/manifest.ts"
import type { PreparedRun } from "../../src/domain/run.ts"
import type { StepResult } from "../../src/service/attempt.ts"
import { createPrepareService } from "../../src/service/prepare.ts"
import { createFakeAgent } from "../fakes/agent.ts"
import { createFakeEventLog } from "../fakes/event-log.ts"
import { createFakeGit, type FakeRepository } from "../fakes/git.ts"

/**
 * The one pass a wrecked ticket gets before the normal track picks it back up. What is asserted is
 * where the agent was sent, what reached the log, and what the pass is worth to the ticket — never
 * the wording it was sent with (ADR-0012).
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

/** A repository where the ticket's implementer got as far as a worktree of its own. */
const WORKED: FakeRepository = {
    branches: { "afk/4/spec": ["spec-tip"], "afk/4/t7": ["spec-tip", "the-work"] },
    checkouts: { ".afk/4/t7": "afk/4/t7" },
}

const event = (step: LifecycleEvent["step"], outcome: LifecycleEvent["outcome"]): LifecycleEvent => ({
    ticket: 7,
    step,
    outcome,
    at: "2026-09-15T11:18:38.314Z",
})

type Setup = {
    /** What the prepare agent reported. */
    reply?: Partial<AgentResult>
    repository?: FakeRepository
    /** What an earlier attempt left in the log. */
    log?: readonly LifecycleEvent[]
    brokenStep?: BrokenStep
    /** The ticket the pass is sent to, for the one that is not this run's work. */
    ticket?: number
}

const harness = ({ reply, repository = WORKED, log = [], brokenStep = "implement", ticket = 7 }: Setup = {}) => {
    const agent = createFakeAgent(reply)
    const events = createFakeEventLog(log)
    const git = createFakeGit(repository)

    const prepare = createPrepareService({
        agent: agent.run,
        events: events.log,
        git: git.git,
        now: () => new Date("2026-09-15T11:18:38.314Z"),
    })

    return {
        agent,
        events,
        git,
        prepare: (): Promise<StepResult> => prepare(RUN, { ticket, brokenStep }),
    }
}

const settled = (appended: readonly LifecycleEvent[]): string[] =>
    appended.map(event => `${event.step} ${event.outcome}`)

describe("the prepare service", () => {
    it("should send the agent into the ticket's own worktree and no other", async () => {
        // given
        const { prepare, agent } = harness()

        // when
        await prepare()

        // then
        expect(agent.invocations[0]?.cwd).toBe(".afk/4/t7")
    })

    it("should tell the agent which step broke, so that it is never sent with no instruction", async () => {
        // given
        const { prepare, agent } = harness({ brokenStep: "rebase" })

        // when
        await prepare()

        // then
        expect(agent.invocations[0]?.prompt).toContain("rebase")
    })

    it("should start the agent a session of its own, because the pass is a role of its own", async () => {
        // given
        const { prepare, agent } = harness({
            log: [{ ...event("implement", "running"), sessionId: "the-implementer" }],
        })

        // when
        await prepare()

        // then
        expect(agent.invocations[0]?.resumeSessionId).toBeUndefined()
    })

    it("should give the pass a start event and an end event", async () => {
        // given
        const { prepare, events } = harness()

        // when
        await prepare()

        // then
        expect(settled(events.appended)).toEqual(["prepare running", "prepare ok"])
    })

    it("should record the session the pass was observed to have", async () => {
        // given
        const { prepare, events } = harness()

        // when
        await prepare()

        // then
        expect(events.appended[0]?.sessionId).toBe("session-from-the-stream")
    })

    it("should write the pass's transcript to a file of its own, named for the attempt", async () => {
        // given — a ticket whose first pass is already in the log, so this is the second
        const { prepare, events } = harness({ log: [event("prepare", "running"), event("prepare", "failed")] })

        // when
        await prepare()

        // then
        expect(events.appended.at(-1)?.transcriptPath).toContain("t7-prepare-2")
    })

    it("should fail the pass when the agent fails, so that the ticket is not attempted again", async () => {
        // given
        const { prepare, events } = harness({ reply: { outcome: "failed", detail: "claude could not be run" } })

        // when
        await prepare()

        // then
        expect(settled(events.appended)).toEqual(["prepare running", "prepare failed"])
    })

    it("should quote what the agent said of a pass that failed", async () => {
        // given
        const { prepare, events } = harness({ reply: { outcome: "failed", detail: "claude could not be run" } })

        // when
        await prepare()

        // then
        expect(events.appended.at(-1)?.detail).toContain("claude could not be run")
    })

    it("should spend no agent on a ticket that has no worktree to prepare", async () => {
        // given — an implementer that failed before git ever cut it one
        const { prepare, agent } = harness({ repository: { branches: { "afk/4/spec": ["spec-tip"] } } })

        // when
        await prepare()

        // then
        expect(agent.invocations).toEqual([])
    })

    it("should still let a ticket with no worktree be attempted again, because its start cuts a fresh one", async () => {
        // given
        const { prepare, events } = harness({ repository: { branches: { "afk/4/spec": ["spec-tip"] } } })

        // when
        await prepare()

        // then
        expect(settled(events.appended)).toEqual(["prepare running", "prepare ok"])
    })

    it("should halt the run for a ticket that is not this spec's work", async () => {
        // given
        const { prepare } = harness({ ticket: 99 })

        // when
        const result = await prepare()

        // then
        expect(result).toEqual({ outcome: "halted", reason: expect.stringContaining("#99") })
    })
})
