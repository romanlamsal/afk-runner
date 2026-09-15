import { describe, expect, it } from "vitest"
import { isEnvironmentFile } from "../../src/domain/environment.ts"

/**
 * Which ignored files are the operator's environment. Every ignored file is the wrong answer —
 * `setup` is what puts dependencies and build output in a worktree.
 */
describe("isEnvironmentFile", () => {
    it.each([
        [".env", true],
        [".env.local", true],
        [".env.test", true],
        [".envrc", true],
        [".env.test.local", true],
        ["packages/api/.env", true],
        ["packages/api/.env.test", true],
        [".environment", false],
        ["env.ts", false],
        ["src/env.ts", false],
        ["node_modules/@types/node/.env.d.ts", false],
        ["packages/api/node_modules/pkg/.env", false],
        ["build/bundle.js", false],
        ["README.md", false],
    ] as const)("should say %s is an environment file or not", (path, expected) => {
        // given — the path from the table

        // when
        const carried = isEnvironmentFile(path)

        // then
        expect(carried).toBe(expected)
    })
})
