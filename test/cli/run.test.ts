import { describe, expect, it } from "vitest"
import { EXIT } from "../../src/cli/exit-codes.ts"
import type { Invocation, Mode } from "../../src/cli/invocation.ts"
import { createRun } from "../../src/cli/run.ts"
import type { Manifest } from "../../src/domain/manifest.ts"
import type { PlanResult } from "../../src/service/plan.ts"

const MANIFEST: Manifest = {
    spec: 4,
    setup: "npm ci",
    verify: "npm run check",
    tickets: [{ number: 5, title: "Plan a spec", blockedBy: [] }],
}

const invocation = (mode: Mode): Invocation => ({
    spec: 4,
    mode,
    consented: false,
    forceFresh: false,
    maxParallel: 3,
})

const harness = (result: PlanResult = { ok: true, manifest: MANIFEST }) => {
    const printed: string[] = []
    const errors: string[] = []
    const planned: number[] = []
    const run = createRun({
        plan: async spec => {
            planned.push(spec)
            return result
        },
        print: line => printed.push(line),
        printError: line => errors.push(line),
    })
    return { run, printed, errors, planned }
}

describe("createRun", () => {
    it("should plan the spec it was invoked for", async () => {
        // given
        const { run, planned } = harness()

        // when
        await run(invocation("plan-only"))

        // then
        expect(planned).toEqual([4])
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

    it("should say why planning stopped", async () => {
        // given
        const { run, errors } = harness({ ok: false, reason: "the planner failed: exit 1" })

        // when
        await run(invocation("plan-only"))

        // then
        expect(errors).toContain("afk: the planner failed: exit 1")
    })

    it("should exit 3 when planning stopped the run", async () => {
        // given
        const { run } = harness({ ok: false, reason: "the planner failed: exit 1" })

        // when
        const code = await run(invocation("plan-only"))

        // then
        expect(code).toBe(EXIT.halted)
    })

    it("should print nothing when planning stopped the run", async () => {
        // given
        const { run, printed } = harness({ ok: false, reason: "the planner failed: exit 1" })

        // when
        await run(invocation("plan-only"))

        // then
        expect(printed).toEqual([])
    })

    it.each(["plan-and-implement", "implement-only"] as const satisfies readonly Mode[])(
        "should halt on %s until implementing exists",
        async mode => {
            // given
            const { run, errors } = harness()

            // when
            await run(invocation(mode))

            // then
            expect(errors).toContain(`afk: ${mode} is not implemented yet`)
        },
    )
})
