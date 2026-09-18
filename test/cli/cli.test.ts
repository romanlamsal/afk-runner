import { describe, expect, it } from "vitest"
import { type Cli, createCli } from "../../src/cli/cli.ts"
import { EXIT, type ExitCode } from "../../src/cli/exit-codes.ts"
import type { Invocation } from "../../src/cli/invocation.ts"

type Harness = { cli: Cli; started: Invocation[]; errors: string[] }

const harness = ({
    interactive = true,
    exitCode = EXIT.complete,
}: {
    interactive?: boolean
    exitCode?: ExitCode
} = {}): Harness => {
    const started: Invocation[] = []
    const errors: string[] = []
    const cli = createCli({
        isInteractive: () => interactive,
        printError: line => errors.push(line),
        run: async invocation => {
            started.push(invocation)
            return exitCode
        },
    })
    return { cli, started, errors }
}

/** Two modes at once: the refusal every test below that needs one reaches for. */
const BOTH_MODES = ["4", "--plan-only", "--implement-only"]

describe("createCli", () => {
    it("should hand the run the invocation it parsed", async () => {
        // given
        const { cli, started } = harness()

        // when
        await cli(["4", "--implement-only", "--resume", "--max-parallel", "5"])

        // then
        expect(started).toEqual([
            {
                spec: 4,
                mode: "implement-only",
                consented: true,
                forceFresh: false,
                base: undefined,
                maxParallel: 5,
                warnings: [],
            },
        ])
    })

    it("should leave the argument vector it was handed unchanged", async () => {
        // given
        const { cli } = harness()
        const argv = ["4", "--plan-only", "--max-parallel", "5"]

        // when
        await cli(argv)

        // then
        expect(argv).toEqual(["4", "--plan-only", "--max-parallel", "5"])
    })

    it("should exit with the code the run returned", async () => {
        // given
        const { cli } = harness({ exitCode: EXIT.partial })

        // when
        const code = await cli(["4", "--plan-only"])

        // then
        expect(code).toBe(EXIT.partial)
    })

    it("should exit 2 for a refused invocation", async () => {
        // given
        const { cli } = harness()

        // when
        const code = await cli(BOTH_MODES)

        // then
        expect(code).toBe(EXIT.misuse)
    })

    it("should name what is wrong on stderr", async () => {
        // given
        const { cli, errors } = harness()

        // when
        await cli(BOTH_MODES)

        // then
        expect(errors).toContain(
            "afk: --plan-only and --implement-only cannot be combined: each names a different half of a run",
        )
    })

    it("should print the usage line with a refusal", async () => {
        // given
        const { cli, errors } = harness()

        // when
        await cli([])

        // then
        expect(errors.join("\n")).toContain("usage: afk <spec>")
    })

    it("should not start a run it refused", async () => {
        // given
        const { cli, started } = harness()

        // when
        await cli(BOTH_MODES)

        // then
        expect(started).toEqual([])
    })

    it("should refuse a bare invocation with no terminal", async () => {
        // given
        const { cli, errors } = harness({ interactive: false })

        // when
        await cli(["4"])

        // then
        expect(errors.join("\n")).toContain("Pass --plan-only or --implement-only")
    })
})
