import type { StartRun } from "../service/start.ts"
import { EXIT, type ExitCode } from "./exit-codes.ts"
import type { Invocation } from "./invocation.ts"
import { planOutput } from "./plan-output.ts"
import { preparedOutput } from "./prepared-output.ts"

export type RunDeps = {
    start: StartRun
    print: (line: string) => void
    printError: (line: string) => void
}

/**
 * The boundary between an accepted invocation and the use case that serves it. It calls one service,
 * turns what came back into lines and an exit code, and holds no rule about a run.
 *
 * Implementing is the ticket after this one: a run that is prepared and cannot yet be implemented
 * halts, because exiting `0` over work that did not happen is the failure mode this whole rewrite
 * exists to remove.
 */
export const createRun =
    ({ start, print, printError }: RunDeps) =>
    async (invocation: Invocation): Promise<ExitCode> => {
        const started = await start({
            spec: invocation.spec,
            mode: invocation.mode,
            consented: invocation.consented,
        })

        switch (started.outcome) {
            case "refused":
                printError(`afk: ${started.reason}`)
                return EXIT.halted

            case "aborted":
                printError("afk: the confirmation was closed, so nothing was started")
                return EXIT.halted

            case "planned":
                for (const line of planOutput(started.manifest, invocation.maxParallel)) {
                    print(line)
                }
                return EXIT.complete

            case "prepared":
                for (const line of preparedOutput(started.run)) {
                    print(line)
                }
                printError("afk: implementing is not implemented yet")
                return EXIT.halted
        }
    }
