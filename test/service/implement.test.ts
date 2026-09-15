import { describe, expect, it } from "vitest"
import type { AgentResult } from "../../src/domain/agent.ts"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import type { Manifest } from "../../src/domain/manifest.ts"
import type { PreparedRun } from "../../src/domain/run.ts"
import type { StepResult } from "../../src/service/attempt.ts"
import { createImplementService } from "../../src/service/implement.ts"
import { createFakeAgent } from "../fakes/agent.ts"
import { createFakeCommands } from "../fakes/commands.ts"
import { createFakeEnvironment } from "../fakes/environment.ts"
import { createFakeEventLog } from "../fakes/event-log.ts"
import { createFakeGit, type FakeRepository } from "../fakes/git.ts"
import { createFakeTracker } from "../fakes/tracker.ts"

/**
 * One ticket through its ports. What is asserted here is what the service *did* — which port it
 * called, with what, and what reached the log — never the order of anything internal.
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

type Setup = {
    /** What the implementer did, beyond committing. */
    reply?: Partial<AgentResult>
    /** The branches the repository already has. */
    repository?: FakeRepository
    /** The command that fails, if one does. */
    failing?: string
    /** Why the tracker refuses the claim, if it does. */
    refusal?: string
    /** Whether the implementer commits on its branch. The default is an implementer that works. */
    commits?: boolean
    /** What an earlier attempt left in the log, for the attempts that are not the first. */
    log?: readonly LifecycleEvent[]
    /** Which attempt this is. The second is the one a prepare pass bought (ADR-0012). */
    attempt?: number
}

const harness = ({ reply, repository, failing, refusal, commits = true, log = [], attempt = 1 }: Setup = {}) => {
    const git = createFakeGit(repository ?? { branches: { "afk/4/spec": ["spec-tip"] } })
    const agent = createFakeAgent(reply)
    const commands = createFakeCommands(failing)
    const environment = createFakeEnvironment()
    const events = createFakeEventLog(log)
    const tracker = createFakeTracker({ refusal })

    const implement = createImplementService({
        agent: async invocation => {
            const result = await agent.run(invocation)
            if (commits) {
                git.commit("afk/4/t7", "the-work")
            }
            return result
        },
        commands: commands.run,
        environment: environment.copy,
        events: events.log,
        git: git.git,
        now: () => new Date("2026-09-15T11:18:38.314Z"),
        tracker: tracker.tracker,
    })

    return {
        agent,
        commands,
        environment,
        events,
        git,
        tracker,
        implement: (): Promise<StepResult> => implement(RUN, { ticket: 7, attempt }),
    }
}

const outcomes = (appended: readonly LifecycleEvent[]): string[] => appended.map(event => event.outcome)

describe("the implement service", () => {
    it("should cut the ticket a worktree of its own from the spec branch's tip", async () => {
        // given
        const { implement, git } = harness()

        // when
        await implement()

        // then
        expect(git.worktrees).toEqual([{ path: ".afk/4/t7", branch: "afk/4/t7", startPoint: "spec-tip" }])
    })

    it("should record the tip it cut the worktree from as the attempt's base", async () => {
        // given
        const { implement, events } = harness()

        // when
        await implement()

        // then
        expect(events.appended[0]?.baseSha).toBe("spec-tip")
    })

    it("should copy the operator's environment files into the ticket's worktree", async () => {
        // given
        const { implement, environment } = harness()

        // when
        await implement()

        // then
        expect(environment.copiedInto).toEqual([".afk/4/t7"])
    })

    it("should run setup in the ticket's worktree", async () => {
        // given
        const { implement, commands } = harness()

        // when
        await implement()

        // then
        expect(commands.ran).toEqual([{ cwd: ".afk/4/t7", command: "npm ci" }])
    })

    it("should claim the ticket on the tracker", async () => {
        // given
        const { implement, tracker } = harness()

        // when
        await implement()

        // then
        expect(tracker.claimed).toEqual([7])
    })

    it("should hand the implementer the verify command, so that it checks its own work", async () => {
        // given
        const { implement, agent } = harness()

        // when
        await implement()

        // then
        expect(agent.invocations[0]?.prompt).toContain("npm run check")
    })

    it("should run the implementer in the ticket's own worktree", async () => {
        // given
        const { implement, agent } = harness()

        // when
        await implement()

        // then
        expect(agent.invocations[0]?.cwd).toBe(".afk/4/t7")
    })

    it("should write one start event and one end event for the attempt", async () => {
        // given
        const { implement, events } = harness()

        // when
        await implement()

        // then
        expect(outcomes(events.appended)).toEqual(["running", "ok"])
    })

    it("should record the session id the stream carried, rather than one it generated", async () => {
        // given
        const { implement, events } = harness()

        // when
        await implement()

        // then
        expect(events.appended[0]?.sessionId).toBe("session-from-the-stream")
    })

    it("should still write a start event when the stream carried no session id at all", async () => {
        // given
        const { implement, events } = harness({ reply: { sessionId: undefined } })

        // when
        await implement()

        // then
        expect(outcomes(events.appended)).toEqual(["running", "ok"])
    })
})

describe("the implement service: what fails a ticket", () => {
    it("should fail the step when setup fails, before an agent is spawned", async () => {
        // given
        const { implement, agent } = harness({ failing: "npm ci" })

        // when
        await implement()

        // then
        expect(agent.invocations).toEqual([])
    })

    it("should record a failed setup as the attempt's outcome", async () => {
        // given
        const { implement, events } = harness({ failing: "npm ci" })

        // when
        await implement()

        // then
        expect(outcomes(events.appended)).toEqual(["running", "failed"])
    })

    it("should fail the step when the ticket's worktree cannot be created", async () => {
        // given
        const { implement } = harness({
            repository: { branches: { "afk/4/spec": ["spec-tip"] }, checkout: { ok: false, reason: "locked" } },
        })

        // when
        const result = await implement()

        // then
        expect(result).toEqual({ outcome: "failed" })
    })

    it("should fail a ticket whose implementer committed nothing", async () => {
        // given
        const { implement, events } = harness({ commits: false })

        // when
        await implement()

        // then
        expect(events.appended.at(-1)?.detail).toBe("the implementer committed nothing")
    })

    it("should fail a ticket whose implementer reported a failure", async () => {
        // given
        const { implement, events } = harness({ reply: { outcome: "failed", detail: "it timed out after 60m" } })

        // when
        await implement()

        // then
        expect(events.appended.at(-1)).toMatchObject({ outcome: "failed", detail: "it timed out after 60m" })
    })

    /**
     * Regression: proof of work was once measured as HEAD movement during an invocation. An
     * idempotent implementer that correctly finds its work already committed — the expected case on
     * a resumed run — must pass both assertions (ADR-0011).
     */
    it("should pass a ticket whose work was already present when nothing was committed this time", async () => {
        // given — the branch already carries work, cut from the spec tip, and this agent commits none
        const { implement, events } = harness({
            commits: false,
            repository: { branches: { "afk/4/spec": ["spec-tip"], "afk/4/t7": ["spec-tip", "work-from-last-time"] } },
        })

        // when
        await implement()

        // then
        expect(events.appended.at(-1)?.outcome).toBe("ok")
    })

    it("should fail a ticket whose implementer built on something other than the base it was given", async () => {
        // given — the branch exists, but nothing on it descends from the spec tip
        const { implement, events } = harness({
            commits: false,
            repository: { branches: { "afk/4/spec": ["spec-tip"], "afk/4/t7": ["somewhere-else"] } },
        })

        // when
        await implement()

        // then
        expect(events.appended.at(-1)?.detail).toContain("other than the base it was given")
    })
})

describe("the implement service: the claim", () => {
    it("should halt the run when the ticket cannot be claimed", async () => {
        // given
        const { implement } = harness({ refusal: "not authenticated" })

        // when
        const result = await implement()

        // then
        expect(result).toEqual({ outcome: "halted", reason: expect.stringContaining("not authenticated") })
    })

    it("should spend nothing on a ticket it could not claim", async () => {
        // given
        const { implement, commands, agent } = harness({ refusal: "not authenticated" })

        // when
        await implement()

        // then
        expect([...commands.ran, ...agent.invocations]).toEqual([])
    })
})

describe("the implement service: the session a retry continues", () => {
    /** What a first attempt left behind, with or without ever having been given a session. */
    const earlier = (sessionId?: string): readonly LifecycleEvent[] => [
        { ticket: 7, step: "implement", outcome: "running", at: "2026-09-15T11:18:38.314Z", sessionId },
        { ticket: 7, step: "implement", outcome: "failed", at: "2026-09-15T11:18:38.314Z" },
        { ticket: 7, step: "prepare", outcome: "running", at: "2026-09-15T11:18:38.314Z", sessionId: "the-pass" },
        { ticket: 7, step: "prepare", outcome: "ok", at: "2026-09-15T11:18:38.314Z" },
    ]

    it.each([
        ["the session its first attempt was observed to have", 2, earlier("in-the-stream"), "in-the-stream"],
        ["nothing, where that attempt's stream carried no id at all", 2, earlier(undefined), undefined],
        ["nothing on a first attempt, which has no session to continue", 1, [], undefined],
    ] as const)("should resume %s", async (_name, attempt, log, expected) => {
        // given — ADR-0017: an id is passed only when one was observed, and never a generated one
        const { implement, agent } = harness({ attempt, log })

        // when
        await implement()

        // then
        expect(agent.invocations[0]?.resumeSessionId).toBe(expected)
    })
})
