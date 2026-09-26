import { describe, expect, it } from "vitest"
import { AFKONFIG_TEMPLATE, type AfkonfigLoad } from "../../src/domain/afkonfig.ts"
import { createReadAfkonfigService } from "../../src/service/afkonfig.ts"
import { createConfigureService } from "../../src/service/configure.ts"
import { createFakeAfkonfigFile } from "../fakes/afkonfig.ts"
import { createFakeGit } from "../fakes/git.ts"

const VALID: AfkonfigLoad = { kind: "loaded", exports: { default: { verify: "pnpm check" } } }

const INVALID: AfkonfigLoad = { kind: "loaded", exports: { default: { verify: "" } } }

const harness = (load: AfkonfigLoad, repository: Parameters<typeof createFakeGit>[0] = {}) => {
    const afkonfig = createFakeAfkonfigFile(load)
    const git = createFakeGit(repository).git
    const cwd = "/repo/packages/thing"
    const configure = createConfigureService({
        cwd,
        git,
        afkonfig: afkonfig.file,
        read: createReadAfkonfigService({ cwd, git, afkonfig: afkonfig.file }),
    })
    return { configure, afkonfig }
}

describe("createConfigureService", () => {
    it.each([
        ["no afkonfig", { kind: "absent" }],
        ["a valid one", VALID],
        ["an invalid one", INVALID],
    ] as const)("should write the template at the top level over %s under init", async (_, load) => {
        // given
        const { configure, afkonfig } = harness(load)

        // when
        await configure("init")

        // then
        expect(afkonfig.written).toEqual([{ root: "/repo", contents: AFKONFIG_TEMPLATE }])
    })

    it("should say where it wrote the afkonfig", async () => {
        // given
        const { configure } = harness(VALID)

        // when
        const result = await configure("init")

        // then
        expect(result).toEqual({ outcome: "written", path: "/repo/afkonfig.mts" })
    })

    it.each([
        ["check", { kind: "absent" }, { outcome: "absent" }],
        ["check", VALID, { outcome: "pinned", pinned: { verify: "pnpm check" } }],
        ["check", INVALID, { outcome: "invalid", problems: [expect.stringContaining("verify")] }],
        ["init-or-check", VALID, { outcome: "pinned", pinned: { verify: "pnpm check" } }],
        ["init-or-check", INVALID, { outcome: "invalid", problems: [expect.stringContaining("verify")] }],
        ["init-or-check", { kind: "absent" }, { outcome: "written", path: "/repo/afkonfig.mts" }],
    ] as const)("should answer %s over %o with %o", async (action, load, expected) => {
        // given
        const { configure } = harness(load)

        // when
        const result = await configure(action)

        // then
        expect(result).toEqual(expected)
    })

    it.each([
        ["check", { kind: "absent" }],
        ["init-or-check", INVALID],
    ] as const)("should write nothing under %s over %o", async (action, load) => {
        // given
        const { configure, afkonfig } = harness(load)

        // when
        await configure(action)

        // then
        expect(afkonfig.written).toEqual([])
    })

    it.each(["init", "check", "init-or-check"] as const)("should refuse %s outside a git worktree", async action => {
        // given
        const { configure } = harness({ kind: "absent" }, { root: undefined })

        // when
        const result = await configure(action)

        // then
        expect(result).toEqual({ outcome: "refused", reason: expect.stringContaining("not a git worktree") })
    })
})
