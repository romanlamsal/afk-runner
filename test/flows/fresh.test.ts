import { describe, expect, it } from "vitest"
import { createCli } from "../../src/cli/cli.ts"
import { EXIT } from "../../src/cli/exit-codes.ts"
import { createRun } from "../../src/cli/run.ts"
import type { Manifest } from "../../src/domain/manifest.ts"
import { createFreshService } from "../../src/service/fresh.ts"
import { createPlanService } from "../../src/service/plan.ts"
import { createStartService } from "../../src/service/start.ts"
import { createFakeAgent } from "../fakes/agent.ts"
import { createStubDrive } from "../fakes/drive.ts"
import { createFakeEnvironment } from "../fakes/environment.ts"
import { createFakeEventLog } from "../fakes/event-log.ts"
import { createStubFinish } from "../fakes/finish.ts"
import { createFakeGit, type FakeRepository } from "../fakes/git.ts"
import { createFakeManifestStore } from "../fakes/manifest-store.ts"
import { createFakeOperator } from "../fakes/operator.ts"
import { createFakeRunRecords } from "../fakes/run-records.ts"
import { createStubShowBoard } from "../fakes/show-board.ts"
import { createFakeTracker } from "../fakes/tracker.ts"

/**
 * `--force-fresh`, from the argument vector to a repository with nothing of the old run left in it.
 * The interesting part is the pair: the same invocation is refused without the flag and starts over
 * with it, which is the whole of what one command to start over means.
 */
const MANIFEST: Manifest = {
    spec: 4,
    setup: "npm ci",
    verify: "npm run check",
    tickets: [{ number: 5, title: "Plan a spec", blockedBy: [] }],
}

/** What a run that died during its merge track left behind: branches, worktrees, a pushed spec branch. */
const WRECKED: FakeRepository = {
    branches: {
        main: ["trunk-1"],
        "afk/4/spec": ["trunk-1", "squash-5"],
        "afk/4/t6": ["trunk-1", "work-6"],
    },
    checkouts: { ".afk/4/gate": "afk/4/spec", ".afk/4/t6": "afk/4/t6" },
    remoteBranches: ["main", "afk/4/spec"],
}

const harness = () => {
    const agent = createFakeAgent({ structuredOutput: MANIFEST })
    const environment = createFakeEnvironment()
    const git = createFakeGit(WRECKED)
    const manifests = createFakeManifestStore()
    const operator = createFakeOperator()
    // A run exists because a ticket was attempted, not because the log file is there (ADR-0028).
    const events = createFakeEventLog([
        { ticket: 10, step: "implement", outcome: "running", at: "2026-09-15T11:18:38.314Z" },
    ])
    const records = createFakeRunRecords({ log: events })
    const tracker = createFakeTracker({ openFor: ["afk/4/spec"] })
    const printed: string[] = []
    const errors: string[] = []

    const cli = createCli({
        isInteractive: () => true,
        printError: line => errors.push(line),
        run: createRun({
            showBoard: createStubShowBoard(),
            fresh: createFreshService({
                cwd: "/repo",
                git: git.git,
                records: records.records,
                tracker: tracker.tracker,
            }),
            start: createStartService({
                events: events.log,
                cwd: "/repo",
                environment: environment.copy,
                git: git.git,
                manifests: manifests.store,
                operator: operator.operator,
                plan: createPlanService({
                    agent: agent.run,
                    events: events.log,
                    git: git.git,
                    manifests: manifests.store,
                    now: () => new Date(),
                }),
                records: records.records,
            }),
            drive: createStubDrive(),
            finish: createStubFinish(),
            print: line => printed.push(line),
            printError: line => errors.push(line),
            boardDrawn: false,
        }),
    })

    return { cli, git, records, tracker, printed, errors }
}

describe("afk <spec> --force-fresh", () => {
    it("should refuse the same invocation without the flag, which is what the flag is for", async () => {
        // given
        const { cli, errors } = harness()

        // when
        await cli(["4"])

        // then
        expect(errors[0]).toContain("has a run already")
    })

    it("should start the spec over once the old run is gone, rather than refusing over it", async () => {
        // given
        const { cli, errors } = harness()

        // when
        await cli(["4", "--force-fresh"])

        // then
        expect(errors.join("\n")).not.toContain("has a run already")
    })

    it("should leave no branch of the old run behind", async () => {
        // given
        const { cli, git } = harness()

        // when
        await cli(["4", "--force-fresh", "--plan-only"])

        // then
        expect(git.localBranches()).toEqual(["main"])
    })

    it("should close the pull request the old run opened", async () => {
        // given
        const { cli, tracker } = harness()

        // when
        await cli(["4", "--force-fresh", "--plan-only"])

        // then
        expect(tracker.closed).toEqual(["afk/4/spec"])
    })

    it("should release no claim the old run made", async () => {
        // given
        const { cli, tracker } = harness()

        // when
        await cli(["4", "--force-fresh", "--plan-only"])

        // then
        expect(tracker.claimed).toEqual([])
    })

    it("should exit complete for a spec it planned afresh", async () => {
        // given
        const { cli } = harness()

        // when
        const code = await cli(["4", "--force-fresh", "--plan-only"])

        // then
        expect(code).toBe(EXIT.complete)
    })

    it("should cut the spec branch again from trunk, so that the next run starts from nothing", async () => {
        // given
        const { cli, git } = harness()

        // when
        await cli(["4", "--force-fresh"])

        // then
        expect(git.worktrees).toEqual([{ path: ".afk/4/gate", branch: "afk/4/spec", startPoint: "main" }])
    })
})
