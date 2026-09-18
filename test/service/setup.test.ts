import { describe, expect, it } from "vitest"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import type { Manifest } from "../../src/domain/manifest.ts"
import type { PreparedRun } from "../../src/domain/run.ts"
import type { StepResult } from "../../src/service/attempt.ts"
import { createSetupService } from "../../src/service/setup.ts"
import { createFakeCommands } from "../fakes/commands.ts"
import { createFakeEnvironment } from "../fakes/environment.ts"
import { createFakeEventLog } from "../fakes/event-log.ts"
import { createFakeGit, type FakeRepository } from "../fakes/git.ts"
import { createFakeTracker } from "../fakes/tracker.ts"

/**
 * Everything an implement attempt does before an agent exists, through its ports. What is asserted
 * is what the service *did* — which port it called, with what, and what reached the log.
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

type Setup = {
    /** The branches the repository already has. */
    repository?: FakeRepository
    /** The command that fails, if one does. */
    failing?: string
    /** Why the tracker refuses the claim, if it does. */
    refusal?: string
    /** What an earlier attempt left in the log, for the attempts that are not the first. */
    log?: readonly LifecycleEvent[]
}

const harness = ({ repository, failing, refusal, log = [] }: Setup = {}) => {
    const git = createFakeGit(repository ?? { branches: { "afk/4/spec": ["spec-tip"] } })
    const commands = createFakeCommands(failing)
    const environment = createFakeEnvironment()
    const events = createFakeEventLog(log)
    const tracker = createFakeTracker({ refusal })
    const before = events.appended.length

    const setup = createSetupService({
        commands: commands.run,
        environment: environment.copy,
        events: events.log,
        git: git.git,
        now: () => new Date("2026-09-15T11:18:38.314Z"),
        tracker: tracker.tracker,
    })

    return {
        commands,
        environment,
        git,
        tracker,
        /** The events this attempt wrote, without whatever the log already carried. */
        written: (): readonly LifecycleEvent[] => events.appended.slice(before),
        setup: (): Promise<StepResult> => setup(RUN, { ticket: 7 }),
    }
}

const outcomes = (written: readonly LifecycleEvent[]): string[] => written.map(event => event.outcome)

describe("the setup service", () => {
    it("should cut the ticket a worktree of its own from the spec branch's tip", async () => {
        // given
        const { setup, git } = harness()

        // when
        await setup()

        // then
        expect(git.worktrees).toEqual([{ path: ".afk/4/t7", branch: "afk/4/t7", startPoint: "spec-tip" }])
    })

    it("should claim the ticket on the tracker", async () => {
        // given
        const { setup, tracker } = harness()

        // when
        await setup()

        // then
        expect(tracker.claimed).toEqual([7])
    })

    it("should copy the operator's environment files into the ticket's worktree", async () => {
        // given
        const { setup, environment } = harness()

        // when
        await setup()

        // then
        expect(environment.copiedInto).toEqual([".afk/4/t7"])
    })

    it("should run the repository's setup command in the ticket's worktree", async () => {
        // given
        const { setup, commands } = harness()

        // when
        await setup()

        // then
        expect(commands.ran).toEqual([{ cwd: ".afk/4/t7", command: "npm ci" }])
    })

    it("should write one start event and one end event for the attempt", async () => {
        // given
        const { setup, written } = harness()

        // when
        await setup()

        // then
        expect(outcomes(written())).toEqual(["running", "ok"])
    })

    it("should record the tip it cut the worktree from as the attempt's base", async () => {
        // given
        const { setup, written } = harness()

        // when
        await setup()

        // then
        expect(written().at(-1)?.baseSha).toBe("spec-tip")
    })

    /** ADR-0022: setup runs the repository's own commands, so there is no session to record. */
    it("should carry no session id on any of its events", async () => {
        // given
        const { setup, written } = harness()

        // when
        await setup()

        // then
        expect(written().every(event => event.sessionId === undefined)).toBe(true)
    })
})

/**
 * ADR-0022: nothing an attempt does happens before its start event, so a run killed anywhere in
 * here leaves `setup: running` rather than silence — and a ticket afk claimed always has an event.
 */
describe("the setup service: what the start event precedes", () => {
    it("should write the start event before the claim, which is its first act", async () => {
        // given — a tracker that refuses, so nothing after the claim can have written anything
        const { setup, written } = harness({ refusal: "not authenticated" })

        // when
        await setup()

        // then
        expect(outcomes(written())).toEqual(["running"])
    })

    it("should halt the run when the ticket cannot be claimed", async () => {
        // given
        const { setup } = harness({ refusal: "not authenticated" })

        // when
        const result = await setup()

        // then
        expect(result).toEqual({ outcome: "halted", reason: expect.stringContaining("not authenticated") })
    })

    it("should spend nothing else on a ticket it could not claim", async () => {
        // given
        const { setup, commands, git } = harness({ refusal: "not authenticated" })

        // when
        await setup()

        // then
        expect([...commands.ran, ...git.worktrees]).toEqual([])
    })
})

describe("the setup service: what fails a ticket", () => {
    const failures = [
        {
            name: "the setup command goes red",
            setup: { failing: "npm ci" } satisfies Setup,
            detail: "`npm ci` failed: exit 1",
        },
        {
            name: "the worktree cannot be created",
            setup: {
                repository: { branches: { "afk/4/spec": ["spec-tip"] }, checkout: { ok: false, reason: "locked" } },
            } satisfies Setup,
            detail: "the worktree for #7 could not be created: locked",
        },
        {
            name: "the spec branch names no commit",
            setup: { repository: { branches: {} } } satisfies Setup,
            detail: "the spec branch afk/4/spec names no commit to cut a worktree from",
        },
    ] as const

    it.each(failures)("should fail the step when $name", async ({ setup: scenario }) => {
        // given
        const { setup } = harness(scenario)

        // when
        const result = await setup()

        // then
        expect(result).toEqual({ outcome: "failed" })
    })

    it.each(failures)("should say in the log why, when $name", async ({ setup: scenario, detail }) => {
        // given
        const { setup, written } = harness(scenario)

        // when
        await setup()

        // then
        expect(written().at(-1)?.detail).toBe(detail)
    })

    it.each(failures)("should still give the attempt both its events, when $name", async ({ setup: scenario }) => {
        // given
        const { setup, written } = harness(scenario)

        // when
        await setup()

        // then
        expect(outcomes(written())).toEqual(["running", "failed"])
    })
})

/**
 * ADR-0024: a second setup is a recut. Claiming an already-claimed ticket changes nothing on the
 * tracker, and `checkoutWorktree` replaces whatever is at the path — so the attempt differs from
 * the one before it by a fresh worktree and by nothing else.
 */
describe("the setup service: the recut a broken setup earns", () => {
    const killed: readonly LifecycleEvent[] = [
        { ticket: 7, step: "setup", outcome: "running", at: "2026-09-15T11:18:38.314Z" },
    ]

    it("should cut the worktree again from the spec branch's tip", async () => {
        // given
        const { setup, git } = harness({ log: killed })

        // when
        await setup()

        // then
        expect(git.worktrees).toEqual([{ path: ".afk/4/t7", branch: "afk/4/t7", startPoint: "spec-tip" }])
    })

    it("should claim the ticket again, which the tracker is untroubled by", async () => {
        // given
        const { setup, tracker } = harness({ log: killed })

        // when
        await setup()

        // then
        expect(tracker.claimed).toEqual([7])
    })
})
