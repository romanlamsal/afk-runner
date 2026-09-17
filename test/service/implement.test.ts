import { describe, expect, it } from "vitest"
import type { AgentResult } from "../../src/domain/agent.ts"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import type { Manifest } from "../../src/domain/manifest.ts"
import { PROFILES } from "../../src/domain/profiles.ts"
import type { PreparedRun } from "../../src/domain/run.ts"
import type { StepResult } from "../../src/service/attempt.ts"
import { createImplementService } from "../../src/service/implement.ts"
import { createFakeAgent } from "../fakes/agent.ts"
import { createFakeEventLog } from "../fakes/event-log.ts"
import { createFakeGit, type FakeRepository } from "../fakes/git.ts"

/**
 * One ticket through its ports, starting from the worktree its setup cut. What is asserted here is
 * what the service *did* — which port it called, with what, and what reached the log — never the
 * order of anything internal.
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

/** What the setup step left behind: the worktree is cut, and the log says what it was cut from. */
const SETUP: readonly LifecycleEvent[] = [
    { ticket: 7, step: "setup", outcome: "running", at: "2026-09-15T11:18:38.314Z" },
    { ticket: 7, step: "setup", outcome: "ok", at: "2026-09-15T11:18:38.314Z", baseSha: "spec-tip" },
]

type Setup = {
    /** What the implementer did, beyond committing. */
    reply?: Partial<AgentResult>
    /** The branches the repository already has. The default is what a setup that went through left. */
    repository?: FakeRepository
    /** Whether the implementer commits on its branch. The default is an implementer that works. */
    commits?: boolean
    /** What the steps before this one left in the log. The default is a setup that went through. */
    log?: readonly LifecycleEvent[]
    /** Which attempt this is. The second is the one a prepare pass bought (ADR-0012). */
    attempt?: number
}

const harness = ({ reply, repository, commits = true, log = SETUP, attempt = 1 }: Setup = {}) => {
    const git = createFakeGit(repository ?? { branches: { "afk/4/spec": ["spec-tip"], "afk/4/t7": ["spec-tip"] } })
    const agent = createFakeAgent(reply)
    const events = createFakeEventLog(log)
    const before = events.appended.length

    const implement = createImplementService({
        agent: async invocation => {
            const result = await agent.run(invocation)
            if (commits) {
                git.commit("afk/4/t7", "the-work")
            }
            return result
        },
        events: events.log,
        git: git.git,
        now: () => new Date("2026-09-15T11:18:38.314Z"),
    })

    return {
        agent,
        events,
        git,
        /** The events this attempt wrote, without whatever the log already carried. */
        written: (): readonly LifecycleEvent[] => events.appended.slice(before),
        implement: (): Promise<StepResult> => implement(RUN, { ticket: 7, attempt }),
    }
}

const outcomes = (written: readonly LifecycleEvent[]): string[] => written.map(event => event.outcome)

describe("the implement service", () => {
    it("should carry the base its setup cut the worktree from onto the attempt's events", async () => {
        // given
        const { implement, written } = harness()

        // when
        await implement()

        // then
        expect(written()[0]?.baseSha).toBe("spec-tip")
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
        const { implement, written } = harness()

        // when
        await implement()

        // then
        expect(outcomes(written())).toEqual(["running", "ok"])
    })

    it("should record the session id the stream carried, rather than one it generated", async () => {
        // given
        const { implement, written } = harness()

        // when
        await implement()

        // then
        expect(written()[0]?.sessionId).toBe("session-from-the-stream")
    })

    it("should still write a start event when the stream carried no session id at all", async () => {
        // given
        const { implement, written } = harness({ reply: { sessionId: undefined } })

        // when
        await implement()

        // then
        expect(outcomes(written())).toEqual(["running", "ok"])
    })
})

describe("the implement service: what fails a ticket", () => {
    it("should fail a ticket whose log does not say what its worktree was cut from", async () => {
        // given — a log with no setup in it at all, which is a ticket with no base to judge against
        const { implement, agent } = harness({ log: [] })

        // when
        await implement()

        // then
        expect(agent.invocations).toEqual([])
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

describe("the implement service: the session a retry continues", () => {
    /** What a first attempt left behind, with or without ever having been given a session. */
    const earlier = (sessionId?: string): readonly LifecycleEvent[] => [
        ...SETUP,
        { ticket: 7, step: "implement", outcome: "running", at: "2026-09-15T11:18:38.314Z", sessionId },
        { ticket: 7, step: "implement", outcome: "failed", at: "2026-09-15T11:18:38.314Z" },
        { ticket: 7, step: "prepare", outcome: "running", at: "2026-09-15T11:18:38.314Z", sessionId: "the-pass" },
        { ticket: 7, step: "prepare", outcome: "ok", at: "2026-09-15T11:18:38.314Z" },
    ]

    it.each([
        ["the session its first attempt was observed to have", 2, earlier("in-the-stream"), "in-the-stream"],
        ["nothing, where that attempt's stream carried no id at all", 2, earlier(undefined), undefined],
        ["nothing on a first attempt, which has no session to continue", 1, SETUP, undefined],
    ] as const)("should resume %s", async (_name, attempt, log, expected) => {
        // given — ADR-0017: an id is passed only when one was observed, and never a generated one
        const { implement, agent } = harness({ attempt, log })

        // when
        await implement()

        // then
        expect(agent.invocations[0]?.resumeSessionId).toBe(expected)
    })
})

describe("the implement service: the implementer's profile", () => {
    it("should be the role's own, and no other role's", async () => {
        // given
        const { implement, agent } = harness()

        // when
        await implement()

        // then
        expect(agent.invocations.at(0)?.profile).toBe(PROFILES.implementer)
    })
})

/**
 * What the profile is dialled against. The counts are the agent port's, recorded as the attempt
 * ends — there is nothing to record when it starts, which is the distinction the log rests on
 * (ADR-0027).
 */
describe("the implement service: what an attempt consumed", () => {
    const USAGE = {
        inputTokens: 1600,
        outputTokens: 29700,
        cacheReadInputTokens: 1600000,
        cacheCreationInputTokens: 86500,
    }

    it("should record what the attempt consumed on the end event", async () => {
        // given
        const { implement, events } = harness({ reply: { usage: USAGE } })

        // when
        await implement()

        // then
        expect(events.appended.at(-1)?.usage).toEqual(USAGE)
    })

    it("should leave the start event's usage absent, nothing having been consumed before the agent ran", async () => {
        // given
        const { implement, written } = harness({ reply: { usage: USAGE } })

        // when
        await implement()

        // then
        expect(written()[0]?.usage).toBeUndefined()
    })
})
