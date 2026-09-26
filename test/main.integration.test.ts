import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The entry point, run the way an operator runs it: TypeScript handed straight to node, with no
 * build step in between. A spawned process has no terminal, so a bare invocation is refused here.
 */
const entryPoint = fileURLToPath(new URL("../src/main.ts", import.meta.url))

const afk = (argv: readonly string[], cwd?: string) =>
    spawnSync(process.execPath, [entryPoint, ...argv], { encoding: "utf8", cwd })

/** A git repository with no package manifest, holding the afkonfig given, if any. */
const repository = (afkonfig?: string): string => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "afk-config-")))
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root })
    if (afkonfig !== undefined) {
        writeFileSync(join(root, "afkonfig.ts"), afkonfig, "utf8")
    }
    return root
}

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

    describe("config", () => {
        const INVALID_AFKONFIGS = [
            ["an unknown key", 'export default { setup: "npm ci", install: "npm i" }\n', '"install"'],
            ["syntax types cannot be stripped from", "enum Command { Setup }\nexport default {}\n", "imported"],
        ] as const

        it("should write an afkonfig where there is none", () => {
            // given
            const root = repository()

            // when
            afk(["config"], root)

            // then
            expect(readFileSync(join(root, "afkonfig.ts"), "utf8")).toContain("export default")
        })

        it("should find the afkonfig it wrote valid, under node's own type stripping", () => {
            // given
            const root = repository()
            afk(["config", "--init"], root)

            // when
            const result = afk(["config", "--check"], root)

            // then
            expect(result.stdout).toContain("afkonfig.ts is valid")
        })

        it.each(INVALID_AFKONFIGS)("should exit 3 for an afkonfig with %s", (_, afkonfig) => {
            // given
            const root = repository(afkonfig)

            // when
            const result = afk(["config", "--check"], root)

            // then
            expect(result.status).toBe(3)
        })

        it.each(INVALID_AFKONFIGS)("should name what to correct in an afkonfig with %s", (_, afkonfig, names) => {
            // given
            const root = repository(afkonfig)

            // when
            const result = afk(["config", "--check"], root)

            // then
            expect(result.stderr).toContain(names)
        })

        it("should refuse a run that plans over an invalid afkonfig", () => {
            // given
            const root = repository('export default { verify: "" }\n')

            // when
            const result = afk(["4", "--plan-only"], root)

            // then
            expect(result.stderr).toContain("afkonfig.ts is invalid")
        })
    })
})
