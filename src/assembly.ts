import { type Cli, createCli } from "./cli/cli.ts"
import { EXIT, type ExitCode } from "./cli/exit-codes.ts"
import type { Invocation } from "./cli/invocation.ts"

/**
 * Assembly is not a layer. It is the only module that knows both a port and its implementation:
 * it builds the adapters, calls the factories, and hands the result to the cli.
 */

/**
 * The planner and the run loop are the tickets after this one. Until they exist an accepted
 * invocation has nothing to run, and halting says so rather than exiting `0` over work that did
 * not happen.
 */
const notImplementedYet =
    (printError: (line: string) => void) =>
    async (invocation: Invocation): Promise<ExitCode> => {
        printError(`afk: ${invocation.mode} is not implemented yet`)
        return EXIT.halted
    }

export const assembleCli = (): Cli => {
    const printError = (line: string): void => {
        process.stderr.write(`${line}\n`)
    }

    return createCli({
        isInteractive: () => process.stdin.isTTY === true,
        printError,
        run: notImplementedYet(printError),
    })
}
