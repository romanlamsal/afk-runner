import { describe, expect, it } from "vitest"
import { createCli } from "../../src/cli/cli.ts"
import { EXIT } from "../../src/cli/exit-codes.ts"
import { createRun } from "../../src/cli/run.ts"
import type { BaseState } from "../../src/domain/git.ts"
import type { Manifest } from "../../src/domain/manifest.ts"
import type { Commands } from "../../src/domain/operator.ts"
import { createPlanService } from "../../src/service/plan.ts"
import { createStartService } from "../../src/service/start.ts"
import { createFakeAgent } from "../fakes/agent.ts"
import { createStubDrive } from "../fakes/drive.ts"
import { createFakeEnvironment } from "../fakes/environment.ts"
import { createFakeEventLog } from "../fakes/event-log.ts"
import { createStubFinish } from "../fakes/finish.ts"
import { createStubFresh } from "../fakes/fresh.ts"
import { createFakeGit } from "../fakes/git.ts"
import { createFakeManifestStore } from "../fakes/manifest-store.ts"
import { createFakeOperator } from "../fakes/operator.ts"
import { createStubRelease } from "../fakes/release.ts"
import { createFakeRunLock } from "../fakes/run-lock.ts"
import { createFakeRunRecords } from "../fakes/run-records.ts"
import { createStubShowBoard } from "../fakes/show-board.ts"
import { createFakeTakeOver } from "../fakes/takeover.ts"

/**
 * The bare invocation, from the argument vector to a run that is ready to implement: plan, confirm,
 * lay the run directory down and cut the spec branch. Nothing here reaches past a port.
 */
const MANIFEST: Manifest = {
    spec: 4,
    setup: "npm ci",
    verify: "npm run check",
    tickets: [{ number: 5, title: "Plan a spec", blockedBy: [] }],
}

const harness = ({ base, answer }: { base?: BaseState; answer?: Commands } = {}) => {
    const agent = createFakeAgent({ structuredOutput: MANIFEST })
    const manifests = createFakeManifestStore()
    const environment = createFakeEnvironment()
    const git = createFakeGit(base === undefined ? {} : { base })
    const operator = createFakeOperator({ answer })
    const records = createFakeRunRecords()
    const lock = createFakeRunLock()
    const events = createFakeEventLog()
    const printed: string[] = []
    const errors: string[] = []
    const cli = createCli({
        isInteractive: () => true,
        printError: line => errors.push(line),
        run: createRun({
            release: createStubRelease(),
            showBoard: createStubShowBoard(),
            fresh: createStubFresh(),
            drive: createStubDrive(),
            finish: createStubFinish(),
            start: createStartService({
                events: events.log,
                cwd: "/repo",
                environment: environment.copy,
                git: git.git,
                now: () => new Date(),
                manifests: manifests.store,
                operator: operator.operator,
                plan: createPlanService({
                    agent: agent.run,
                    events: events.log,
                    git: git.git,
                    manifests: manifests.store,
                    now: () => new Date(),
                }),
                lock: lock.lock,
                takeOver: createFakeTakeOver(lock),
                self: { pid: 1 },
                records: records.records,
            }),
            print: line => printed.push(line),
            printError: line => errors.push(line),
            boardDrawn: false,
        }),
    })
    return { cli, git, manifests, operator, records, printed, errors }
}

describe("afk <spec>", () => {
    it("should create the run directory before the planner writes anything into it", async () => {
        // given
        const { cli, records } = harness()

        // when
        await cli(["4"])

        // then
        expect(records.created).toEqual([{ root: "/repo", spec: 4 }])
    })

    it("should show the operator the planner's commands", async () => {
        // given
        const { cli, operator } = harness()

        // when
        await cli(["4"])

        // then
        expect(operator.screens[0]?.commands).toEqual({ setup: "npm ci", verify: "npm run check" })
    })

    it("should carry the state of the base into the confirmation screen", async () => {
        // given
        const { cli, operator } = harness({
            base: { branch: "main", ahead: 0, behind: 0, compared: true, dirty: true },
        })

        // when
        await cli(["4"])

        // then
        expect(operator.screens[0]?.notices).toEqual([
            { kind: "warning", message: expect.stringContaining("uncommitted changes") },
        ])
    })

    it("should cut the spec branch from the local trunk into the gate worktree", async () => {
        // given
        const { cli, git } = harness()

        // when
        await cli(["4"])

        // then
        expect(git.worktrees).toEqual([{ path: ".afk/4/gate", branch: "afk/4/spec", startPoint: "main" }])
    })

    it("should print the commands it will run", async () => {
        // given
        const { cli, printed } = harness({ answer: { setup: "pnpm i", verify: "pnpm check" } })

        // when
        await cli(["4"])

        // then
        expect(printed).toContain("setup:  pnpm i")
    })

    it("should halt until implementing exists, rather than exit 0 over work that did not happen", async () => {
        // given
        const { cli } = harness()

        // when
        const code = await cli(["4"])

        // then
        expect(code).toBe(EXIT.halted)
    })
})
