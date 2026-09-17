import { cli } from "cleye"

/**
 * The argument vector as typed, before any rule is applied to it. Values stay strings: cleye
 * exits the process on a value it cannot coerce, and a refusal is this repository's own message
 * and its own exit code (`resolveInvocation`).
 */
export type ParsedArgs = {
    spec: string | undefined
    /** Positional arguments past the spec. afk takes one, so anything here is a refusal. */
    extra: string[]
    planOnly: boolean
    implementOnly: boolean
    boardOnly: boolean
    resume: boolean
    forceFresh: boolean
    maxParallel: string | undefined
    unknownFlags: string[]
}

export const USAGE =
    "afk <spec> [--plan-only | --implement-only | --board-only] [--resume] [--force-fresh] [--max-parallel <n>]"

/**
 * The spec and the surplus positionals are both declared optional so that cleye never exits on
 * them: every refusal leaves here as data and exits `2` from one place.
 */
export const parseArgs = (argv: string[]): ParsedArgs => {
    const parsed = cli(
        {
            name: "afk",
            parameters: ["[spec]", "[extra...]"],
            flags: {
                planOnly: {
                    type: Boolean,
                    description: "Plan the spec, write the manifest, print the execution order, exit",
                    default: false,
                },
                implementOnly: {
                    type: Boolean,
                    description: "Implement an existing manifest without planning again",
                    default: false,
                },
                boardOnly: {
                    type: Boolean,
                    description: "Draw this spec's board from its run directory and exit. Reads, never writes",
                    default: false,
                },
                resume: {
                    type: Boolean,
                    description: "Consent to continuing an existing run. Changes no behaviour",
                    default: false,
                },
                forceFresh: {
                    type: Boolean,
                    description: "Delete this spec's branches, run directory and pull request, then start over",
                    default: false,
                },
                maxParallel: {
                    type: String,
                    description: "Implementer slots (default 3)",
                    placeholder: "<n>",
                },
            },
            help: { description: "Runs a whole spec's tickets unattended.", usage: USAGE },
        },
        undefined,
        // cleye takes the flags it recognises out of the array it is handed. It gets a copy, so
        // that parsing an argument vector never changes it.
        [...argv],
    )

    return {
        spec: parsed._.spec,
        extra: parsed._.extra,
        planOnly: parsed.flags.planOnly,
        implementOnly: parsed.flags.implementOnly,
        boardOnly: parsed.flags.boardOnly,
        resume: parsed.flags.resume,
        forceFresh: parsed.flags.forceFresh,
        maxParallel: parsed.flags.maxParallel,
        unknownFlags: Object.keys(parsed.unknownFlags),
    }
}
