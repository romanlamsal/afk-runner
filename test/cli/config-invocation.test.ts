import { describe, expect, it } from "vitest"
import type { ParsedConfigArgs } from "../../src/cli/config-args.ts"
import { resolveConfigInvocation } from "../../src/cli/config-invocation.ts"

const args = (overrides: Partial<ParsedConfigArgs> = {}): ParsedConfigArgs => ({
    init: false,
    check: false,
    extra: [],
    unknownFlags: [],
    ...overrides,
})

describe("resolveConfigInvocation", () => {
    it.each([
        [{ init: true }, "init"],
        [{ check: true }, "check"],
        [{}, "init-or-check"],
    ] as const)("should resolve %o to %s", (overrides, action) => {
        // given
        const parsed = args(overrides)

        // when
        const resolution = resolveConfigInvocation(parsed)

        // then
        expect(resolution).toEqual({ kind: "config", action })
    })

    it.each([
        [{ init: true, check: true }, "--init and --check cannot be combined"],
        [{ extra: ["4"] }, 'unexpected argument "4"'],
        [{ unknownFlags: ["plan-only"] }, 'unknown flag "--plan-only"'],
    ] as const)("should refuse %o", (overrides, message) => {
        // given
        const parsed = args(overrides)

        // when
        const resolution = resolveConfigInvocation(parsed)

        // then
        expect(resolution).toEqual({ kind: "refusal", message: expect.stringContaining(message) })
    })
})
