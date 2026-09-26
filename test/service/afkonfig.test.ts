import { describe, expect, it } from "vitest"
import type { AfkonfigLoad } from "../../src/domain/afkonfig.ts"
import { createReadAfkonfigService } from "../../src/service/afkonfig.ts"
import { createFakeAfkonfigFile } from "../fakes/afkonfig.ts"
import { createFakeGit } from "../fakes/git.ts"

const harness = (load: AfkonfigLoad, repository: Parameters<typeof createFakeGit>[0] = {}) => {
    const afkonfig = createFakeAfkonfigFile(load)
    const read = createReadAfkonfigService({
        cwd: "/repo/packages/thing",
        git: createFakeGit(repository).git,
        afkonfig: afkonfig.file,
    })
    return { read, afkonfig }
}

describe("createReadAfkonfigService", () => {
    it.each([
        [{ kind: "absent" }, { outcome: "absent" }],
        [
            { kind: "loaded", exports: { default: { verify: "pnpm check" } } },
            { outcome: "pinned", pinned: { verify: "pnpm check" } },
        ],
        [
            { kind: "loaded", exports: { default: { verify: "" } } },
            { outcome: "invalid", problems: [expect.stringContaining("verify")] },
        ],
        [
            { kind: "failed", reason: "SyntaxError: Unexpected token" },
            { outcome: "invalid", problems: [expect.stringContaining("SyntaxError: Unexpected token")] },
        ],
    ] as const)("should read %o as %o", async (load, expected) => {
        // given
        const { read } = harness(load)

        // when
        const result = await read()

        // then
        expect(result).toEqual(expected)
    })

    it("should load the afkonfig at the repository's top level rather than where afk was invoked", async () => {
        // given
        const { read, afkonfig } = harness({ kind: "absent" })

        // when
        await read()

        // then
        expect(afkonfig.loadedFrom).toEqual(["/repo"])
    })

    it("should refuse outside a git worktree, where there is no top level to look in", async () => {
        // given
        const { read } = harness({ kind: "absent" }, { root: undefined })

        // when
        const result = await read()

        // then
        expect(result).toEqual({ outcome: "refused", reason: expect.stringContaining("not a git worktree") })
    })
})
