import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The entry point, run the way an operator runs it: TypeScript handed straight to node, with no
 * build step in between. A spawned process has no terminal, so a bare invocation is refused here.
 */
const entryPoint = fileURLToPath(new URL("../src/main.ts", import.meta.url))

const afk = (argv: readonly string[]) => spawnSync(process.execPath, [entryPoint, ...argv], { encoding: "utf8" })

const refusals = [
    { argv: ["4", "--plan-only", "--implement-only"], names: "--plan-only and --implement-only cannot be combined" },
    { argv: ["4"], names: "Pass --plan-only or --implement-only" },
    { argv: ["--plan-only"], names: "a spec issue number is required" },
    { argv: ["4", "--dry-run"], names: 'unknown flag "--dry-run"' },
    { argv: ["4", "9", "--plan-only"], names: 'unexpected argument "9"' },
] as const

describe("afk", () => {
    it("should run as TypeScript under node with no build step", () => {
        // given
        const askingForHelp = ["--help"]

        // when
        const result = afk(askingForHelp)

        // then
        expect(result.stdout).toContain("afk <spec>")
    })

    it.each(refusals)("should exit 2 for $argv", ({ argv }) => {
        // given — a refused invocation, from the table above

        // when
        const result = afk(argv)

        // then
        expect(result.status).toBe(2)
    })

    it.each(refusals)("should name what is wrong for $argv", ({ argv, names }) => {
        // given — a refused invocation, from the table above

        // when
        const result = afk(argv)

        // then
        expect(result.stderr).toContain(names)
    })
})
