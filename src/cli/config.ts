import type { Pinned } from "../domain/afkonfig.ts"
import type { Configure, ConfigureAction } from "../service/configure.ts"
import { invalidAfkonfigOutput } from "./afkonfig-output.ts"
import { EXIT, type ExitCode } from "./exit-codes.ts"

export type ConfigDeps = {
    /** The driving port of `afk config`. */
    configure: Configure
    print: (line: string) => void
    printError: (line: string) => void
}

const pinnedLines = (pinned: Pinned): string[] => [
    "afk: afkonfig.ts is valid",
    `  setup:  ${pinned.setup ?? "derived by the planner"}`,
    `  verify: ${pinned.verify ?? "derived by the planner"}`,
]

/**
 * The boundary of `afk config`: one call into the service, and what it came to as lines and an exit
 * code. An invalid afkonfig is `3` like any refusal to start, because it is exactly what a run that
 * plans would refuse over (ADR-0039).
 */
export const createConfig =
    ({ configure, print, printError }: ConfigDeps) =>
    async (action: ConfigureAction): Promise<ExitCode> => {
        const result = await configure(action)
        switch (result.outcome) {
            case "written":
                print(`afk: wrote ${result.path}. Uncomment what you want to pin`)
                return EXIT.complete

            case "absent":
                print("afk: no afkonfig.ts, so the planner derives setup and verify")
                return EXIT.complete

            case "pinned":
                for (const line of pinnedLines(result.pinned)) {
                    print(line)
                }
                return EXIT.complete

            case "invalid":
                for (const line of invalidAfkonfigOutput(result.problems)) {
                    printError(line)
                }
                return EXIT.halted

            case "refused":
                printError(`afk: ${result.reason}`)
                return EXIT.halted
        }
    }
