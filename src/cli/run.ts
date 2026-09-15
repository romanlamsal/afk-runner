import type { PlanSpec } from "../service/plan.ts"
import { EXIT, type ExitCode } from "./exit-codes.ts"
import type { Invocation } from "./invocation.ts"
import { planOutput } from "./plan-output.ts"

export type RunDeps = {
    plan: PlanSpec
    print: (line: string) => void
    printError: (line: string) => void
}

/**
 * The boundary between an accepted invocation and the use case that serves it. It calls one
 * service, turns what came back into lines and an exit code, and holds no rule about a run.
 *
 * Confirming and implementing are the tickets after this one: a mode that cannot run yet halts,
 * because exiting `0` over work that did not happen is the failure mode this whole rewrite exists
 * to remove.
 */
export const createRun =
    ({ plan, print, printError }: RunDeps) =>
    async (invocation: Invocation): Promise<ExitCode> => {
        if (invocation.mode !== "plan-only") {
            printError(`afk: ${invocation.mode} is not implemented yet`)
            return EXIT.halted
        }

        const planned = await plan(invocation.spec)
        if (!planned.ok) {
            printError(`afk: ${planned.reason}`)
            return EXIT.halted
        }

        for (const line of planOutput(planned.manifest, invocation.maxParallel)) {
            print(line)
        }
        return EXIT.complete
    }
