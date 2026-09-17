import { describe, expect, it } from "vitest"
import { silentBoard } from "../../src/cli/board-writer.ts"
import { createCli } from "../../src/cli/cli.ts"
import { EXIT } from "../../src/cli/exit-codes.ts"
import { createRun } from "../../src/cli/run.ts"
import type { AgentInvocation } from "../../src/domain/agent.ts"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import type { Git } from "../../src/domain/git.ts"
import type { Ticket } from "../../src/domain/manifest.ts"
import type { PreparedRun } from "../../src/domain/run.ts"
import { mergedTickets } from "../../src/domain/squash.ts"
import type { StepResult } from "../../src/service/attempt.ts"
import { createDriveService } from "../../src/service/drive.ts"
import { createFinishService } from "../../src/service/finish.ts"
import { createFixService, type FixTicket } from "../../src/service/fix.ts"
import { createGateService, createProveBranch, type RunGate } from "../../src/service/gate.ts"
import { createImplementService } from "../../src/service/implement.ts"
import { createMergeService, type MergeTicket } from "../../src/service/merge.ts"
import { createPrepareService } from "../../src/service/prepare.ts"
import { createRebaseService, type RebaseTicket } from "../../src/service/rebase.ts"
import { createResolveService, type ResolveTicket } from "../../src/service/resolve.ts"
import { createRevertService, type RevertTicket } from "../../src/service/revert.ts"
import { createSetupService, type SetupTicket } from "../../src/service/setup.ts"
import { createStartService } from "../../src/service/start.ts"
import { createFakeAgent } from "../fakes/agent.ts"
import { createFakeCommands } from "../fakes/commands.ts"
import { createFakeEnvironment } from "../fakes/environment.ts"
import { createFakeEventLog } from "../fakes/event-log.ts"
import { createStubFresh } from "../fakes/fresh.ts"
import { createFakeGit } from "../fakes/git.ts"
import { createFakeInterrupts } from "../fakes/interrupts.ts"
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
    /** The operator's command that goes red in this repository, if one does. */
    failing?: string
    /** What a red gate is the fault of: the merge that just landed, or the branch itself. */
    red?: "the merge" | "the branch"
    /** Whether the one fix attempt makes a red gate green. */
    fixing?: boolean
    /** The tickets whose implementer commits nothing until the prepare pass has been through. */
    recovering?: readonly number[]
    /** Whether the prepare pass itself succeeds. */
    preparing?: boolean
    /** The ticket whose implementer the operator interrupts the run during, where one does. */
    interruptedDuring?: number
    /** What a killed run left in the log, for the runs that are a continuation of one. */
    log?: readonly LifecycleEvent[]
    /** The branches an earlier run left, beyond trunk and the spec branch. */
    branches?: Record<string, readonly string[]>
    /** The worktrees a killed run left registered, path to the branch checked out in it. */
    worktrees?: Record<string, string>
    tracker?: FakeTrackerSetup
    maxParallel?: number
    /**
     * `--resume`: consent to continuing a run that has one. A log holding a ticket event is a run,
     * and `--implement-only` refuses one without this (ADR-0014, ADR-0028).
     */
    resume?: boolean
}

const harness = ({
    tickets,
    idle = [],
    colliding = [],
    resolving = true,
    failing,
    branches = {},
    red = "the branch",
    fixing = false,
    recovering = [],
    preparing = true,
    interruptedDuring,
    log = [],
    worktrees = {},
    tracker: trackerSetup = {},
    maxParallel = 3,
    resume = false,
}: Setup) => {
    const manifest = manifestOf(tickets)
    const git = createFakeGit({
        branches: { main: ["spec-tip"], "afk/4/spec": ["spec-tip"], ...branches },
        checkouts: worktrees,
        colliding: colliding.map(number => `afk/4/t${number}`),
    })
    const agent = createFakeAgent()
    const preparer = createFakeAgent(preparing ? {} : { outcome: "failed", detail: "the pass got nowhere" })
    /** How many implementers a ticket has had, which is what makes a second attempt different. */
    const attempted = new Map<number, number>()
    const resolver = createFakeAgent({ structuredOutput: { note: "both sides added a field; kept both" } })
    const fixer = createFakeAgent()
    const writer = createFakeAgent({ structuredOutput: { title: "Layerless afk", summary: "One branch." } })
    const commands = createFakeCommands(failing)
    const environment = createFakeEnvironment()
    const events = createFakeEventLog(log)
    const interrupts = createFakeInterrupts()
    const manifests = createFakeManifestStore({ ok: true, manifest })
    const operator = createFakeOperator()
    const records = createFakeRunRecords()
    const tracker = createFakeTracker(trackerSetup)
    const printed: string[] = []
    const errors: string[] = []
    /** The most tickets that were ever being worked at once, which is what a slot count means. */
    const concurrency = { running: 0, peak: 0 }
    /** The same for the merge track, over every action about the spec branch (ADR-0006). */
    const merging = { running: 0, peak: 0 }

    const now = (): Date => new Date("2026-09-15T11:18:38.314Z")
    const prove = createProveBranch({ commands: commands.run })

    /**
     * A repository whose checks go green again once the merge that broke them is off the branch,
     * which is the whole of what the gate on a reverted tip is asked to demonstrate (ADR-0009).
     */
    const gitForFix: Git =
        red === "the merge"
            ? {
                  ...git.git,
                  revert: async (root, request) => {
                      const reverted = await git.git.revert(root, request)
                      if (reverted.ok) {
                          commands.mend()
                      }
                      return reverted
                  },
              }
            : git.git

    const rebaseTrack = createRebaseService({ events: events.log, git: git.git, now })

    const resolveTrack = createResolveService({
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

    const mergeTrack = createMergeService({ events: events.log, git: git.git, now })

    const gateTrack = createGateService({ events: events.log, git: git.git, now, prove })

    // A fix agent that commits a fix on the spec branch and makes the repository green again,
    // unless this scenario says it is one that cannot.
    const fixTrack = createFixService({
        agent: async invocation => {
            const result = await fixer.run(invocation)
            if (fixing) {
                git.commit("afk/4/spec", "the-fix")
                commands.mend()
            }
            return result
        },
        events: events.log,
        git: git.git,
        now,
    })

    const setupTrack = createSetupService({
        commands: commands.run,
        environment: environment.copy,
        events: events.log,
        git: git.git,
        now,
        tracker: tracker.tracker,
    })

    // A setup holds a slot exactly as the implementer it precedes does: both are the ticket being
    // worked, and the pool is what bounds how many of them run at once.
    const setup: SetupTicket = async (run, action) => {
        concurrency.running += 1
        concurrency.peak = Math.max(concurrency.peak, concurrency.running)
        const result = await setupTrack(run, action)
        concurrency.running -= 1
        return result
    }
    const revertTrack = createRevertService({ events: events.log, git: gitForFix, now, prove })

    /** Counted over both merge-side services, because seriality is about the branch and not one step. */
    const serially =
        <Action>(step: (run: PreparedRun, action: Action) => Promise<StepResult>) =>
        async (run: PreparedRun, action: Action): Promise<StepResult> => {
            merging.running += 1
            merging.peak = Math.max(merging.peak, merging.running)
            const result = await step(run, action)
            merging.running -= 1
            return result
        }

    const rebase: RebaseTicket = serially(rebaseTrack)
    const resolve: ResolveTicket = serially(resolveTrack)
    const merge: MergeTicket = serially(mergeTrack)
    const gate: RunGate = serially(gateTrack)
    const fix: FixTicket = serially(fixTrack)
    const revert: RevertTicket = serially(revertTrack)

    const cli = createCli({
        isInteractive: () => true,
        printError: line => errors.push(line),
        run: createRun({
            fresh: createStubFresh(),
            start: createStartService({
                events: events.log,
                cwd: "/repo",
                environment: environment.copy,
                git: git.git,
                manifests: manifests.store,
                operator: operator.operator,
                plan: async () => ({ ok: true, manifest }),
                records: records.records,
            }),
            drive: createDriveService({
                board: silentBoard,
                events: events.log,
                interrupts: interrupts.interrupts,
                implement: createImplementService({
                    // An implementer that does its job: it commits on the branch it was given,
                    // unless this scenario says it is one of the ones that does not.
                    agent: async invocation => {
                        concurrency.running += 1
                        concurrency.peak = Math.max(concurrency.peak, concurrency.running)
                        const result = await agent.run(invocation)
                        const number = workingOn(invocation)
                        // The one moment worth interrupting at: this implementer and everything
                        // beside it is in flight, and the slate still has work on it.
                        if (number === interruptedDuring) {
                            interrupts.interrupt()
                        }
                        const attempt = (attempted.get(number) ?? 0) + 1
                        attempted.set(number, attempt)
                        // An implementer that commits nothing fails its two assertions, and one
                        // that does so only on its first attempt is one the prepare pass rescued.
                        const works = !idle.includes(number) && !(recovering.includes(number) && attempt === 1)
                        if (works) {
                            git.commit(`afk/4/t${number}`, `work-for-${number}`)
                        }
                        concurrency.running -= 1
                        return result
                    },
                    events: events.log,
                    git: git.git,
                    now,
                }),
                setup,
                rebase,
                resolve,
                merge,
                gate,
                fix,
                revert,
                prepare: createPrepareService({ agent: preparer.run, events: events.log, git: git.git, now }),
                now,
            }),
            finish: createFinishService({
                agent: writer.run,
                events: events.log,
                git: git.git,
                now,
                tracker: tracker.tracker,
            }),
            print: line => printed.push(line),
            printError: line => errors.push(line),
        }),
    })

    return {
        agent,
        commands,
        concurrency,
        events,
        fixer,
        git,
        merging,
        preparer,
        resolver,
        writer,
        printed,
        errors,
        tracker,
        run: (): Promise<number> =>
            cli(["4", "--implement-only", `--max-parallel=${maxParallel}`, ...(resume ? ["--resume"] : [])]),
    }
}

/**
 * What a setup that went through leaves behind: the log says the worktree was cut and what from,
 * git has the ticket's branch at that commit, and the worktree is registered. A log holding a ticket
 * event is a run, so every scenario built on it is a continuation and consents to one (ADR-0028).
 */
const warm = (...tickets: readonly number[]): Pick<Setup, "log" | "branches" | "worktrees" | "resume"> => ({
    log: tickets.flatMap(number => [
        { ticket: number, step: "setup", outcome: "running", at: "2026-09-15T09:00:00.000Z" } as const,
        { ticket: number, step: "setup", outcome: "ok", at: "2026-09-15T09:30:00.000Z", baseSha: "spec-tip" } as const,
    ]),
    branches: Object.fromEntries(tickets.map(number => [`afk/4/t${number}`, ["spec-tip"]])),
    worktrees: Object.fromEntries(tickets.map(number => [`.afk/4/t${number}`, `afk/4/t${number}`])),
    resume: true,
})

/** The log as a scenario reads it: what happened to which ticket, in order, ends only. */
/** Every end event the log carries, run-level ones included — those name no ticket (ADR-0028). */
const settled = (appended: readonly LifecycleEvent[]): string[] =>
    appended
        .filter(event => event.outcome !== "running")
        .map(event =>
            event.ticket === undefined
                ? `${event.step} ${event.outcome}`
                : `#${event.ticket} ${event.step} ${event.outcome}`,
        )

describe("a run that works its slate", () => {
    it("should implement every ticket nothing blocks", async () => {
        // given
        const { run, events } = harness({ tickets: [ticket(10), ticket(11)] })

        // when
        await run()

        // then
        expect(settled(events.appended)).toEqual([
            "#10 setup ok",
            "#11 setup ok",
            "#10 implement ok",
            "#11 implement ok",
            "#10 rebase ok",
            "#10 merge ok",
            "#10 gate ok",
            "#11 rebase ok",
            "#11 merge ok",
            "#11 gate ok",
            "pull-request ok",
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
        // given — 12 waits on 11, so it is claimed only once 11's gate has verified it
        const { run, tracker } = harness({ tickets: [ticket(11), ticket(12, [11])] })

        // when
        await run()

        // then
        expect(tracker.claimed).toEqual([11, 12])
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
        expect(agent.invocations.map(workingOn)).toEqual([11, 10, 12])
    })

    it("should start a blocked ticket only once its blocker's gate has verified it", async () => {
        // given — 11's verify goes red, so nothing ever verifies it
        const { run, agent } = harness({
            tickets: [ticket(11), ticket(12, [11])],
            failing: "npm run check",
        })

        // when
        await run()

        // then
        expect(agent.invocations.map(workingOn)).toEqual([11])
    })
})

describe("a run that lands its tickets", () => {
    it("should put one commit per ticket on the spec branch", async () => {
        // given
        const { run, git } = harness({ tickets: [ticket(10), ticket(11)] })

        // when
        await run()

        // then
        expect(git.commitsOn("afk/4/spec")).toEqual(["spec-tip", "squash-afk/4/t10", "squash-afk/4/t11"])
    })

    it("should give each of those commits the trailer naming the ticket it carried", async () => {
        // given
        const { run, git } = harness({ tickets: [ticket(10)] })

        // when
        await run()

        // then
        expect(git.messageOf("squash-afk/4/t10")).toContain("afk-ticket: 4/10")
    })

    it("should give each of those commits the implementer's own commit message", async () => {
        // given
        const { run, git } = harness({ tickets: [ticket(10)] })

        // when
        await run()

        // then
        expect(git.messageOf("squash-afk/4/t10")).toContain("work-for-10")
    })

    it("should gate after every single merge, so that a red result names one of them", async () => {
        // given
        const { run, commands } = harness({ tickets: [ticket(10), ticket(11)] })

        // when
        await run()

        // then
        expect(commands.ran.filter(ran => ran.cwd === ".afk/4/gate")).toEqual([
            { cwd: ".afk/4/gate", command: "npm ci" },
            { cwd: ".afk/4/gate", command: "npm run check" },
            { cwd: ".afk/4/gate", command: "npm ci" },
            { cwd: ".afk/4/gate", command: "npm run check" },
        ])
    })

    it("should reuse the one gate worktree across every merge rather than cut a fresh one", async () => {
        // given
        const { run, git } = harness({ tickets: [ticket(10), ticket(11)] })

        // when
        await run()

        // then
        expect(git.worktrees.filter(request => request.path === ".afk/4/gate")).toHaveLength(1)
    })

    it("should remove a verified ticket's worktree, and keep the gate's", async () => {
        // given
        const { run, git } = harness({ tickets: [ticket(10), ticket(11)] })

        // when
        await run()

        // then
        expect(git.removed).toEqual([".afk/4/t10", ".afk/4/t11"])
    })

    it("should say on screen which tickets were verified", async () => {
        // given
        const { run, printed } = harness({ tickets: [ticket(10), ticket(11)] })

        // when
        await run()

        // then
        expect(printed).toContain("verified:     #10, #11")
    })
})

describe("a run whose gate goes red", () => {
    /** A ticket whose merge is what broke the branch, and the one fix attempt cannot save it. */
    const blamed = { failing: "npm run check", red: "the merge" } as const

    it("should spend one fix attempt on it before anything else", async () => {
        // given
        const { run, fixer } = harness({ tickets: [ticket(11)], ...blamed })

        // when
        await run()

        // then
        expect(fixer.invocations.map(invocation => invocation.cwd)).toEqual([".afk/4/gate"])
    })

    it("should verify the ticket the fix attempt made green, and carry on to its dependents", async () => {
        // given
        const { run, events } = harness({
            tickets: [ticket(11), ticket(12, [11])],
            failing: "npm run check",
            fixing: true,
        })

        // when
        await run()

        // then
        expect(settled(events.appended)).toEqual([
            "#11 setup ok",
            "#11 implement ok",
            "#11 rebase ok",
            "#11 merge ok",
            "#11 gate failed",
            "#11 fix ok",
            "#11 gate ok",
            "#12 setup ok",
            "#12 implement ok",
            "#12 rebase ok",
            "#12 merge ok",
            "#12 gate ok",
            "pull-request ok",
        ])
    })

    it("should revert the merge the fix attempt could not save, and skip the ticket's dependents", async () => {
        // given
        const { run, events } = harness({ tickets: [ticket(11), ticket(12, [11])], ...blamed })

        // when
        await run()

        // then
        expect(settled(events.appended)).toEqual([
            "#11 setup ok",
            "#11 implement ok",
            "#11 rebase ok",
            "#11 merge ok",
            "#11 gate failed",
            "#11 fix failed",
            "#11 gate failed",
            "#11 revert failed",
            "#12 implement skipped",
        ])
    })

    it("should leave the reverted ticket's work off the spec branch, under a revert commit", async () => {
        // given
        const { run, git } = harness({ tickets: [ticket(11)], ...blamed })

        // when
        await run()

        // then
        expect(git.commitsOn("afk/4/spec")).toEqual(["spec-tip", "squash-afk/4/t11", "revert-squash-afk/4/t11"])
    })

    it("should let git be asked which tickets landed and be told this one did not", async () => {
        // given
        const { run, git } = harness({ tickets: [ticket(11)], ...blamed })

        // when
        await run()

        // then
        expect(
            mergedTickets(4, [git.messageOf("squash-afk/4/t11") ?? "", git.messageOf("revert-squash-afk/4/t11") ?? ""]),
        ).toEqual([])
    })

    it("should keep the failed ticket's worktree, because that is what a reader has to go on", async () => {
        // given
        const { run, git } = harness({ tickets: [ticket(11)], ...blamed })

        // when
        await run()

        // then
        expect(git.removed).toEqual([])
    })
})

describe("a run whose spec branch is broken independently of any ticket", () => {
    /** Nothing the fix agent or the revert does makes this repository green again. */
    const broken = { failing: "npm run check", red: "the branch" } as const

    it("should halt rather than revert every ticket in turn against a branch that was already red", async () => {
        // given
        const { run, events } = harness({ tickets: [ticket(11), ticket(12)], ...broken })

        // when
        await run()

        // then
        expect(settled(events.appended).filter(said => said.includes("revert"))).toEqual(["#11 revert failed"])
    })

    it("should exit halted, so that one line says to look at git before anything else", async () => {
        // given
        const { run } = harness({ tickets: [ticket(11)], ...broken })

        // when
        const code = await run()

        // then
        expect(code).toBe(EXIT.halted)
    })

    it("should name the spec branch as the broken thing on the way out", async () => {
        // given
        const { run, errors } = harness({ tickets: [ticket(11)], ...broken })

        // when
        await run()

        // then
        expect(errors).toContain(
            "afk: afk/4/spec is broken independently of any ticket: it is still red with #11 reverted off it",
        )
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

    it("should take a conflicting ticket through the rebase, the resolve and the merge in turn", async () => {
        // given — the three moves the merge track is made of, each an action of its own (ADR-0026)
        const { run, events } = harness({ tickets: [ticket(10)], colliding: [10] })

        // when
        await run()

        // then
        expect(settled(events.appended)).toEqual([
            "#10 setup ok",
            "#10 implement ok",
            "#10 rebase conflicted",
            "#10 resolve ok",
            "#10 merge ok",
            "#10 gate ok",
            "pull-request ok",
        ])
    })

    it("should land the work a resolved conflict left on the spec branch", async () => {
        // given
        const { run, git } = harness({ tickets: [ticket(10)], colliding: [10] })

        // when
        await run()

        // then
        expect(git.commitsOn("afk/4/spec")).toEqual(["spec-tip", "squash-afk/4/t10"])
    })

    it("should quote the resolver's note in the squash the merge lands", async () => {
        // given — the note belongs to the resolve event, and the merge reads it back (ADR-0007)
        const { run, git } = harness({ tickets: [ticket(10)], colliding: [10] })

        // when
        await run()

        // then
        expect(git.messageOf("squash-afk/4/t10")).toContain("Conflict resolution: both sides added a field; kept both")
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

        // then — one prepare pass and one more trip through the merge track, then it is over
        expect(settled(events.appended)).toEqual([
            "#11 setup ok",
            "#11 implement ok",
            "#11 rebase conflicted",
            "#11 resolve failed",
            "#11 prepare ok",
            "#11 rebase conflicted",
            "#11 resolve failed",
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
    it("should fail the ticket whose implementer committed nothing, once its pass and its last attempt are spent", async () => {
        // given
        const { run, events } = harness({ tickets: [ticket(11)], idle: [11] })

        // when
        await run()

        // then
        expect(settled(events.appended)).toEqual([
            "#11 setup ok",
            "#11 implement failed",
            "#11 prepare ok",
            "#11 implement failed",
        ])
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
            "#11 setup ok",
            "#11 implement failed",
            "#11 prepare ok",
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
        expect(agent.invocations.map(workingOn)).toEqual([11, 11])
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
        expect(settled(events.appended)).toEqual(["#10 setup ok"])
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
        const { run, agent, events } = harness({ tickets: [ticket(10), ticket(11)], resume: true })
        events.appended.push({ ticket: 10, step: "implement", outcome: "ok", at: "2026-09-15T10:00:00.000Z" })

        // when
        await run()

        // then
        expect(agent.invocations.map(workingOn)).toEqual([11])
    })

    it("should gate a ticket a killed run merged but never gated", async () => {
        // given — the squash is on the spec branch, and the log stops at the merge
        const { run, events, git } = harness({ tickets: [ticket(10)], resume: true })
        git.commit("afk/4/spec", "squash-afk/4/t10", "Ticket 10 (#10)\n\nafk-ticket: 4/10")
        events.appended.push({ ticket: 10, step: "merge", outcome: "ok", at: "2026-09-15T10:00:00.000Z" })

        // when
        await run()

        // then — the killed run's merge is picked back up at the gate, with no second trip through
        expect(settled(events.appended)).toEqual(["#10 merge ok", "#10 gate ok", "pull-request ok"])
    })

    it("should never squash a ticket the spec branch already carries a second time", async () => {
        // given
        const { run, git, events } = harness({ tickets: [ticket(10)], resume: true })
        git.commit("afk/4/spec", "squash-afk/4/t10", "Ticket 10 (#10)\n\nafk-ticket: 4/10")
        events.appended.push({ ticket: 10, step: "merge", outcome: "ok", at: "2026-09-15T10:00:00.000Z" })

        // when
        await run()

        // then
        expect(git.commitsOn("afk/4/spec")).toEqual(["spec-tip", "squash-afk/4/t10"])
    })

    it("should give a ticket a killed run left mid-step one implementer, not a second one beside it", async () => {
        // given — a `running` event with no process behind it, which is what a killed run leaves
        const { run, agent, events } = harness({ tickets: [ticket(10)], resume: true })
        events.appended.push(
            { ticket: 10, step: "setup", outcome: "ok", at: "2026-09-15T09:30:00.000Z", baseSha: "spec-tip" },
            { ticket: 10, step: "implement", outcome: "running", at: "2026-09-15T10:00:00.000Z" },
        )

        // when
        await run()

        // then
        expect(agent.invocations.map(workingOn)).toEqual([10])
    })
})

/**
 * ADR-0024: a setup that a killed run left behind is thrown away and cut again, never handed to the
 * prepare agent. The recut claims the ticket a second time, which the tracker is untroubled by.
 */
describe("a run that recuts a killed setup", () => {
    /** What a run killed part-way through a setup leaves: a step that began, and a half-made worktree. */
    const halfMade: Pick<Setup, "log" | "branches" | "worktrees" | "resume"> = {
        log: [{ ticket: 10, step: "setup", outcome: "running", at: "2026-09-15T09:00:00.000Z" }],
        branches: { "afk/4/t10": ["spec-tip"] },
        worktrees: { ".afk/4/t10": "afk/4/t10" },
        resume: true,
    }

    it("should cut the worktree again and take the ticket the rest of the way", async () => {
        // given
        const { run, events } = harness({ tickets: [ticket(10)], ...halfMade })

        // when
        await run()

        // then
        expect(settled(events.appended)).toEqual([
            "#10 setup ok",
            "#10 implement ok",
            "#10 rebase ok",
            "#10 merge ok",
            "#10 gate ok",
            "pull-request ok",
        ])
    })

    it("should cut the ticket's worktree again from the spec branch's tip", async () => {
        // given
        const { run, git } = harness({ tickets: [ticket(10)], ...halfMade })

        // when
        await run()

        // then
        expect(git.worktrees).toEqual([
            { path: ".afk/4/gate", branch: "afk/4/spec", startPoint: "main" },
            { path: ".afk/4/t10", branch: "afk/4/t10", startPoint: "spec-tip" },
        ])
    })

    it("should claim the ticket again, which the tracker is untroubled by", async () => {
        // given
        const { run, tracker } = harness({ tickets: [ticket(10)], ...halfMade })

        // when
        await run()

        // then
        expect(tracker.claimed).toEqual([10])
    })

    it("should send no prepare pass to it, because a half-made worktree is thrown away", async () => {
        // given
        const { run, preparer } = harness({ tickets: [ticket(10)], ...halfMade })

        // when
        await run()

        // then
        expect(preparer.invocations).toEqual([])
    })

    it("should fail the ticket and skip its dependents once both its setups are spent", async () => {
        // given — a repository whose setup command is simply wrong, so both attempts go red
        const { run, events } = harness({
            tickets: [ticket(11), ticket(12, [11])],
            failing: "npm ci",
        })

        // when
        await run()

        // then
        expect(settled(events.appended)).toEqual(["#11 setup failed", "#11 setup failed", "#12 implement skipped"])
    })
})

describe("a run resumed over a fix a killed run left part-way", () => {
    /** What a run killed mid-fix leaves: a red gate, a fix start event, and the squash on the branch. */
    const killedMidFix = (harnessed: ReturnType<typeof harness>): void => {
        harnessed.git.commit("afk/4/spec", "squash-afk/4/t10", "Ticket 10 (#10)\n\nafk-ticket: 4/10")
        harnessed.events.appended.push(
            { ticket: 10, step: "merge", outcome: "ok", at: "2026-09-15T10:00:00.000Z" },
            { ticket: 10, step: "gate", outcome: "running", at: "2026-09-15T10:01:00.000Z" },
            { ticket: 10, step: "gate", outcome: "failed", at: "2026-09-15T10:02:00.000Z" },
            {
                ticket: 10,
                step: "fix",
                outcome: "running",
                at: "2026-09-15T10:03:00.000Z",
                sessionId: "the-killed-fix",
                baseSha: "squash-afk/4/t10",
            },
        )
    }

    /** A repository the ticket's merge broke, so that the reverted tip is what goes green again. */
    const blamed = { tickets: [ticket(10)], failing: "npm run check", red: "the merge", resume: true } as const

    it("should gate what the killed fix left behind, and carry on to the revert", async () => {
        // given
        const harnessed = harness(blamed)
        killedMidFix(harnessed)

        // when
        await harnessed.run()

        // then
        expect(settled(harnessed.events.appended)).toEqual([
            "#10 merge ok",
            "#10 gate failed",
            "#10 gate failed",
            "#10 revert failed",
        ])
    })

    it("should never spend a second fix agent on it, because the killed one spent the budget", async () => {
        // given
        const harnessed = harness(blamed)
        killedMidFix(harnessed)

        // when
        await harnessed.run()

        // then
        expect(harnessed.fixer.invocations).toEqual([])
    })

    it("should take the killed fix's merge back off the spec branch rather than leave it red underneath", async () => {
        // given
        const harnessed = harness(blamed)
        killedMidFix(harnessed)

        // when
        await harnessed.run()

        // then
        expect(harnessed.git.commitsOn("afk/4/spec")).toEqual([
            "spec-tip",
            "squash-afk/4/t10",
            "revert-squash-afk/4/t10",
        ])
    })
})

describe("a run that recovers a wrecked ticket", () => {
    /** What a killed run leaves behind: a step that began, a worktree, and no process. */
    const killed = (ticket: number, sessionId?: string): Pick<Setup, "log" | "branches" | "worktrees" | "resume"> => {
        const { log = [], ...rest } = warm(ticket)
        return {
            ...rest,
            log: [...log, { ticket, step: "implement", outcome: "running", at: "2026-09-15T10:00:00.000Z", sessionId }],
        }
    }

    it("should prepare a ticket a killed run left mid-step and take it the rest of the way", async () => {
        // given — ADR-0019: the first tick's live action set is empty, so the stale step is caught there
        const { run, events } = harness({ tickets: [ticket(10)], ...killed(10) })

        // when
        await run()

        // then
        expect(settled(events.appended)).toEqual([
            "#10 setup ok",
            "#10 prepare ok",
            "#10 implement ok",
            "#10 rebase ok",
            "#10 merge ok",
            "#10 gate ok",
            "pull-request ok",
        ])
    })

    it("should send the prepare agent into the ticket's own worktree", async () => {
        // given
        const { run, preparer } = harness({ tickets: [ticket(10)], ...killed(10) })

        // when
        await run()

        // then
        expect(preparer.invocations.map(invocation => invocation.cwd)).toEqual([".afk/4/t10"])
    })

    it("should continue the session the killed attempt was observed to have", async () => {
        // given — ADR-0017: the id came out of a stream, so it names a session that exists
        const { run, agent } = harness({ tickets: [ticket(10)], ...killed(10, "killed-mid-implement") })

        // when
        await run()

        // then
        expect(agent.invocations.map(invocation => invocation.resumeSessionId)).toEqual(["killed-mid-implement"])
    })

    it("should resume no session for an attempt that was never observed to have one", async () => {
        // given — a run killed before the stream carried an id, which is a session that never existed
        const { run, agent } = harness({ tickets: [ticket(10)], ...killed(10) })

        // when
        await run()

        // then
        expect(agent.invocations.map(invocation => invocation.resumeSessionId)).toEqual([undefined])
    })

    it("should land a ticket whose second implementer did what its first could not", async () => {
        // given
        const { run, events } = harness({ tickets: [ticket(10)], recovering: [10] })

        // when
        await run()

        // then
        expect(settled(events.appended)).toEqual([
            "#10 setup ok",
            "#10 implement failed",
            "#10 prepare ok",
            "#10 implement ok",
            "#10 rebase ok",
            "#10 merge ok",
            "#10 gate ok",
            "pull-request ok",
        ])
    })

    it("should spend no further attempt on a ticket whose prepare pass itself failed", async () => {
        // given
        const { run, events } = harness({ tickets: [ticket(10)], idle: [10], preparing: false })

        // when
        await run()

        // then
        expect(settled(events.appended)).toEqual(["#10 setup ok", "#10 implement failed", "#10 prepare failed"])
    })
})

describe("a run that ends in a pull request", () => {
    /** A ticket nothing rescues: its implementer commits nothing and its prepare pass gets nowhere. */
    const wrecked = { idle: [11], preparing: false } as const

    it("should push the spec branch before anything is opened against it", async () => {
        // given
        const { run, git } = harness({ tickets: [ticket(10)] })

        // when
        await run()

        // then
        expect(git.pushed).toEqual(["afk/4/spec"])
    })

    it("should open one pull request, from the spec branch onto the trunk it was cut from", async () => {
        // given
        const { run, tracker } = harness({ tickets: [ticket(10)] })

        // when
        await run()

        // then
        expect(tracker.opened).toEqual([
            expect.objectContaining({ head: "afk/4/spec", base: "main", draft: false, title: "Layerless afk" }),
        ])
    })

    it("should close every verified ticket, by a fact rather than by an agent's recollection", async () => {
        // given
        const { run, tracker } = harness({ tickets: [ticket(10), ticket(12)] })

        // when
        await run()

        // then
        expect(tracker.opened.at(0)?.body.endsWith("Closes #10\nCloses #12")).toBe(true)
    })

    it("should exit 0 once the whole spec is verified and its pull request is open", async () => {
        // given
        const { run } = harness({ tickets: [ticket(10)] })

        // when
        const code = await run()

        // then
        expect(code).toBe(EXIT.complete)
    })

    it("should open a draft for a run that did not land every ticket", async () => {
        // given
        const { run, tracker } = harness({ tickets: [ticket(10), ticket(11)], ...wrecked })

        // when
        await run()

        // then
        expect(tracker.opened.at(0)?.draft).toBe(true)
    })

    it("should name the ticket that failed in the draft's body", async () => {
        // given
        const { run, tracker } = harness({ tickets: [ticket(10), ticket(11)], ...wrecked })

        // when
        await run()

        // then
        expect(tracker.opened.at(0)?.body).toContain("- failed: #11")
    })

    it("should exit 1 for a partial run, so that one line says it is not the whole spec", async () => {
        // given
        const { run } = harness({ tickets: [ticket(10), ticket(11)], ...wrecked })

        // when
        const code = await run()

        // then
        expect(code).toBe(EXIT.partial)
    })

    it("should open nothing at all when the gate proved nothing", async () => {
        // given
        const { run, tracker } = harness({ tickets: [ticket(11)], ...wrecked })

        // when
        await run()

        // then
        expect(tracker.opened).toEqual([])
    })

    it("should say what became of the tickets instead of opening an empty change", async () => {
        // given
        const { run, errors } = harness({ tickets: [ticket(11)], ...wrecked })

        // when
        await run()

        // then
        expect(errors).toContain(
            "afk: no ticket of spec #4 was verified, so there is no pull request to open: failed: #11",
        )
    })

    it("should exit non-zero when the gate proved nothing", async () => {
        // given
        const { run } = harness({ tickets: [ticket(11)], ...wrecked })

        // when
        const code = await run()

        // then
        expect(code).toBe(EXIT.halted)
    })
})

describe("a run the operator interrupted", () => {
    it("should let every implementer that was already running finish and record", async () => {
        // given — both slots are busy when the interrupt arrives, and #12 is still on the slate
        const { run, events } = harness({
            tickets: [ticket(10), ticket(11), ticket(12)],
            maxParallel: 2,
            interruptedDuring: 10,
            ...warm(10, 11),
        })

        // when
        await run()

        // then
        expect(settled(events.appended)).toEqual([
            "#10 setup ok",
            "#11 setup ok",
            "#10 implement ok",
            "#11 implement ok",
        ])
    })

    it("should give no further ticket an implementer once the operator has interrupted", async () => {
        // given
        const { run, agent } = harness({
            tickets: [ticket(10), ticket(11), ticket(12)],
            maxParallel: 2,
            interruptedDuring: 10,
            ...warm(10, 11),
        })

        // when
        await run()

        // then
        expect(agent.invocations.map(workingOn)).toEqual([10, 11])
    })

    it("should say that the run stopped at what was in flight rather than at the end of the slate", async () => {
        // given
        const { run, printed } = harness({ tickets: [ticket(10), ticket(11)], interruptedDuring: 10 })

        // when
        await run()

        // then
        expect(printed).toContain("afk: the run was interrupted, so it stopped at what was already in flight")
    })

    it("should still land the ticket the merge track was already taking through", async () => {
        // given — #10 merges while #11's implementer, which the interrupt arrives during, runs
        const { run, events } = harness({ tickets: [ticket(10), ticket(11)], maxParallel: 1, interruptedDuring: 11 })

        // when
        await run()

        // then
        expect(settled(events.appended)).toContain("#10 gate ok")
    })

    it("should open a draft pull request over what the drain landed", async () => {
        // given
        const { run, tracker } = harness({ tickets: [ticket(10), ticket(11)], maxParallel: 1, interruptedDuring: 11 })

        // when
        await run()

        // then
        expect(tracker.opened.at(0)?.draft).toBe(true)
    })

    it("should exit 1, because a run stopped part-way through is a partial one", async () => {
        // given
        const { run } = harness({ tickets: [ticket(10), ticket(11)], maxParallel: 1, interruptedDuring: 11 })

        // when
        const code = await run()

        // then
        expect(code).toBe(EXIT.partial)
    })
})
