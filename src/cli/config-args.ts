import { cli } from "cleye"

/** `afk config`'s argument vector as typed, before any rule is applied to it (`resolveConfigInvocation`). */
export type ParsedConfigArgs = {
    init: boolean
    check: boolean
    /** Positional arguments past `config`. It takes none, so anything here is a refusal. */
    extra: readonly string[]
    unknownFlags: readonly string[]
}

export const CONFIG_USAGE = "afk config [--init | --check]"

/** The word that names the command, where a run's spec would otherwise be. A spec is a number. */
export const CONFIG_COMMAND = "config"

/** Parses what follows `config`. Every refusal leaves here as data, as a run's arguments do. */
export const parseConfigArgs = (argv: string[]): ParsedConfigArgs => {
    const parsed = cli(
        {
            name: "afk config",
            parameters: ["[extra...]"],
            flags: {
                init: {
                    type: Boolean,
                    description: "Write a fresh afkonfig.ts at the repository's top level, over any there",
                    default: false,
                },
                check: {
                    type: Boolean,
                    description: "Say whether afkonfig.ts is valid, and what to correct where it is not",
                    default: false,
                },
            },
            help: {
                description:
                    "Pins setup and verify in afkonfig.ts. Bare, it checks an afkonfig that exists and writes one that does not.",
                usage: CONFIG_USAGE,
            },
        },
        undefined,
        [...argv],
    )

    return {
        init: parsed.flags.init,
        check: parsed.flags.check,
        extra: parsed._.extra,
        unknownFlags: Object.keys(parsed.unknownFlags),
    }
}
