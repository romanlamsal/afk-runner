import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Manifest } from "../../src/domain/manifest.ts"
import { createFileManifestStore } from "../../src/repository/manifest-store.ts"

/**
 * The real half of the manifest store, against a real directory. The port has one method today, so
 * there is nothing a two-run contract suite would assert that reading the file back does not: the
 * suite arrives with the read side, when something needs one.
 */
const MANIFEST: Manifest = {
    spec: 4,
    setup: "npm ci",
    verify: "npm run check",
    tickets: [{ number: 5, title: "Plan a spec", blockedBy: [] }],
}

const written = async (): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), "afk-manifest-"))
    await createFileManifestStore({ root }).write(4, MANIFEST)
    return readFile(join(root, ".afk/4/manifest.json"), "utf8")
}

describe("createFileManifestStore", () => {
    it("should write the manifest into the spec's run directory, creating it", async () => {
        // given — a repository with no run directory

        // when
        const contents = await written()

        // then
        expect(JSON.parse(contents)).toEqual(MANIFEST)
    })

    it("should end the file with a newline, so a line-based tool sees its last line", async () => {
        // given — a repository with no run directory

        // when
        const contents = await written()

        // then
        expect(contents.endsWith("}\n")).toBe(true)
    })
})
