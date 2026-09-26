import type { ConfigureAction } from "../service/configure.ts"
import { parseArgs, USAGE } from "./args.ts"
import { CONFIG_COMMAND, CONFIG_USAGE, parseConfigArgs } from "./config-args.ts"
import { resolveConfigInvocation } from "./config-invocation.ts"
import { EXIT, type ExitCode } from "./exit-codes.ts"
import { type Invocation, resolveInvocation } from "./invocation.ts"

export type CliDeps = {
    isInteractive: () => boolean
    printError: (line: string) => void
    /** The driving port of a run. Everything afk does once the arguments are accepted. */
    run: (invocation: Invocation) => Promise<ExitCode>
    /** `afk config`: writing or checking the afkonfig (ADR-0039). */
    config: (action: ConfigureAction) => Promise<ExitCode>
}

export type Cli = (argv: string[]) => Promise<ExitCode>

/** Parse, decide whether the invocation is one afk accepts, and hand it over. No rules beyond that. */
export const createCli =
    (deps: CliDeps): Cli =>
    async argv => {
        const refuse = (message: string, usage: string): ExitCode => {
            deps.printError(`afk: ${message}`)
            deps.printError(`usage: ${usage}`)
            return EXIT.misuse
        }

        // A spec is a number, so the word cannot be one: `afk config` is a command of its own
        // rather than a spec afk refuses.
        const [first, ...rest] = argv
        if (first === CONFIG_COMMAND) {
            const resolution = resolveConfigInvocation(parseConfigArgs(rest))
            return resolution.kind === "refusal"
                ? refuse(resolution.message, CONFIG_USAGE)
                : deps.config(resolution.action)
        }

        const resolution = resolveInvocation(parseArgs(argv), { interactive: deps.isInteractive() })
        return resolution.kind === "refusal" ? refuse(resolution.message, USAGE) : deps.run(resolution.invocation)
    }
