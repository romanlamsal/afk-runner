import { describe, expect, it } from "vitest"
import { createCli } from "../../src/cli/cli.ts"
import { EXIT } from "../../src/cli/exit-codes.ts"
import { createRun } from "../../src/cli/run.ts"
import type { Manifest } from "../../src/domain/manifest.ts"
import { createPlanService } from "../../src/service/plan.ts"
import { createStartService } from "../../src/service/start.ts"
import { createFakeAgent } from "../fakes/agent.ts"
import { createStubDrive } from "../fakes/drive.ts"
import { createFakeEnvironment } from "../fakes/environment.ts"
import { createStubFinish } from "../fakes/finish.ts"
import { createStubFresh } from "../fakes/fresh.ts"
import { createFakeGit } from "../fakes/git.ts"
import { createFakeManifestStore } from "../fakes/manifest-store.ts"
import { createFakeOperator } from "../fakes/operator.ts"
import { createFakeRunRecords } from "../fakes/run-records.ts"

/**
 * The second of the spec's three seams: the assembled run, driven through fake ports from the
 * argument vector it was invoked with. Nothing here reaches past a port.
 *
 * It mirrors no source file deliberately — a flow spans the cli, a service and its ports, which is
 * the point of it. Everything that mirrors one file is tested beside that file.
 */

const MANIFEST: Manifest = {
    spec: 4,
    setup: "npm ci",
    verify: "npm run check",
    tickets: [
        { number: 5, title: "Plan a spec", blockedBy: [] },
        { number: 6, title: "Prepare a run", blockedBy: [5] },
    ],
}

const harness = (reply: { structuredOutput: unknown } = { structuredOutput: MANIFEST }) => {
    const agent = createFakeAgent(reply)
    const manifests = createFakeManifestStore()
    const environment = createFakeEnvironment()
    const git = createFakeGit()
    const operator = createFakeOperator()
    const records = createFakeRunRecords()
    const printed: string[] = []
    const errors: string[] = []
    const start = createStartService({
        cwd: "/repo",
        environment: environment.copy,
        git: git.git,
        manifests: manifests.store,
        operator: operator.operator,
        plan: createPlanService({
            agent: agent.run,
            manifests: manifests.store,
            now: () => new Date("2026-09-15T11:18:38.314Z"),
        }),
        records: records.records,
    })
    const cli = createCli({
        isInteractive: () => true,
        printError: line => errors.push(line),
        run: createRun({
            start,
            fresh: createStubFresh(),
            drive: createStubDrive(),
            finish: createStubFinish(),
            print: line => printed.push(line),
            printError: line => errors.push(line),
        }),
    })
    return { cli, agent, git, manifests, operator, printed, errors }
}

describe("afk <spec> --plan-only", () => {
    it("should write the manifest the planner emitted", async () => {
        // given
        const { cli, manifests } = harness()

        // when
        await cli(["4", "--plan-only"])

        // then
        expect(manifests.written).toEqual([{ root: "/repo", spec: 4, manifest: MANIFEST }])
    })

    it("should print the execution order", async () => {
        // given
        const { cli, printed } = harness()

        // when
        await cli(["4", "--plan-only"])

        // then
        expect(printed).toEqual(expect.arrayContaining(["  1. #5 Plan a spec", "  2. #6 Prepare a run"]))
    })

    it("should exit 0", async () => {
        // given
        const { cli } = harness()

        // when
        const code = await cli(["4", "--plan-only"])

        // then
        expect(code).toBe(EXIT.complete)
    })

    it("should ask the planner about the spec it was invoked for", async () => {
        // given
        const { cli, agent } = harness()

        // when
        await cli(["4", "--plan-only"])

        // then
        expect(agent.invocations[0]?.prompt).toContain("#4")
    })

    it("should halt when the planner emitted no manifest", async () => {
        // given
        const { cli } = harness({ structuredOutput: undefined })

        // when
        const code = await cli(["4", "--plan-only"])

        // then
        expect(code).toBe(EXIT.halted)
    })

    it("should write nothing when the planner emitted no manifest", async () => {
        // given
        const { cli, manifests } = harness({ structuredOutput: undefined })

        // when
        await cli(["4", "--plan-only"])

        // then
        expect(manifests.written).toEqual([])
    })
})
