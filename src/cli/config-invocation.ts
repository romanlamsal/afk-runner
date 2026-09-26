import type { ConfigureAction } from "../service/configure.ts"
import type { ParsedConfigArgs } from "./config-args.ts"

export type ConfigResolution = { kind: "config"; action: ConfigureAction } | { kind: "refusal"; message: string }

const refuse = (message: string): ConfigResolution => ({ kind: "refusal", message })

/** Every rule `afk config`'s flags have, in one pure pass, as `resolveInvocation` is for a run's. */
export const resolveConfigInvocation = (args: ParsedConfigArgs): ConfigResolution => {
    const [unknownFlag] = args.unknownFlags
    if (unknownFlag !== undefined) {
        return refuse(`unknown flag "--${unknownFlag}". Run afk config --help for the flags it accepts`)
    }

    const [extra] = args.extra
    if (extra !== undefined) {
        return refuse(`unexpected argument "${extra}". afk config takes flags only`)
    }

    if (args.init && args.check) {
        return refuse("--init and --check cannot be combined: pass neither to check an afkonfig or write a missing one")
    }

    return { kind: "config", action: args.init ? "init" : args.check ? "check" : "init-or-check" }
}
