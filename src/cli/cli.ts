import { parseArgs, USAGE } from "./args.ts"
import { EXIT, type ExitCode } from "./exit-codes.ts"
import { type Invocation, resolveInvocation } from "./invocation.ts"

export type CliDeps = {
    isInteractive: () => boolean
    printError: (line: string) => void
    /** The driving port of a run. Everything afk does once the arguments are accepted. */
    run: (invocation: Invocation) => Promise<ExitCode>
}

export type Cli = (argv: string[]) => Promise<ExitCode>

/** Parse, decide whether the invocation is one afk accepts, and hand it over. No rules beyond that. */
export const createCli =
    (deps: CliDeps): Cli =>
    async argv => {
        const resolution = resolveInvocation(parseArgs(argv), { interactive: deps.isInteractive() })

        if (resolution.kind === "refusal") {
            deps.printError(`afk: ${resolution.message}`)
            deps.printError(`usage: ${USAGE}`)
            return EXIT.misuse
        }

        return deps.run(resolution.invocation)
    }
