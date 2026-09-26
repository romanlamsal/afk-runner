import { describe, expect, it } from "vitest"
import { createConfig } from "../../src/cli/config.ts"
import { EXIT } from "../../src/cli/exit-codes.ts"
import type { ConfigureAction, ConfigureResult } from "../../src/service/configure.ts"

const harness = (result: ConfigureResult) => {
    const printed: string[] = []
    const errors: string[] = []
    const asked: ConfigureAction[] = []
    const config = createConfig({
        configure: async action => {
            asked.push(action)
            return result
        },
        print: line => printed.push(line),
        printError: line => errors.push(line),
    })
    return { config, printed, errors, asked }
}

describe("createConfig", () => {
    it("should hand the service the action it was asked for", async () => {
        // given
        const { config, asked } = harness({ outcome: "absent" })

        // when
        await config("check")

        // then
        expect(asked).toEqual(["check"])
    })

    it.each([
        [{ outcome: "written", path: "/repo/afkonfig.mts" }, EXIT.complete],
        [{ outcome: "absent" }, EXIT.complete],
        [{ outcome: "pinned", pinned: { verify: "pnpm check" } }, EXIT.complete],
        [{ outcome: "invalid", problems: ["verify: must not be empty"] }, EXIT.halted],
        [{ outcome: "refused", reason: "this is not a git worktree" }, EXIT.halted],
    ] as const)("should exit %o with %i", async (result, code) => {
        // given
        const { config } = harness(result)

        // when
        const exit = await config("init-or-check")

        // then
        expect(exit).toBe(code)
    })

    it("should name every correction an invalid afkonfig needs", async () => {
        // given
        const { config, errors } = harness({
            outcome: "invalid",
            problems: ["setup: must not be empty", '"install": not a key afk reads'],
        })

        // when
        await config("check")

        // then
        expect(errors).toEqual([
            "afk: afkonfig.mts is invalid. Correct:",
            "  - setup: must not be empty",
            '  - "install": not a key afk reads',
        ])
    })

    it("should say which command is pinned and which the planner derives", async () => {
        // given
        const { config, printed } = harness({ outcome: "pinned", pinned: { verify: "pnpm check" } })

        // when
        await config("check")

        // then
        expect(printed).toEqual([
            "afk: afkonfig.mts is valid",
            "  setup:  derived by the planner",
            "  verify: pnpm check",
        ])
    })

    it.each([
        [{ outcome: "written", path: "/repo/afkonfig.mts" }, "/repo/afkonfig.mts"],
        [{ outcome: "absent" }, "no afkonfig.mts"],
    ] as const)("should say what %o came to", async (result, said) => {
        // given
        const { config, printed } = harness(result)

        // when
        await config("init-or-check")

        // then
        expect(printed).toEqual([expect.stringContaining(said)])
    })
})
