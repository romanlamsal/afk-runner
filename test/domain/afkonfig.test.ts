import { describe, expect, it } from "vitest"
import { readAfkonfig } from "../../src/domain/afkonfig.ts"

describe("readAfkonfig", () => {
    it.each([
        [{}, {}],
        [{ setup: "pnpm install" }, { setup: "pnpm install" }],
        [{ verify: "pnpm check" }, { verify: "pnpm check" }],
        [
            { setup: "pnpm install", verify: "pnpm check" },
            { setup: "pnpm install", verify: "pnpm check" },
        ],
    ] as const)("should pin what the default export %j sets", (exported, pinned) => {
        // given
        const exports = { default: exported }

        // when
        const read = readAfkonfig(exports)

        // then
        expect(read).toEqual({ ok: true, pinned })
    })

    it("should pin nothing for a key set to undefined, rather than pin undefined", () => {
        // given
        const exports = { default: { setup: undefined, verify: "pnpm check" } }

        // when
        const read = readAfkonfig(exports)

        // then
        expect(read).toStrictEqual({ ok: true, pinned: { verify: "pnpm check" } })
    })

    it.each([
        ["no default export", {}, "afkonfig.ts has no default export"],
        ["a named export beside the default", { default: {}, setup: "npm ci" }, 'exports "setup"'],
        ["a default export that is not an object", { default: "npm ci" }, "default export"],
        ["an unknown key", { default: { setup: "npm ci", install: "npm i" } }, '"install"'],
        ["a command that is not a string", { default: { setup: 1 } }, "setup"],
        ["an empty command", { default: { verify: "" } }, "verify"],
        ["a whitespace-only command", { default: { verify: "  " } }, "verify"],
    ] as const)("should refuse %s", (_, exports, problem) => {
        // given
        const expected = { ok: false, problems: expect.arrayContaining([expect.stringContaining(problem)]) }

        // when
        const read = readAfkonfig(exports)

        // then
        expect(read).toEqual(expected)
    })

    it("should name every problem at once, so that one check is enough to correct them all", () => {
        // given
        const exports = { default: { setup: "", verify: 7 } }

        // when
        const read = readAfkonfig(exports)

        // then
        expect(read).toEqual({
            ok: false,
            problems: [expect.stringContaining("setup"), expect.stringContaining("verify")],
        })
    })
})
