import { describe, expect, it } from "vitest"
import type { AgentResult } from "../../src/domain/agent.ts"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import type { Manifest } from "../../src/domain/manifest.ts"
import { PROFILES } from "../../src/domain/profiles.ts"
import type { PreparedRun } from "../../src/domain/run.ts"
import type { StepResult } from "../../src/service/attempt.ts"
import { createResolveService } from "../../src/service/resolve.ts"
import { createFakeAgent } from "../fakes/agent.ts"
import { createFakeEventLog } from "../fakes/event-log.ts"
import { createFakeGit, type FakeRepository } from "../fakes/git.ts"

/**
 * The conflict resolver's one pass, on its own. What is asserted is what the service did through
 * its ports — where it put the resolver, and what reached the log.
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

/** A ticket branch whose rebase onto the spec branch's tip stopped on a conflict. */
const REPOSITORY: FakeRepository = {
    branches: { main: ["cut"], "afk/4/spec": ["cut", "a-sibling"], "afk/4/t7": ["cut", "the-work"] },
    checkouts: { ".afk/4/t7": "afk/4/t7", ".afk/4/gate": "afk/4/spec" },
    colliding: ["afk/4/t7"],
}

type Setup = {
    /** What the conflict resolver reported. */
    reply?: Partial<AgentResult>
    repository?: FakeRepository
    /** What the resolver did to the worktree. The default is one that finishes the rebase. */
    resolver?: "finishes" | "aborts" | "skips everything" | "gives up"
}

const harness = ({ reply, repository = REPOSITORY, resolver = "finishes" }: Setup = {}) => {
    const git = createFakeGit(repository)
    const agent = createFakeAgent(reply)
    const events = createFakeEventLog()

    const resolve = createResolveService({
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
        git: git.git,
        now: () => new Date("2026-09-15T11:18:38.314Z"),
    })

    /** The conflict the resolver is called out of, arranged the way the rebase service leaves it. */
    const conflict = async (ticket = 7): Promise<StepResult> => {
        await git.git.rebase("/repo", { path: `.afk/4/t${ticket}`, onto: "afk/4/spec" })
        return resolve(RUN, { ticket, attempt: 1 })
    }

    return { agent, events, git, resolve: conflict }
}

const steps = (appended: readonly LifecycleEvent[]): string[] => appended.map(event => `${event.step} ${event.outcome}`)

describe("the resolve service: a conflict the resolver finished", () => {
    it("should run the conflict resolver in the ticket's own worktree, which is where the branch is", async () => {
        // given
        const { resolve, agent } = harness()

        // when
        await resolve()

        // then
        expect(agent.invocations[0]?.cwd).toBe(".afk/4/t7")
    })

    it("should hand the resolver the verify command, so that it checks what it produced", async () => {
        // given
        const { resolve, agent } = harness()

        // when
        await resolve()

        // then
        expect(agent.invocations[0]?.prompt).toContain("npm run check")
    })

    it("should give the resolver the role's own profile, and no other role's", async () => {
        // given
        const { resolve, agent } = harness()

        // when
        await resolve()

        // then
        expect(agent.invocations.at(0)?.profile).toBe(PROFILES.resolver)
    })

    it("should write the resolver its own transcript", async () => {
        // given
        const { resolve, agent } = harness()

        // when
        await resolve()

        // then
        expect(agent.invocations[0]?.transcriptPath).toBe(".afk/4/transcripts/20260915T111838314Z-t7-resolve-1.jsonl")
    })

    it("should record the resolver's session id, read from the stream rather than generated", async () => {
        // given
        const { resolve, events } = harness()

        // when
        await resolve()

        // then
        expect(events.appended.find(event => event.step === "resolve")?.sessionId).toBe("session-from-the-stream")
    })

    it("should land the rebase the resolver finished", async () => {
        // given
        const { resolve, git } = harness()

        // when
        await resolve()

        // then
        expect(git.commitsOn("afk/4/t7")).toEqual(["cut", "a-sibling", "the-work"])
    })

    it("should write one start event and one end event", async () => {
        // given
        const { resolve, events } = harness()

        // when
        await resolve()

        // then
        expect(steps(events.appended)).toEqual(["resolve running", "resolve ok"])
    })

    it("should keep the resolver's note, which is what the squash body says", async () => {
        // given
        const { resolve, events } = harness({
            reply: { structuredOutput: { note: "both sides added a field; kept both" } },
        })

        // when
        await resolve()

        // then
        expect(events.appended.at(-1)?.detail).toBe("both sides added a field; kept both")
    })

    it("should leave the note out rather than invent one when the resolver reported none", async () => {
        // given
        const { resolve, events } = harness({ reply: { structuredOutput: undefined } })

        // when
        await resolve()

        // then
        expect(events.appended.at(-1)?.detail).toBeUndefined()
    })
})

describe("the resolve service: a conflict the resolver could not land", () => {
    it("should record the failure against the resolve rather than against the rebase", async () => {
        // given — the rebase's budget is what a failed resolve spends, and the log is what says so
        const { resolve, events } = harness({
            reply: { outcome: "failed", detail: "the session ended" },
            resolver: "gives up",
        })

        // when
        await resolve()

        // then
        expect(steps(events.appended)).toEqual(["resolve running", "resolve failed"])
    })

    it("should abort the rebase the failed resolver left behind, because the resolver never does", async () => {
        // given
        const { resolve, git } = harness({
            reply: { outcome: "failed", detail: "the session ended" },
            resolver: "gives up",
        })

        // when
        await resolve()

        // then
        expect(await git.git.conflicted("/repo", ".afk/4/t7")).toBe(false)
    })

    it.each([
        ["exits zero on a tree that is still conflicted", "gives up", "unfinished"],
        ["made the conflict go away by dropping the ticket's work", "skips everything", "nothing of it is left"],
        ["aborted the rebase rather than landing it", "aborts", "without landing it"],
    ] as const)("should fail the ticket when the resolver %s", async (_name, resolver, expected) => {
        // given
        const { resolve, events } = harness({ resolver })

        // when
        await resolve()

        // then
        expect(events.appended.at(-1)?.detail).toContain(expected)
    })

    it("should report the failure to the driver", async () => {
        // given
        const { resolve } = harness({ resolver: "gives up" })

        // when
        const result = await resolve()

        // then
        expect(result).toEqual({ outcome: "failed" })
    })

    it("should leave the spec branch exactly where it was", async () => {
        // given
        const { resolve, git } = harness({ resolver: "gives up" })

        // when
        await resolve()

        // then
        expect(git.commitsOn("afk/4/spec")).toEqual(["cut", "a-sibling"])
    })

    it("should halt the run for a ticket the manifest does not list", async () => {
        // given
        const { resolve } = harness()

        // when
        const result = await resolve(99)

        // then
        expect(result).toEqual({ outcome: "halted", reason: "#99 is not a ticket of spec #4" })
    })
})
