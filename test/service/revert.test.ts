import { describe, expect, it } from "vitest"
import type { CommandRunner } from "../../src/domain/commands.ts"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import type { Manifest, Ticket } from "../../src/domain/manifest.ts"
import type { PreparedRun } from "../../src/domain/run.ts"
import type { StepResult } from "../../src/service/attempt.ts"
import { createProveBranch } from "../../src/service/gate.ts"
import { createRevertService } from "../../src/service/revert.ts"
import { createFakeEventLog } from "../fakes/event-log.ts"
import { createFakeGit, type FakeRepository } from "../fakes/git.ts"

/**
 * The end of the gate-red sequence: the merge comes off the spec branch and the tip that leaves
 * behind is proven, so that blaming the ticket is demonstrated rather than asserted (ADR-0009).
 * What is asserted is what the spec branch carries afterwards, what reached the log, and which of
 * the two fates the run was handed — the ticket failed, or the run halted.
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

/** A spec branch carrying the squash that went red and the fix agent's commit on top of it. */
const REPOSITORY: FakeRepository = {
    branches: { main: ["cut"], "afk/4/spec": ["cut", "squash-afk/4/t7", "the-fix"] },
    checkouts: { ".afk/4/gate": "afk/4/spec" },
}

/** The red gate and the fix attempt it bought, which is the log a revert is given out off. */
const SPENT: readonly LifecycleEvent[] = [
    { ticket: 7, step: "merge", outcome: "ok", at: "2026-09-15T11:17:00.000Z" },
    { ticket: 7, step: "gate", outcome: "running", at: "2026-09-15T11:18:00.000Z" },
    { ticket: 7, step: "gate", outcome: "failed", at: "2026-09-15T11:18:10.000Z" },
    {
        ticket: 7,
        step: "fix",
        outcome: "running",
        at: "2026-09-15T11:18:20.000Z",
        // What the ticket landed as: the tip the fix agent was let loose on (ADR-0009).
        baseSha: "squash-afk/4/t7",
    },
    { ticket: 7, step: "fix", outcome: "ok", at: "2026-09-15T11:18:30.000Z" },
    { ticket: 7, step: "gate", outcome: "running", at: "2026-09-15T11:18:34.000Z" },
    { ticket: 7, step: "gate", outcome: "failed", at: "2026-09-15T11:18:36.000Z" },
]

type Setup = {
    /** What the repository's checks are broken by: the ticket's merge, or the branch itself. */
    broken?: "by the ticket" | "by something else"
    /** What a killed run left in the log, for the scenarios that are given a different one. */
    log?: readonly LifecycleEvent[]
    repository?: FakeRepository
}

const harness = ({ broken = "by the ticket", log = SPENT, repository = REPOSITORY }: Setup = {}) => {
    const git = createFakeGit(repository)
    const events = createFakeEventLog(log)
    const ran: { cwd: string; command: string }[] = []

    /** Setup prepares a checkout and says nothing about its integrity, so only verify goes red. */
    const commands: CommandRunner = async ({ cwd, command }) => {
        ran.push({ cwd, command })
        const mended =
            broken === "by the ticket" && git.commitsOn("afk/4/spec").some(commit => commit.startsWith("revert-"))
        return command === MANIFEST.verify && !mended
            ? { ok: false, detail: `\`${command}\` failed: exit 1` }
            : { ok: true, detail: "" }
    }

    const revert = createRevertService({
        events: events.log,
        git: git.git,
        now: () => new Date("2026-09-15T11:18:38.314Z"),
        prove: createProveBranch({ commands }),
    })

    return { events, git, ran, revert: (ticket = 7): Promise<StepResult> => revert(RUN, { ticket }) }
}

/** The log as a scenario reads it, from the revert onwards. */
const steps = (appended: readonly LifecycleEvent[]): string[] =>
    appended.slice(SPENT.length).map(event => `${event.step} ${event.outcome}`)

describe("the revert service: taking the merge back off the branch", () => {
    it("should undo it with a revert commit rather than move the branch back", async () => {
        // given
        const { revert, git } = harness()

        // when
        await revert()

        // then — the squash is still there, and the revert is on top of it
        expect(git.commitsOn("afk/4/spec")).toEqual(["cut", "squash-afk/4/t7", "the-fix", "revert-squash-afk/4/t7"])
    })

    it("should undo the fix attempt along with the merge, so that the reverted tip is the tip that was green", async () => {
        // given — the revert is asked for from the merge the fix's start event names, under the fix
        const { revert, git } = harness()

        // when
        await revert()

        // then
        expect(git.messageOf("revert-squash-afk/4/t7")).toContain('Revert "Implement the slate (#7)"')
    })

    it("should give the revert the trailer that stops the ticket reading as one that landed", async () => {
        // given
        const { revert, git } = harness()

        // when
        await revert()

        // then
        expect(git.messageOf("revert-squash-afk/4/t7")).toContain("afk-reverted: 4/7")
    })

    it("should gate the reverted tip, so that blaming the ticket is demonstrated rather than asserted", async () => {
        // given
        const { revert, ran } = harness()

        // when
        await revert()

        // then
        expect(ran).toEqual([
            { cwd: ".afk/4/gate", command: "npm ci" },
            { cwd: ".afk/4/gate", command: "npm run check" },
        ])
    })

    it("should write one start event and one end event, and never a gate a reverted ticket would read as verified", async () => {
        // given
        const { revert, events } = harness()

        // when
        await revert()

        // then
        expect(steps(events.appended)).toEqual(["revert running", "revert failed"])
    })

    it("should fail the ticket once the reverted tip proves it was the cause", async () => {
        // given
        const { revert } = harness()

        // when
        const result = await revert()

        // then
        expect(result).toEqual({ outcome: "failed" })
    })

    it("should say in the log that the tip went green without the ticket on it", async () => {
        // given
        const { revert, events } = harness()

        // when
        await revert()

        // then
        expect(events.appended.at(-1)?.detail).toBe(
            "the gate was green once #7 was reverted, so its merge was the cause",
        )
    })
})

describe("the revert service: a spec branch that is broken without the ticket", () => {
    const independently = { broken: "by something else" } as const

    it("should halt the run, because nothing above a broken branch is trustworthy", async () => {
        // given
        const { revert } = harness(independently)

        // when
        const result = await revert()

        // then
        expect(result).toEqual({
            outcome: "halted",
            reason: "afk/4/spec is broken independently of any ticket: it is still red with #7 reverted off it",
        })
    })

    it("should still settle the ticket, so that nothing waits on it for the rest of the drain", async () => {
        // given
        const { revert, events } = harness(independently)

        // when
        await revert()

        // then
        expect(events.appended.at(-1)).toMatchObject({ ticket: 7, step: "revert", outcome: "failed" })
    })
})

describe("the revert service: a revert it cannot perform", () => {
    it("should halt rather than carry on over a branch it did not manage to put back", async () => {
        // given
        const { revert } = harness({ repository: { ...REPOSITORY, revert: { ok: false, reason: "a dirty worktree" } } })

        // when
        const result = await revert()

        // then
        expect(result).toEqual({
            outcome: "halted",
            reason: "the merge of #7 could not be reverted off afk/4/spec: a dirty worktree",
        })
    })

    it("should halt when the log names no merge for the fix attempt it followed", async () => {
        // given — a fix whose start event was written before its branch could be read
        const { revert } = harness({
            log: SPENT.map(event =>
                event.step === "fix" && event.outcome === "running" ? { ...event, baseSha: undefined } : event,
            ),
        })

        // when
        const result = await revert()

        // then
        expect(result).toEqual({
            outcome: "halted",
            reason: "the merge of #7 could not be found on afk/4/spec to revert",
        })
    })

    it("should halt the run for a ticket the manifest does not list", async () => {
        // given
        const { revert } = harness()

        // when
        const result = await revert(11)

        // then
        expect(result).toEqual({ outcome: "halted", reason: "#11 is not a ticket of spec #4" })
    })
})
