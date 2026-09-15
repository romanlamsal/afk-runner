import type { DriveRun } from "../service/drive.ts"
import type { StartRun } from "../service/start.ts"
import { EXIT, type ExitCode } from "./exit-codes.ts"
import type { Invocation } from "./invocation.ts"
import { planOutput } from "./plan-output.ts"
import { preparedOutput } from "./prepared-output.ts"
import { progressOutput } from "./progress-output.ts"

export type RunDeps = {
    start: StartRun
    drive: DriveRun
    print: (line: string) => void
    printError: (line: string) => void
}

/**
 * The boundary between an accepted invocation and the use cases that serve it. It calls a service,
 * turns what came back into lines and an exit code, and holds no rule about a run.
 *
 * Merging is the ticket after this one: a run whose tickets are implemented and cannot yet land
 * halts, because exiting `0` over work that did not happen is the failure mode this whole rewrite
 * exists to remove.
 */
export const createRun =
    ({ start, drive, print, printError }: RunDeps) =>
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

            case "prepared": {
                for (const line of preparedOutput(started.run)) {
                    print(line)
                }

                const driven = await drive(started.run, { maxParallel: invocation.maxParallel })
                for (const line of progressOutput(driven.progress)) {
                    print(line)
                }

                if (driven.outcome === "halted") {
                    printError(`afk: ${driven.reason}`)
                    return EXIT.halted
                }

                printError("afk: merging is not implemented yet")
                return EXIT.halted
            }
        }
    }
