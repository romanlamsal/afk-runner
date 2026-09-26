import { mkdtemp, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { AFKONFIG_TEMPLATE } from "../../src/domain/afkonfig.ts"
import { createFileAfkonfig } from "../../src/infrastructure/afkonfig.ts"

/**
 * What importing a real file comes to. Run under the test runner's own module loader; how node
 * itself strips the types is exercised through the entry point (`main.integration.test.ts`).
 */
const afkonfig = createFileAfkonfig()

const directory = async (contents?: string): Promise<string> => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "afk-afkonfig-")))
    if (contents !== undefined) {
        await writeFile(join(root, "afkonfig.mts"), contents, "utf8")
    }
    return root
}

describe("createFileAfkonfig", () => {
    it("should find no afkonfig where there is none", async () => {
        // given
        const root = await directory()

        // when
        const loaded = await afkonfig.load(root)

        // then
        expect(loaded).toEqual({ kind: "absent" })
    })

    it("should load what the afkonfig exports", async () => {
        // given
        const root = await directory('export default { verify: "pnpm check" } satisfies { verify?: string }\n')

        // when
        const loaded = await afkonfig.load(root)

        // then
        expect(loaded).toEqual({ kind: "loaded", exports: { default: { verify: "pnpm check" } } })
    })

    it("should report an afkonfig that throws as one that failed", async () => {
        // given
        const root = await directory('throw new Error("no afkonfig for you")\n')

        // when
        const loaded = await afkonfig.load(root)

        // then
        expect(loaded).toEqual({ kind: "failed", reason: expect.stringContaining("no afkonfig for you") })
    })

    it("should write a template that loads as an afkonfig pinning nothing", async () => {
        // given
        const root = await directory()
        await afkonfig.write(root, AFKONFIG_TEMPLATE)

        // when
        const loaded = await afkonfig.load(root)

        // then
        expect(loaded).toEqual({ kind: "loaded", exports: { default: {} } })
    })
})
