import { describe, expect, it } from "vitest"
import type { AgentResult } from "../../src/domain/agent.ts"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import type { Manifest, Ticket } from "../../src/domain/manifest.ts"
import { PROFILES } from "../../src/domain/profiles.ts"
import type { PreparedRun } from "../../src/domain/run.ts"
import type { StepResult } from "../../src/service/attempt.ts"
import { createFixService } from "../../src/service/fix.ts"
import { createFakeAgent } from "../fakes/agent.ts"
import { createFakeEventLog } from "../fakes/event-log.ts"
import { createFakeGit, type FakeRepository } from "../fakes/git.ts"

/**
 * The one fix attempt a red gate is worth, and nothing else: this service performs one step and
 * appends its two events. What follows it — the gate again, and the revert once the budget is
 * spent — is the decision function's, and is asserted against it (ADR-0023).
 */

const TICKET: Ticket = { number: 7, title: "Implement the slate", blockedBy: [] }

const MANIFEST: Manifest = {
    spec: 4,
    setup: "npm ci",
    verify: "npm run check",
    tickets: [TICKET],
}

const RUN: PreparedRun = {
    root: "/repo",
    spec: 4,
    base: "main",
    branch: "afk/4/spec",
    gate: ".afk/4/gate",
    manifest: MANIFEST,
}

/** A spec branch whose tip is the squash that has just gone red, in the gate worktree that owns it. */
const REPOSITORY: FakeRepository = {
    branches: { main: ["cut"], "afk/4/spec": ["cut", "squash-afk/4/t7"] },
    checkouts: { ".afk/4/gate": "afk/4/spec" },
}

/** What the gate wrote before the fix was handed out, which is where the fix agent's brief comes from. */
const RED_GATE: readonly LifecycleEvent[] = [
    { ticket: 7, step: "gate", outcome: "running", at: "2026-09-15T11:18:00.000Z" },
    {
        ticket: 7,
        step: "gate",
        outcome: "failed",
        at: "2026-09-15T11:18:30.000Z",
        detail: "`npm run check` failed: a type error in src/domain/decide.ts",
    },
]

type Setup = {
    /** What the fix agent left behind in the gate worktree. */
    fixer?: "commits" | "commits nothing" | "leaves work uncommitted"
    /** What the fix agent reported. */
    reply?: Partial<AgentResult>
    repository?: FakeRepository
}

const harness = ({ fixer = "commits", reply, repository = REPOSITORY }: Setup = {}) => {
    const git = createFakeGit(repository)
    const agent = createFakeAgent(reply)
    const events = createFakeEventLog(RED_GATE)

    const fix = createFixService({
        agent: async invocation => {
            const result = await agent.run(invocation)
            if (fixer === "leaves work uncommitted") {
                git.soil(".afk/4/gate")
            }
            if (fixer === "commits") {
                git.commit("afk/4/spec", "the-fix")
            }
            return result
        },
        events: events.log,
        git: git.git,
        now: () => new Date("2026-09-15T11:18:38.314Z"),
    })

    return { agent, events, git, fix: (ticket = 7): Promise<StepResult> => fix(RUN, { ticket }) }
}

/** The log as a scenario reads it, from the gate's red onwards. */
const steps = (appended: readonly LifecycleEvent[]): string[] =>
    appended.slice(RED_GATE.length).map(event => `${event.step} ${event.outcome}`)

describe("the fix service: the one fix attempt", () => {
    it("should run the fix agent in the gate worktree, which is where the spec branch is", async () => {
        // given
        const { fix, agent } = harness()

        // when
        await fix()

        // then
        expect(agent.invocations[0]?.cwd).toBe(".afk/4/gate")
    })

    it("should spend exactly one attempt on it, because that is a budget and not a retry policy", async () => {
        // given
        const { fix, agent } = harness()

        // when
        await fix()

        // then
        expect(agent.invocations).toHaveLength(1)
    })

    it.each([
        ["the verify command, so that it reproduces what went red", "npm run check"],
        ["what the gate said, rather than leaving it to guess", "a type error in src/domain/decide.ts"],
        ["the constraint it exists to be held to", "Fix the cause, never the signal"],
    ] as const)("should hand the fix agent %s", async (_name, expected) => {
        // given
        const { fix, agent } = harness()

        // when
        await fix()

        // then
        expect(agent.invocations[0]?.prompt).toContain(expected)
    })

    it("should write the fix agent its own transcript", async () => {
        // given
        const { fix, agent } = harness()

        // when
        await fix()

        // then
        expect(agent.invocations[0]?.transcriptPath).toBe(".afk/4/transcripts/20260915T111838314Z-t7-fix-1.jsonl")
    })

    it("should run the fix agent at its own role's profile, and no other role's", async () => {
        // given
        const { fix, agent } = harness()

        // when
        await fix()

        // then
        expect(agent.invocations.at(0)?.profile).toBe(PROFILES.fixer)
    })

    it("should halt the run for a ticket the manifest does not list", async () => {
        // given
        const { fix } = harness()

        // when
        const result = await fix(11)

        // then
        expect(result).toEqual({ outcome: "halted", reason: "#11 is not a ticket of spec #4" })
    })
})

describe("the fix service: what it writes down", () => {
    it("should write one start event and one end event, as its own step rather than a second gate", async () => {
        // given
        const { fix, events } = harness()

        // when
        await fix()

        // then
        expect(steps(events.appended)).toEqual(["fix running", "fix ok"])
    })

    it("should record the fix agent's session id, read from the stream rather than generated", async () => {
        // given
        const { fix, events } = harness()

        // when
        await fix()

        // then
        expect(events.appended.at(RED_GATE.length)?.sessionId).toBe("session-from-the-stream")
    })

    it("should carry the merge it was let loose on, so that a revert undoes the squash and the fix together", async () => {
        // given
        const { fix, events } = harness()

        // when
        await fix()

        // then
        expect(events.appended.at(RED_GATE.length)?.baseSha).toBe("squash-afk/4/t7")
    })

    it("should leave the fix on the spec branch for the gate that follows to prove", async () => {
        // given
        const { fix, git } = harness()

        // when
        await fix()

        // then
        expect(git.commitsOn("afk/4/spec")).toEqual(["cut", "squash-afk/4/t7", "the-fix"])
    })

    it("should report the attempt as made, because the branch is what proves it and not this step", async () => {
        // given
        const { fix } = harness()

        // when
        const result = await fix()

        // then
        expect(result).toEqual({ outcome: "ok" })
    })
})

describe("the fix service: an attempt that came to nothing", () => {
    it.each([
        [
            "the agent failed outright",
            { reply: { outcome: "failed", detail: "the session ended" } },
            "the fix agent for #7 failed: the session ended",
        ],
        [
            "it left work uncommitted, which the gate would prove and then lose",
            { fixer: "leaves work uncommitted" },
            "the fix agent left work uncommitted in the gate worktree",
        ],
        [
            "it committed nothing, so the branch is as the gate found it",
            { fixer: "commits nothing" },
            "the fix agent committed nothing, so the spec branch is exactly as the gate found it",
        ],
    ] as const)("should say in the log that %s", async (_name, setup, expected) => {
        // given
        const { fix, events } = harness(setup)

        // when
        await fix()

        // then
        expect(events.appended.at(-1)?.detail).toBe(expected)
    })

    it("should report it as a failed attempt rather than reach for the revert itself", async () => {
        // given
        const { fix } = harness({ fixer: "commits nothing" })

        // when
        const result = await fix()

        // then
        expect(result).toEqual({ outcome: "failed" })
    })

    it("should leave the ticket's merge on the branch, because taking it off is the revert's step", async () => {
        // given
        const { fix, git } = harness({ fixer: "commits nothing" })

        // when
        await fix()

        // then
        expect(git.commitsOn("afk/4/spec")).toEqual(["cut", "squash-afk/4/t7"])
    })
})
