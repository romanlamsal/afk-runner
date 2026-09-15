import { describe, expect, it } from "vitest"
import { createCli } from "../../src/cli/cli.ts"
import { EXIT } from "../../src/cli/exit-codes.ts"
import { createRun } from "../../src/cli/run.ts"
import type { AgentInvocation } from "../../src/domain/agent.ts"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import type { Git } from "../../src/domain/git.ts"
import type { Ticket } from "../../src/domain/manifest.ts"
import { mergedTickets } from "../../src/domain/squash.ts"
import { createDriveService } from "../../src/service/drive.ts"
import { createFixService } from "../../src/service/fix.ts"
import { createGateService, createProveBranch } from "../../src/service/gate.ts"
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
    /** The operator's command that goes red in this repository, if one does. */
    failing?: string
    /** What a red gate is the fault of: the merge that just landed, or the branch itself. */
    red?: "the merge" | "the branch"
    /** Whether the one fix attempt makes a red gate green. */
    fixing?: boolean
    tracker?: FakeTrackerSetup
    maxParallel?: number
}

const harness = ({
    tickets,
    idle = [],
    colliding = [],
    resolving = true,
    failing,
    red = "the branch",
    fixing = false,
    tracker: trackerSetup = {},
    maxParallel = 3,
}: Setup) => {
    const manifest = manifestOf(tickets)
    const git = createFakeGit({
        branches: { main: ["spec-tip"], "afk/4/spec": ["spec-tip"] },
        colliding: colliding.map(number => `afk/4/t${number}`),
    })
    const agent = createFakeAgent()
    const resolver = createFakeAgent()
    const fixer = createFakeAgent()
    const commands = createFakeCommands(failing)
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
        gate: createGateService({ events: events.log, now, prove }),
        git: git.git,
        now,
        // A fix agent that commits a fix on the spec branch and makes the repository green again,
        // unless this scenario says it is one that cannot.
        fix: createFixService({
            agent: async invocation => {
                const result = await fixer.run(invocation)
                if (fixing) {
                    git.commit("afk/4/spec", "the-fix")
                    commands.mend()
                }
                return result
            },
            events: events.log,
            git: gitForFix,
            now,
            prove,
        }),
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
        commands,
        concurrency,
        events,
        fixer,
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
            "#10 merge ok",
            "#10 gate ok",
            "#11 rebase ok",
            "#11 merge ok",
            "#11 gate ok",
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
            "#11 implement ok",
            "#11 rebase ok",
            "#11 merge ok",
            "#11 gate failed",
            "#11 gate ok",
            "#12 implement ok",
            "#12 rebase ok",
            "#12 merge ok",
            "#12 gate ok",
        ])
    })

    it("should revert the merge the fix attempt could not save, and skip the ticket's dependents", async () => {
        // given
        const { run, events } = harness({ tickets: [ticket(11), ticket(12, [11])], ...blamed })

        // when
        await run()

        // then
        expect(settled(events.appended)).toEqual([
            "#11 implement ok",
            "#11 rebase ok",
            "#11 merge ok",
            "#11 gate failed",
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

    it("should gate a ticket a killed run merged but never gated", async () => {
        // given — the squash is on the spec branch, and the log stops at the merge
        const { run, events, git } = harness({ tickets: [ticket(10)] })
        git.commit("afk/4/spec", "squash-afk/4/t10", "Ticket 10 (#10)\n\nafk-ticket: 4/10")
        events.appended.push({ ticket: 10, step: "merge", outcome: "ok", at: "2026-09-15T10:00:00.000Z" })

        // when
        await run()

        // then — the first is what the killed run left; the second is afk finding it already there
        expect(settled(events.appended)).toEqual(["#10 merge ok", "#10 merge ok", "#10 gate ok"])
    })

    it("should never squash a ticket the spec branch already carries a second time", async () => {
        // given
        const { run, git, events } = harness({ tickets: [ticket(10)] })
        git.commit("afk/4/spec", "squash-afk/4/t10", "Ticket 10 (#10)\n\nafk-ticket: 4/10")
        events.appended.push({ ticket: 10, step: "merge", outcome: "ok", at: "2026-09-15T10:00:00.000Z" })

        // when
        await run()

        // then
        expect(git.commitsOn("afk/4/spec")).toEqual(["spec-tip", "squash-afk/4/t10"])
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
