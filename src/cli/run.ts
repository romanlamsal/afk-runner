import type { DriveRun } from "../service/drive.ts"
import type { FinishRun } from "../service/finish.ts"
import type { StartRun } from "../service/start.ts"
import { EXIT, type ExitCode } from "./exit-codes.ts"
import type { Invocation } from "./invocation.ts"
import { planOutput } from "./plan-output.ts"
import { preparedOutput } from "./prepared-output.ts"
import { progressOutput } from "./progress-output.ts"
import { pullRequestOutput } from "./pull-request-output.ts"

export type RunDeps = {
    start: StartRun
    drive: DriveRun
    finish: FinishRun
    print: (line: string) => void
    printError: (line: string) => void
}

/**
 * The boundary between an accepted invocation and the use cases that serve it. It calls a service,
 * turns what came back into lines and an exit code, and holds no rule about a run.
 *
 * A draft pull request is what a partial run comes to, and the exit code says the same thing in a
 * number: `0` is a ready pull request over a whole spec, `1` is a draft over part of one, and
 * anything else opened nothing. Success is never printed over a failure that happened, which is the
 * failure mode this whole rewrite exists to remove.
 */
export const createRun =
    ({ start, drive, finish, print, printError }: RunDeps) =>
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
                // An interrupted run is a partial one: it drained, so what follows is everything
                // that was in flight when the operator stopped it and nothing that came after. It
                // still opens its pull request, because a draft naming what is missing is what a
                // partial run is worth — and what did not land is the next start's work either way.
                if (driven.outcome === "interrupted") {
                    print("afk: the run was interrupted, so it stopped at what was already in flight")
                }
                for (const line of progressOutput(driven.progress)) {
                    print(line)
                }

                // A halted run opens nothing. It stopped itself because something is wrong with the
                // branch or the run rather than with a ticket, and a pull request over that is a
                // review of a question afk already knows the answer to.
                if (driven.outcome === "halted") {
                    printError(`afk: ${driven.reason}`)
                    return EXIT.halted
                }

                const finished = await finish(started.run, driven.progress)
                if (finished.outcome === "failed") {
                    printError(`afk: ${finished.reason}`)
                    return EXIT.halted
                }

                for (const line of pullRequestOutput(finished)) {
                    print(line)
                }
                return finished.draft ? EXIT.partial : EXIT.complete
            }
        }
    }
