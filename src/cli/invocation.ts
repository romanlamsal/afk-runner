import type { ParsedArgs } from "./args.ts"

/**
 * What the invocation asked for. `plan-and-implement` is the bare invocation: plan, confirm,
 * implement.
 */
export type Mode = "plan-and-implement" | "plan-only" | "implement-only"

export type Invocation = {
    spec: number
    mode: Mode
    /** `--resume`: consent to continuing an existing run. It acknowledges, it never dispatches. */
    consented: boolean
    forceFresh: boolean
    maxParallel: number
}

export type Resolution = { kind: "invocation"; invocation: Invocation } | { kind: "refusal"; message: string }

export const DEFAULT_MAX_PARALLEL = 3

const refuse = (message: string): Resolution => ({ kind: "refusal", message })

/** Digits only: `0x10` and `1e3` are typing accidents, not issue numbers or slot counts. */
const positiveInteger = (value: string): number | undefined => {
    if (!/^\d+$/.test(value)) {
        return undefined
    }
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

const mode = (args: ParsedArgs): Mode => {
    if (args.planOnly) {
        return "plan-only"
    }
    if (args.implementOnly) {
        return "implement-only"
    }
    return "plan-and-implement"
}

/**
 * Every flag rule afk has, in one pure pass: what the arguments mean, or what is wrong with them.
 *
 * The terminal is a rule and not a warning. The mode that skips the `setup` and `verify`
 * confirmation must never be the mode that runs unsupervised, so a bare invocation with nobody at
 * the terminal is refused rather than continued (ADR-0014).
 */
export const resolveInvocation = (args: ParsedArgs, env: { interactive: boolean }): Resolution => {
    const [unknownFlag] = args.unknownFlags
    if (unknownFlag !== undefined) {
        return refuse(`unknown flag "--${unknownFlag}". Run afk --help for the flags afk accepts`)
    }

    const [extra] = args.extra
    if (extra !== undefined) {
        return refuse(`unexpected argument "${extra}". afk runs one spec at a time`)
    }

    if (args.spec === undefined) {
        return refuse("a spec issue number is required")
    }

    const spec = positiveInteger(args.spec)
    if (spec === undefined) {
        return refuse(`the spec must be a positive issue number, got "${args.spec}"`)
    }

    const maxParallel = args.maxParallel === undefined ? DEFAULT_MAX_PARALLEL : positiveInteger(args.maxParallel)
    if (maxParallel === undefined) {
        return refuse(`--max-parallel must be a positive integer, got "${args.maxParallel}"`)
    }

    if (args.planOnly && args.implementOnly) {
        return refuse("--plan-only and --implement-only cannot be combined: each names a different half of a run")
    }

    const asked = mode(args)
    if (!env.interactive && asked === "plan-and-implement") {
        return refuse(
            "no terminal: afk will not run unattended without being told what to do. " +
                "Pass --plan-only or --implement-only",
        )
    }

    return {
        kind: "invocation",
        invocation: { spec, mode: asked, consented: args.resume, forceFresh: args.forceFresh, maxParallel },
    }
}
