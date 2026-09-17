import { describe, expect, it } from "vitest"
import type { AgentResult } from "../../src/domain/agent.ts"
import type { CommandRunner } from "../../src/domain/commands.ts"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import type { Manifest, Ticket } from "../../src/domain/manifest.ts"
import { PROFILES } from "../../src/domain/profiles.ts"
import type { PreparedRun } from "../../src/domain/run.ts"
import type { StepResult } from "../../src/service/attempt.ts"
import { createFixService } from "../../src/service/fix.ts"
import { createProveBranch } from "../../src/service/gate.ts"
import { createFakeAgent } from "../fakes/agent.ts"
import { createFakeEventLog } from "../fakes/event-log.ts"
import { createFakeGit, type FakeRepository } from "../fakes/git.ts"

/**
 * What a red gate is worth: one fix attempt, the revert, and the gate again on the reverted tip
 * (ADR-0009). What is asserted is what reached the log, what the spec branch carries afterwards,
 * and which of the three outcomes the run was handed — the ticket failed, or the run halted.
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
    trunk: "main",
    branch: "afk/4/spec",
    gate: ".afk/4/gate",
    manifest: MANIFEST,
}

/** A spec branch whose tip is the squash that has just gone red, in the gate worktree that owns it. */
const REPOSITORY: FakeRepository = {
    branches: { main: ["cut"], "afk/4/spec": ["cut", "squash-afk/4/t7"] },
    checkouts: { ".afk/4/gate": "afk/4/spec" },
}

/** What the gate wrote before handing the ticket over, which is where the fix agent's brief comes from. */
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
    /**
     * What the repository's own checks say, and what would make them say something else: the
     * ticket's merge broke it, something else did, or the fix agent's commit is what mends it.
     */
    broken?: "by the ticket" | "by something else" | "until the fix lands"
    /** What the fix agent left behind in the gate worktree. */
    fixer?: "commits" | "commits nothing" | "leaves work uncommitted"
    /** What the fix agent reported. */
    reply?: Partial<AgentResult>
    repository?: FakeRepository
}

const harness = ({ broken = "by the ticket", fixer = "commits", reply, repository = REPOSITORY }: Setup = {}) => {
    const git = createFakeGit(repository)
    const agent = createFakeAgent(reply)
    const events = createFakeEventLog(RED_GATE)
    const ran: { cwd: string; command: string }[] = []

    /** Whether the checks are still red, read off what the spec branch carries right now. */
    const red = (): boolean => {
        const commits = git.commitsOn("afk/4/spec")
        if (broken === "by something else") {
            return true
        }
        if (broken === "until the fix lands") {
            return !commits.includes("the-fix")
        }
        return !commits.some(commit => commit.startsWith("revert-"))
    }

    /** Setup prepares a checkout and says nothing about its integrity, so only verify goes red. */
    const commands: CommandRunner = async ({ cwd, command }) => {
        ran.push({ cwd, command })
        return command === MANIFEST.verify && red()
            ? { ok: false, detail: `\`${command}\` failed: exit 1` }
            : { ok: true, detail: "" }
    }

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
        prove: createProveBranch({ commands }),
    })

    return { agent, events, git, ran, fix: (): Promise<StepResult> => fix(RUN, TICKET) }
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
        // given — a repository nothing the fix agent does will make green
        const { fix, agent } = harness({ broken: "by something else" })

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

    it("should record the fix agent's session id, read from the stream rather than generated", async () => {
        // given
        const { fix, events } = harness()

        // when
        await fix()

        // then
        expect(events.appended.at(RED_GATE.length)?.sessionId).toBe("session-from-the-stream")
    })
})

describe("the fix service: a fix that works", () => {
    const working = { broken: "until the fix lands" } as const

    it("should end the gate green, which is the only thing that verifies a ticket", async () => {
        // given
        const { fix, events } = harness(working)

        // when
        await fix()

        // then
        expect(steps(events.appended)).toEqual(["gate running", "gate ok"])
    })

    it("should report the ticket as landed, so that the merge track tidies its worktree away", async () => {
        // given
        const { fix } = harness(working)

        // when
        const result = await fix()

        // then
        expect(result).toEqual({ outcome: "ok" })
    })

    it("should keep a fix that works even though the agent reported failure, because the branch is what is proven", async () => {
        // given — a session that died after committing a fix that makes the checks green
        const { fix } = harness({ ...working, reply: { outcome: "failed", detail: "the session ended" } })

        // when
        const result = await fix()

        // then
        expect(result).toEqual({ outcome: "ok" })
    })

    it("should leave the ticket's merge on the spec branch, with the fix on top of it", async () => {
        // given
        const { fix, git } = harness(working)

        // when
        await fix()

        // then
        expect(git.commitsOn("afk/4/spec")).toEqual(["cut", "squash-afk/4/t7", "the-fix"])
    })
})

describe("the fix service: a fix that does not", () => {
    it.each([
        ["the agent failed outright", { reply: { outcome: "failed", detail: "the session ended" } }],
        ["it left work uncommitted, which the gate would prove and then lose", { fixer: "leaves work uncommitted" }],
        ["it committed nothing, so the branch is as the gate found it", { fixer: "commits nothing" }],
        ["its fix did not make the checks green", {}],
    ] as const)("should revert the merge when %s", async (_name, setup) => {
        // given
        const { fix, git } = harness(setup)

        // when
        await fix()

        // then
        expect(git.commitsOn("afk/4/spec")).toContain("revert-squash-afk/4/t7")
    })

    it.each([
        [
            "the fix agent failed and the branch was red anyway",
            { reply: { outcome: "failed", detail: "the session ended" } },
            "the fix agent for #7 failed: the session ended, and `npm run check` failed: exit 1",
        ],
        [
            "it left work uncommitted",
            { fixer: "leaves work uncommitted" },
            "the fix agent left work uncommitted in the gate worktree",
        ],
        [
            "it committed nothing",
            { fixer: "commits nothing" },
            "the fix agent committed nothing, so the spec branch is exactly as the gate found it",
        ],
    ] as const)("should say in the log that %s", async (_name, setup, expected) => {
        // given
        const { fix, events } = harness(setup)

        // when
        await fix()

        // then
        expect(events.appended.at(RED_GATE.length + 1)?.detail).toBe(expected)
    })

    it("should spend no second setup and verify on a fix agent that changed nothing", async () => {
        // given
        const { fix, ran } = harness({ fixer: "commits nothing" })

        // when
        await fix()

        // then — the only two are the gate on the reverted tip
        expect(ran).toEqual([
            { cwd: ".afk/4/gate", command: "npm ci" },
            { cwd: ".afk/4/gate", command: "npm run check" },
        ])
    })
})

describe("the fix service: taking the merge back off the branch", () => {
    it("should undo it with a revert commit rather than move the branch back", async () => {
        // given
        const { fix, git } = harness()

        // when
        await fix()

        // then — the squash is still there, and the revert is on top of it
        expect(git.commitsOn("afk/4/spec")).toEqual(["cut", "squash-afk/4/t7", "the-fix", "revert-squash-afk/4/t7"])
    })

    it("should undo the fix attempt along with the merge, so that the reverted tip is the tip that was green", async () => {
        // given — the revert is asked for from the squash, which is under the fix agent's commit
        const { fix, git } = harness()

        // when
        await fix()

        // then
        expect(git.commitsOn("afk/4/spec").at(-1)).toBe("revert-squash-afk/4/t7")
    })

    it("should give the revert the trailer that stops the ticket reading as one that landed", async () => {
        // given
        const { fix, git } = harness()

        // when
        await fix()

        // then
        expect(git.messageOf("revert-squash-afk/4/t7")).toContain("afk-reverted: 4/7")
    })

    it("should gate the reverted tip, so that blaming the ticket is demonstrated rather than asserted", async () => {
        // given
        const { fix, ran } = harness()

        // when
        await fix()

        // then — setup and verify for the fix attempt, and again once the merge is off the branch
        expect(ran).toEqual([
            { cwd: ".afk/4/gate", command: "npm ci" },
            { cwd: ".afk/4/gate", command: "npm run check" },
            { cwd: ".afk/4/gate", command: "npm ci" },
            { cwd: ".afk/4/gate", command: "npm run check" },
        ])
    })

    it("should write one start event and one end event for the revert", async () => {
        // given
        const { fix, events } = harness()

        // when
        await fix()

        // then
        expect(steps(events.appended)).toEqual(["gate running", "gate failed", "revert running", "revert failed"])
    })

    it("should fail the ticket once the reverted tip proves it was the cause", async () => {
        // given
        const { fix } = harness()

        // when
        const result = await fix()

        // then
        expect(result).toEqual({ outcome: "failed" })
    })

    it("should say in the log that the tip went green without the ticket on it", async () => {
        // given
        const { fix, events } = harness()

        // when
        await fix()

        // then
        expect(events.appended.at(-1)?.detail).toBe(
            "the gate was green once #7 was reverted, so its merge was the cause",
        )
    })
})

describe("the fix service: a spec branch that is broken without the ticket", () => {
    const independently = { broken: "by something else" } as const

    it("should halt the run, because nothing above a broken branch is trustworthy", async () => {
        // given
        const { fix } = harness(independently)

        // when
        const result = await fix()

        // then
        expect(result).toEqual({
            outcome: "halted",
            reason: "afk/4/spec is broken independently of any ticket: it is still red with #7 reverted off it",
        })
    })

    it("should still settle the ticket, so that nothing waits on it for the rest of the drain", async () => {
        // given
        const { fix, events } = harness(independently)

        // when
        await fix()

        // then
        expect(events.appended.at(-1)).toMatchObject({ ticket: 7, step: "revert", outcome: "failed" })
    })
})

describe("the fix service: a revert it cannot perform", () => {
    it("should halt rather than carry on over a branch it did not manage to put back", async () => {
        // given
        const { fix } = harness({ repository: { ...REPOSITORY, revert: { ok: false, reason: "a dirty worktree" } } })

        // when
        const result = await fix()

        // then
        expect(result).toEqual({
            outcome: "halted",
            reason: "the merge of #7 could not be reverted off afk/4/spec: a dirty worktree",
        })
    })

    it("should halt when the spec branch names no commit the merge could be reverted from", async () => {
        // given
        const { fix } = harness({
            broken: "by something else",
            repository: { branches: { main: ["cut"] }, checkouts: { ".afk/4/gate": "afk/4/spec" } },
        })

        // when
        const result = await fix()

        // then
        expect(result).toEqual({
            outcome: "halted",
            reason: "the merge of #7 could not be found on afk/4/spec to revert",
        })
    })
})

describe("the fix service: the fix agent's profile", () => {
    it("should be the role's own, and no other role's", async () => {
        // given
        const { fix, agent } = harness()

        // when
        await fix()

        // then
        expect(agent.invocations.at(0)?.profile).toBe(PROFILES.fixer)
    })
})
