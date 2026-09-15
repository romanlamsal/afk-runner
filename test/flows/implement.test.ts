import { describe, expect, it } from "vitest"
import { createCli } from "../../src/cli/cli.ts"
import { EXIT } from "../../src/cli/exit-codes.ts"
import { createRun } from "../../src/cli/run.ts"
import type { AgentInvocation } from "../../src/domain/agent.ts"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import type { Ticket } from "../../src/domain/manifest.ts"
import { createDriveService } from "../../src/service/drive.ts"
import { createImplementService } from "../../src/service/implement.ts"
import { createMergeService, type MergeTicket } from "../../src/service/merge.ts"
import { createStartService } from "../../src/service/start.ts"
import { createFakeAgent } from "../fakes/agent.ts"
import { createFakeCommands } from "../fakes/commands.ts"
import { createFakeEnvironment } from "../fakes/environment.ts"
import { createFakeEventLog } from "../fakes/event-log.ts"
import { createFakeGit } from "../fakes/git.ts"
import { createFakeManifestStore } from "../fakes/manifest-store.ts"
import { createFakeOperator } from "../fakes/operator.ts"
import { createFakeRunRecords } from "../fakes/run-records.ts"
import { createFakeTracker, type FakeTrackerSetup } from "../fakes/tracker.ts"
import { manifestOf, ticket } from "../fixtures/manifest.ts"

/**
 * The assembled run, from the argument vector to a worked slate, driven entirely through fake
 * ports. What is asserted is the **event log** and what the ports were asked to do — the two things
 * that survive a rewrite of everything between them.
 */

/** `.afk/4/t12` is ticket 12's worktree, which is how the fake implementer knows whose branch to commit on. */
const workingOn = (invocation: AgentInvocation): number => Number(invocation.cwd.split("/t").at(-1))

type Setup = {
    tickets: readonly Ticket[]
    /** The tickets whose implementer commits nothing, and so fails its two assertions. */
    idle?: readonly number[]
    /** The tickets whose rebase onto the spec branch stops on a conflict. */
    colliding?: readonly number[]
    /** Whether the conflict resolver finishes the rebase it was called for. */
    resolving?: boolean
    tracker?: FakeTrackerSetup
    maxParallel?: number
}

const harness = ({
    tickets,
    idle = [],
    colliding = [],
    resolving = true,
    tracker: trackerSetup = {},
    maxParallel = 3,
}: Setup) => {
    const manifest = manifestOf(tickets)
    const git = createFakeGit({
        branches: { "afk/4/spec": ["spec-tip"] },
        colliding: colliding.map(number => `afk/4/t${number}`),
    })
    const agent = createFakeAgent()
    const resolver = createFakeAgent()
    const commands = createFakeCommands()
    const environment = createFakeEnvironment()
    const events = createFakeEventLog()
    const manifests = createFakeManifestStore({ ok: true, manifest })
    const operator = createFakeOperator()
    const records = createFakeRunRecords()
    const tracker = createFakeTracker(trackerSetup)
    const printed: string[] = []
    const errors: string[] = []
    /** The most implementers that were ever in flight at once, which is what a slot count means. */
    const concurrency = { running: 0, peak: 0 }
    /** The same for the merge track, where the only correct answer is one (ADR-0006). */
    const merging = { running: 0, peak: 0 }

    const now = (): Date => new Date("2026-09-15T11:18:38.314Z")

    const mergeTrack = createMergeService({
        // A conflict resolver that finishes the rebase it was called for, unless this scenario says
        // it is one that cannot.
        agent: async invocation => {
            const result = await resolver.run(invocation)
            if (resolving) {
                git.resolve(invocation.cwd)
            }
            return result
        },
        events: events.log,
        git: git.git,
        now,
    })

    const merge: MergeTicket = async (run, action) => {
        merging.running += 1
        merging.peak = Math.max(merging.peak, merging.running)
        const result = await mergeTrack(run, action)
        merging.running -= 1
        return result
    }

    const cli = createCli({
        isInteractive: () => true,
        printError: line => errors.push(line),
        run: createRun({
            start: createStartService({
                cwd: "/repo",
                environment: environment.copy,
                git: git.git,
                manifests: manifests.store,
                operator: operator.operator,
                plan: async () => ({ ok: true, manifest }),
                records: records.records,
            }),
            drive: createDriveService({
                events: events.log,
                implement: createImplementService({
                    // An implementer that does its job: it commits on the branch it was given,
                    // unless this scenario says it is one of the ones that does not.
                    agent: async invocation => {
                        concurrency.running += 1
                        concurrency.peak = Math.max(concurrency.peak, concurrency.running)
                        const result = await agent.run(invocation)
                        const number = workingOn(invocation)
                        if (!idle.includes(number)) {
                            git.commit(`afk/4/t${number}`, `work-for-${number}`)
                        }
                        concurrency.running -= 1
                        return result
                    },
                    commands: commands.run,
                    environment: environment.copy,
                    events: events.log,
                    git: git.git,
                    now,
                    tracker: tracker.tracker,
                }),
                merge,
                now,
            }),
            print: line => printed.push(line),
            printError: line => errors.push(line),
        }),
    })

    return {
        agent,
        concurrency,
        events,
        git,
        merging,
        resolver,
        printed,
        errors,
        tracker,
        run: (): Promise<number> => cli(["4", "--implement-only", `--max-parallel=${maxParallel}`]),
    }
}

/** The log as a scenario reads it: what happened to which ticket, in order, ends only. */
const settled = (appended: readonly LifecycleEvent[]): string[] =>
    appended
        .filter(event => event.outcome !== "running")
        .map(event => `#${event.ticket} ${event.step} ${event.outcome}`)

describe("a run that works its slate", () => {
    it("should implement every ticket nothing blocks", async () => {
        // given
        const { run, events } = harness({ tickets: [ticket(10), ticket(11)] })

        // when
        await run()

        // then
        expect(settled(events.appended)).toEqual([
            "#10 implement ok",
            "#11 implement ok",
            "#10 rebase ok",
            "#11 rebase ok",
        ])
    })

    it("should give each ticket a worktree of its own, cut from the spec branch", async () => {
        // given
        const { run, git } = harness({ tickets: [ticket(10), ticket(11)] })

        // when
        await run()

        // then
        expect(git.worktrees).toEqual([
            { path: ".afk/4/gate", branch: "afk/4/spec", startPoint: "main" },
            { path: ".afk/4/t10", branch: "afk/4/t10", startPoint: "spec-tip" },
            { path: ".afk/4/t11", branch: "afk/4/t11", startPoint: "spec-tip" },
        ])
    })

    it("should claim every ticket it starts, and only those", async () => {
        // given — 12 waits on 11, which never becomes verified, because nothing gates yet
        const { run, tracker } = harness({ tickets: [ticket(11), ticket(12, [11])] })

        // when
        await run()

        // then
        expect(tracker.claimed).toEqual([11])
    })

    it("should never have more implementers in flight at once than it has slots", async () => {
        // given
        const { run, concurrency } = harness({ tickets: [ticket(10), ticket(11), ticket(12)], maxParallel: 2 })

        // when
        await run()

        // then
        expect(concurrency.peak).toBe(2)
    })

    it("should still get through every ticket when there are fewer slots than tickets", async () => {
        // given
        const { run, agent } = harness({ tickets: [ticket(10), ticket(11), ticket(12)], maxParallel: 2 })

        // when
        await run()

        // then
        expect(agent.invocations).toHaveLength(3)
    })

    it("should hand the slate out most-blocking-first", async () => {
        // given
        const { run, agent } = harness({ tickets: [ticket(10), ticket(11), ticket(12, [11])], maxParallel: 1 })

        // when
        await run()

        // then
        expect(agent.invocations.map(workingOn)).toEqual([11, 10])
    })
})

describe("a run's merge track", () => {
    it("should rebase every implemented ticket onto the spec branch", async () => {
        // given
        const { run, git } = harness({ tickets: [ticket(10), ticket(11)] })

        // when
        await run()

        // then
        expect(git.rebases).toEqual([
            { path: ".afk/4/t10", onto: "afk/4/spec" },
            { path: ".afk/4/t11", onto: "afk/4/spec" },
        ])
    })

    it("should never have two tickets in the merge track at once", async () => {
        // given
        const { run, merging } = harness({ tickets: [ticket(10), ticket(11), ticket(12)] })

        // when
        await run()

        // then
        expect(merging.peak).toBe(1)
    })

    it("should resolve a conflicting ticket in that ticket's own worktree", async () => {
        // given
        const { run, resolver } = harness({ tickets: [ticket(10)], colliding: [10] })

        // when
        await run()

        // then
        expect(resolver.invocations.map(invocation => invocation.cwd)).toEqual([".afk/4/t10"])
    })

    it("should spend no resolver on a ticket that rebased by itself", async () => {
        // given
        const { run, resolver } = harness({ tickets: [ticket(10)] })

        // when
        await run()

        // then
        expect(resolver.invocations).toEqual([])
    })

    it("should fail a ticket whose conflict the resolver could not land, and skip its dependents", async () => {
        // given
        const { run, events } = harness({
            tickets: [ticket(11), ticket(12, [11])],
            colliding: [11],
            resolving: false,
        })

        // when
        await run()

        // then
        expect(settled(events.appended)).toEqual([
            "#11 implement ok",
            "#11 resolve failed",
            "#11 rebase failed",
            "#12 implement skipped",
        ])
    })

    it("should leave the spec branch where it was when a rebase could not land", async () => {
        // given
        const { run, git } = harness({ tickets: [ticket(10)], colliding: [10], resolving: false })

        // when
        await run()

        // then
        expect(git.commitsOn("afk/4/spec")).toEqual(["spec-tip"])
    })
})

describe("a run whose ticket cannot be implemented", () => {
    it("should fail the ticket whose implementer committed nothing", async () => {
        // given
        const { run, events } = harness({ tickets: [ticket(11)], idle: [11] })

        // when
        await run()

        // then
        expect(settled(events.appended)).toEqual(["#11 implement failed"])
    })

    it("should skip the failed ticket's dependents transitively", async () => {
        // given
        const { run, events } = harness({
            tickets: [ticket(11), ticket(12, [11]), ticket(13, [12])],
            idle: [11],
        })

        // when
        await run()

        // then
        expect(settled(events.appended)).toEqual([
            "#11 implement failed",
            "#12 implement skipped",
            "#13 implement skipped",
        ])
    })

    it("should never spend an implementer on a ticket it is going to skip", async () => {
        // given
        const { run, agent } = harness({ tickets: [ticket(11), ticket(12, [11])], idle: [11] })

        // when
        await run()

        // then
        expect(agent.invocations.map(workingOn)).toEqual([11])
    })

    it("should say on screen what failed and what was skipped", async () => {
        // given
        const { run, printed } = harness({ tickets: [ticket(11), ticket(12, [11])], idle: [11] })

        // when
        await run()

        // then
        expect(printed).toContain("failed:       #11")
    })
})

describe("a run whose tracker refuses a claim", () => {
    it("should exit halted", async () => {
        // given
        const { run } = harness({ tickets: [ticket(10)], tracker: { refusal: "not authenticated" } })

        // when
        const code = await run()

        // then
        expect(code).toBe(EXIT.halted)
    })

    it("should name the tracker error on the way out", async () => {
        // given
        const { run, errors } = harness({ tickets: [ticket(10)], tracker: { refusal: "not authenticated" } })

        // when
        await run()

        // then
        expect(errors).toContain("afk: ticket #10 could not be claimed: not authenticated")
    })

    it("should let the implementer that was already running finish and record its event", async () => {
        // given — 10 is claimed and runs; 11's claim is refused while it does
        const { run, events } = harness({
            tickets: [ticket(10), ticket(11)],
            maxParallel: 2,
            tracker: { refusal: "not authenticated", refuses: [11] },
        })

        // when
        await run()

        // then
        expect(settled(events.appended)).toEqual(["#10 implement ok"])
    })

    it("should start nothing new once a claim has been refused", async () => {
        // given
        const { run, tracker } = harness({
            tickets: [ticket(10), ticket(11), ticket(12)],
            maxParallel: 2,
            tracker: { refusal: "not authenticated", refuses: [11] },
        })

        // when
        await run()

        // then
        expect(tracker.claimed).toEqual([10, 11])
    })
})

describe("a run resumed over a log that is not empty", () => {
    it("should never re-implement a ticket the log says is done", async () => {
        // given
        const { run, agent, events } = harness({ tickets: [ticket(10), ticket(11)] })
        events.appended.push({ ticket: 10, step: "implement", outcome: "ok", at: "2026-09-15T10:00:00.000Z" })

        // when
        await run()

        // then
        expect(agent.invocations.map(workingOn)).toEqual([11])
    })

    it("should leave a ticket a killed run left mid-step alone, rather than start it twice", async () => {
        // given — a `running` event with no process behind it, which is what a killed run leaves
        const { run, agent, events } = harness({ tickets: [ticket(10)] })
        events.appended.push({ ticket: 10, step: "implement", outcome: "running", at: "2026-09-15T10:00:00.000Z" })

        // when
        await run()

        // then
        expect(agent.invocations).toEqual([])
    })
})
