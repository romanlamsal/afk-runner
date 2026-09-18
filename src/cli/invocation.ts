import type { Mode } from "../domain/mode.ts"
import type { ParsedArgs } from "./args.ts"

export type Invocation = {
    spec: number
    mode: Mode
    /** `--resume`: consent to continuing an existing run. It acknowledges, it never dispatches. */
    consented: boolean
    forceFresh: boolean
    /**
     * `--branch`: the branch this spec is based on, where the operator named one that could be a
     * local branch. Undefined where none was passed, and where one was passed to a mode that does
     * not plan — a warning says so rather than a refusal (ADR-0032).
     */
    base: string | undefined
    maxParallel: number
    /** What the invocation was accepted *despite*. Printed before anything runs, and never fatal. */
    warnings: readonly string[]
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
    if (args.boardOnly) {
        return "board-only"
    }
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

    // Looking at a run is not a half of one. The mode flags say what to do to a spec and
    // --board-only says only what to show of it, so a pair of them names two different invocations
    // rather than one (ADR-0030).
    if (args.boardOnly && (args.planOnly || args.implementOnly)) {
        return refuse("--board-only starts nothing, so it cannot be combined with --plan-only or --implement-only")
    }

    // --board-only draws the run directory --force-fresh deletes, so the pair asks to be shown what
    // it just threw away.
    if (args.boardOnly && args.forceFresh) {
        return refuse("--force-fresh deletes the run --board-only draws: pass --board-only on its own to look at it")
    }

    // The manifest lives in the run directory, so starting over takes it with it. The pair asks for
    // a manifest and deletes it in the same breath, and being told that here beats being told it
    // after the branches are gone.
    if (args.forceFresh && args.implementOnly) {
        return refuse(
            "--force-fresh deletes the manifest --implement-only needs: pass --force-fresh on its own to plan afresh",
        )
    }

    // Trimmed once, here, so that every rule below and every reader after them sees the same name:
    // a branch whose surrounding whitespace survived this far would fail `show-ref` as a typo.
    const branch = args.branch?.trim()

    if (branch !== undefined && branch === "") {
        return refuse("--branch needs a branch name")
    }

    // afk cuts from a local commit, so a remote-tracking name is not something it can honour — and
    // fetching one would put a base on screen that the operator never saw (ADR-0018, ADR-0032). The
    // instruction is worth more here than "no such branch" would be downstream.
    if (branch !== undefined && branch.startsWith("origin/")) {
        return refuse(
            `--branch ${branch}: afk cuts from a local branch. ` +
                `Check ${branch} out yourself first, then pass the local name`,
        )
    }

    const asked = mode(args)
    if (!env.interactive && asked === "plan-and-implement") {
        return refuse(
            "no terminal: afk will not run unattended without being told what to do. " +
                "Pass --plan-only or --implement-only",
        )
    }

    // The base is decided when a spec is planned, so a mode that does not plan has nothing to do
    // with the flag. Ignoring it loudly beats refusing an invocation that is otherwise exactly
    // right, and beats silence, which would let an operator believe they had moved the base.
    const plans = asked !== "implement-only" && asked !== "board-only"
    const warnings =
        branch !== undefined && !plans
            ? [`--branch ${branch} is ignored by --${asked}: the base is decided when a spec is planned`]
            : []

    return {
        kind: "invocation",
        invocation: {
            spec,
            mode: asked,
            consented: args.resume,
            forceFresh: args.forceFresh,
            base: plans ? branch : undefined,
            maxParallel,
            warnings,
        },
    }
}
