import { describe, expect, it } from "vitest"
import { EXIT } from "../../src/cli/exit-codes.ts"
import type { Invocation } from "../../src/cli/invocation.ts"
import { createRun } from "../../src/cli/run.ts"
import type { Progress } from "../../src/domain/events.ts"
import type { Manifest } from "../../src/domain/manifest.ts"
import type { Mode } from "../../src/domain/mode.ts"
import type { PreparedRun } from "../../src/domain/run.ts"
import type { DriveResult } from "../../src/service/drive.ts"
import type { FinishResult } from "../../src/service/finish.ts"
import type { StartRequest, StartResult } from "../../src/service/start.ts"

const MANIFEST: Manifest = {
    spec: 4,
    setup: "npm ci",
    verify: "npm run check",
    tickets: [{ number: 5, title: "Plan a spec", blockedBy: [] }],
}

const PREPARED: PreparedRun = {
    root: "/repo",
    spec: 4,
    trunk: "main",
    branch: "afk/4/spec",
    gate: ".afk/4/gate",
    manifest: MANIFEST,
}

const invocation = (mode: Mode): Invocation => ({
    spec: 4,
    mode,
    consented: false,
    forceFresh: false,
    maxParallel: 3,
})

const NOTHING: Progress = { verified: [], unverified: [], failed: [], skipped: [] }

const WORKED: DriveResult = { outcome: "done", reason: undefined, progress: { ...NOTHING, verified: [5] } }

const OPENED: FinishResult = { outcome: "opened", draft: false, url: "https://example.invalid/pull/1" }

const harness = (
    result: StartResult = { outcome: "planned", manifest: MANIFEST },
    { driven = WORKED, finished = OPENED }: { driven?: DriveResult; finished?: FinishResult } = {},
) => {
    const printed: string[] = []
    const errors: string[] = []
    const started: StartRequest[] = []
    const ended: Progress[] = []
    const run = createRun({
        start: async request => {
            started.push(request)
            return result
        },
        drive: async () => driven,
        finish: async (_prepared, progress) => {
            ended.push(progress)
            return finished
        },
        print: line => printed.push(line),
        printError: line => errors.push(line),
    })
    return { run, printed, errors, started, ended }
}

const worked = (prepared: PreparedRun = PREPARED, options: { driven?: DriveResult; finished?: FinishResult } = {}) =>
    harness({ outcome: "prepared", run: prepared }, options)

describe("createRun", () => {
    it("should start the spec it was invoked for, in the mode it was invoked in", async () => {
        // given
        const { run, started } = harness()

        // when
        await run(invocation("plan-only"))

        // then
        expect(started).toEqual([{ spec: 4, mode: "plan-only", consented: false }])
    })

    it("should print the execution order of the manifest it planned", async () => {
        // given
        const { run, printed } = harness()

        // when
        await run(invocation("plan-only"))

        // then
        expect(printed).toContain("  1. #5 Plan a spec")
    })

    it("should exit 0 when the spec was planned", async () => {
        // given
        const { run } = harness()

        // when
        const code = await run(invocation("plan-only"))

        // then
        expect(code).toBe(EXIT.complete)
    })

    it("should say why the run was refused", async () => {
        // given
        const { run, errors } = harness({ outcome: "refused", reason: "the planner failed: exit 1" })

        // when
        await run(invocation("plan-only"))

        // then
        expect(errors).toContain("afk: the planner failed: exit 1")
    })

    it("should exit 3 when the run was refused", async () => {
        // given
        const { run } = harness({ outcome: "refused", reason: "the planner failed: exit 1" })

        // when
        const code = await run(invocation("plan-only"))

        // then
        expect(code).toBe(EXIT.halted)
    })

    it("should print nothing when the run was refused", async () => {
        // given
        const { run, printed } = harness({ outcome: "refused", reason: "the planner failed: exit 1" })

        // when
        await run(invocation("plan-only"))

        // then
        expect(printed).toEqual([])
    })

    it("should exit 3 when the operator closed the confirmation", async () => {
        // given
        const { run } = harness({ outcome: "aborted" })

        // when
        const code = await run(invocation("plan-and-implement"))

        // then
        expect(code).toBe(EXIT.halted)
    })

    it("should say that nothing was started when the operator closed the confirmation", async () => {
        // given
        const { run, errors } = harness({ outcome: "aborted" })

        // when
        await run(invocation("plan-and-implement"))

        // then
        expect(errors).toContain("afk: the confirmation was closed, so nothing was started")
    })

    it("should print where a prepared run put its spec branch", async () => {
        // given
        const { run, printed } = worked()

        // when
        await run(invocation("plan-and-implement"))

        // then
        expect(printed).toContain("spec #4: afk/4/spec cut from main")
    })
})

describe("createRun: the end of a run", () => {
    it("should finish with what the slate came to", async () => {
        // given
        const { run, ended } = worked()

        // when
        await run(invocation("plan-and-implement"))

        // then
        expect(ended).toEqual([WORKED.progress])
    })

    it("should print where the pull request is", async () => {
        // given
        const { run, printed } = worked()

        // when
        await run(invocation("plan-and-implement"))

        // then
        expect(printed).toContain("pull request: https://example.invalid/pull/1")
    })

    it("should exit 0 for a ready pull request over the whole spec", async () => {
        // given
        const { run } = worked()

        // when
        const code = await run(invocation("plan-and-implement"))

        // then
        expect(code).toBe(EXIT.complete)
    })

    it("should exit 1 for a draft pull request over part of one", async () => {
        // given
        const { run } = worked(PREPARED, { finished: { outcome: "opened", draft: true, url: undefined } })

        // when
        const code = await run(invocation("plan-and-implement"))

        // then
        expect(code).toBe(EXIT.partial)
    })

    it("should say why no pull request was opened", async () => {
        // given
        const { run, errors } = worked(PREPARED, {
            finished: { outcome: "failed", reason: "afk/4/spec could not be pushed: remote rejected" },
        })

        // when
        await run(invocation("plan-and-implement"))

        // then
        expect(errors).toContain("afk: afk/4/spec could not be pushed: remote rejected")
    })

    it("should exit 3 when no pull request was opened", async () => {
        // given
        const { run } = worked(PREPARED, {
            finished: { outcome: "failed", reason: "afk/4/spec could not be pushed: remote rejected" },
        })

        // when
        const code = await run(invocation("plan-and-implement"))

        // then
        expect(code).toBe(EXIT.halted)
    })

    it("should open nothing for a run that halted itself", async () => {
        // given
        const { run, ended } = worked(PREPARED, {
            driven: {
                outcome: "halted",
                reason: "afk/4/spec is broken independently of any ticket",
                progress: NOTHING,
            },
        })

        // when
        await run(invocation("plan-and-implement"))

        // then
        expect(ended).toEqual([])
    })

    it("should exit 3 for a run that halted itself", async () => {
        // given
        const { run } = worked(PREPARED, {
            driven: {
                outcome: "halted",
                reason: "afk/4/spec is broken independently of any ticket",
                progress: NOTHING,
            },
        })

        // when
        const code = await run(invocation("plan-and-implement"))

        // then
        expect(code).toBe(EXIT.halted)
    })
})
