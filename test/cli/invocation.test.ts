import { describe, expect, it } from "vitest"
import type { ParsedArgs } from "../../src/cli/args.ts"
import { type Mode, resolveInvocation } from "../../src/cli/invocation.ts"

const args = (overrides: Partial<ParsedArgs> = {}): ParsedArgs => ({
    spec: "4",
    extra: [],
    planOnly: false,
    implementOnly: false,
    resume: false,
    forceFresh: false,
    maxParallel: undefined,
    unknownFlags: [],
    ...overrides,
})

describe("resolveInvocation", () => {
    it.each([
        [{}, "plan-and-implement"],
        [{ planOnly: true }, "plan-only"],
        [{ implementOnly: true }, "implement-only"],
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
        const parsed = args({ spec: "42", maxParallel: "5", resume: true, forceFresh: true, implementOnly: true })

        // when
        const resolution = resolveInvocation(parsed, { interactive: true })

        // then
        expect(resolution).toEqual({
            kind: "invocation",
            invocation: { spec: 42, mode: "implement-only", consented: true, forceFresh: true, maxParallel: 5 },
        })
    })

    it.each([
        [{ planOnly: true }, "plan-only"],
        [{ implementOnly: true }, "implement-only"],
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
})
