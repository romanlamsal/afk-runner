import { describe, expect, it } from "vitest"
import type { ParsedArgs } from "../../src/cli/args.ts"
import { resolveInvocation } from "../../src/cli/invocation.ts"
import type { Mode } from "../../src/domain/mode.ts"

const args = (overrides: Partial<ParsedArgs> = {}): ParsedArgs => ({
    spec: "4",
    extra: [],
    planOnly: false,
    implementOnly: false,
    boardOnly: false,
    resume: false,
    forceFresh: false,
    branch: undefined,
    maxParallel: undefined,
    unknownFlags: [],
    ...overrides,
})

describe("resolveInvocation", () => {
    it.each([
        [{}, "plan-and-implement"],
        [{ planOnly: true }, "plan-only"],
        [{ implementOnly: true }, "implement-only"],
        [{ boardOnly: true }, "board-only"],
    ] as const satisfies readonly (readonly [Partial<ParsedArgs>, Mode])[])(
        "should resolve %o to the %s mode",
        (overrides, mode) => {
            // given
            const parsed = args(overrides)

            // when
            const resolution = resolveInvocation(parsed, { interactive: true })

            // then
            expect(resolution).toEqual({ kind: "invocation", invocation: expect.objectContaining({ mode }) })
        },
    )

    it("should default max-parallel to three slots", () => {
        // given
        const parsed = args()

        // when
        const resolution = resolveInvocation(parsed, { interactive: true })

        // then
        expect(resolution).toEqual({ kind: "invocation", invocation: expect.objectContaining({ maxParallel: 3 }) })
    })

    it("should take the spec number and the modifier flags from the arguments", () => {
        // given
        const parsed = args({ spec: "42", maxParallel: "5", resume: true, forceFresh: true, planOnly: true })

        // when
        const resolution = resolveInvocation(parsed, { interactive: true })

        // then
        expect(resolution).toEqual({
            kind: "invocation",
            invocation: {
                spec: 42,
                mode: "plan-only",
                consented: true,
                forceFresh: true,
                base: undefined,
                maxParallel: 5,
                warnings: [],
            },
        })
    })

    it.each([
        [{ planOnly: true }, "plan-only"],
        [{ implementOnly: true }, "implement-only"],
        [{ boardOnly: true }, "board-only"],
    ] as const satisfies readonly (readonly [Partial<ParsedArgs>, Mode])[])(
        "should accept %o without a terminal",
        (overrides, mode) => {
            // given
            const parsed = args(overrides)

            // when
            const resolution = resolveInvocation(parsed, { interactive: false })

            // then
            expect(resolution).toEqual({ kind: "invocation", invocation: expect.objectContaining({ mode }) })
        },
    )

    it.each([
        [{ unknownFlags: ["dry-run"] }, true, 'unknown flag "--dry-run". Run afk --help for the flags afk accepts'],
        [{ extra: ["9"] }, true, 'unexpected argument "9". afk runs one spec at a time'],
        [{ spec: undefined }, true, "a spec issue number is required"],
        [{ spec: "not-a-number" }, true, 'the spec must be a positive issue number, got "not-a-number"'],
        [{ spec: "0" }, true, 'the spec must be a positive issue number, got "0"'],
        [{ spec: "4.5" }, true, 'the spec must be a positive issue number, got "4.5"'],
        [{ spec: "0x10" }, true, 'the spec must be a positive issue number, got "0x10"'],
        [{ maxParallel: "0" }, true, '--max-parallel must be a positive integer, got "0"'],
        [{ maxParallel: "many" }, true, '--max-parallel must be a positive integer, got "many"'],
        [{ maxParallel: "1e3" }, true, '--max-parallel must be a positive integer, got "1e3"'],
        [
            { planOnly: true, implementOnly: true },
            true,
            "--plan-only and --implement-only cannot be combined: each names a different half of a run",
        ],
        [
            { boardOnly: true, planOnly: true },
            true,
            "--board-only starts nothing, so it cannot be combined with --plan-only or --implement-only",
        ],
        [
            { boardOnly: true, implementOnly: true },
            true,
            "--board-only starts nothing, so it cannot be combined with --plan-only or --implement-only",
        ],
        [
            { boardOnly: true, forceFresh: true },
            true,
            "--force-fresh deletes the run --board-only draws: pass --board-only on its own to look at it",
        ],
        [
            { forceFresh: true, implementOnly: true },
            true,
            "--force-fresh deletes the manifest --implement-only needs: pass --force-fresh on its own to plan afresh",
        ],
        [
            {},
            false,
            "no terminal: afk will not run unattended without being told what to do. Pass --plan-only or --implement-only",
        ],
        [
            { forceFresh: true },
            false,
            "no terminal: afk will not run unattended without being told what to do. Pass --plan-only or --implement-only",
        ],
    ] as const satisfies readonly (readonly [Partial<ParsedArgs>, boolean, string])[])(
        "should refuse %o naming what is wrong",
        (overrides, interactive, message) => {
            // given
            const parsed = args(overrides)

            // when
            const resolution = resolveInvocation(parsed, { interactive })

            // then
            expect(resolution).toEqual({ kind: "refusal", message })
        },
    )

    it.each([
        [
            "origin/main",
            "--branch origin/main: afk cuts from a local branch. Check origin/main out yourself first, then pass the local name",
        ],
        [
            "origin/release",
            "--branch origin/release: afk cuts from a local branch. Check origin/release out yourself first, then pass the local name",
        ],
        ["", "--branch needs a branch name"],
        ["   ", "--branch needs a branch name"],
    ] as const)("should refuse --branch %s", (branch, message) => {
        // given
        const parsed = args({ branch })

        // when
        const resolution = resolveInvocation(parsed, { interactive: true })

        // then
        expect(resolution).toEqual({ kind: "refusal", message })
    })

    it("should carry --branch into an invocation that plans", () => {
        // given
        const parsed = args({ branch: "release", planOnly: true })

        // when
        const resolution = resolveInvocation(parsed, { interactive: true })

        // then
        expect(resolution).toEqual({
            kind: "invocation",
            invocation: expect.objectContaining({ base: "release", warnings: [] }),
        })
    })

    it.each([
        [{ implementOnly: true }, "implement-only"],
        [{ boardOnly: true }, "board-only"],
    ] as const satisfies readonly (readonly [Partial<ParsedArgs>, Mode])[])(
        "should drop --branch from %o, which does not plan",
        (overrides, mode) => {
            // given
            const parsed = args({ ...overrides, branch: "release" })

            // when
            const resolution = resolveInvocation(parsed, { interactive: true })

            // then
            expect(resolution).toEqual({
                kind: "invocation",
                invocation: expect.objectContaining({
                    base: undefined,
                    warnings: [`--branch release is ignored by --${mode}: the base is decided when a spec is planned`],
                }),
            })
        },
    )
})
