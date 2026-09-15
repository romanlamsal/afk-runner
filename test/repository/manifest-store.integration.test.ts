import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Manifest } from "../../src/domain/manifest.ts"
import { createFileManifestStore } from "../../src/repository/manifest-store.ts"

/** The real half of the manifest store, against a real directory. */
const MANIFEST: Manifest = {
    spec: 4,
    setup: "npm ci",
    verify: "npm run check",
    tickets: [{ number: 5, title: "Plan a spec", blockedBy: [] }],
}

const store = createFileManifestStore()

const repository = (): Promise<string> => mkdtemp(join(tmpdir(), "afk-manifest-"))

const written = async (): Promise<string> => {
    const root = await repository()
    await store.write(root, 4, MANIFEST)
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

    it("should read back the manifest it wrote", async () => {
        // given
        const root = await repository()
        await store.write(root, 4, MANIFEST)

        // when
        const read = await store.read(root, 4)

        // then
        expect(read).toEqual({ ok: true, manifest: MANIFEST })
    })

    it("should read nothing for a spec that has no manifest", async () => {
        // given
        const root = await repository()

        // when
        const read = await store.read(root, 4)

        // then
        expect(read).toBeUndefined()
    })

    it("should refuse a manifest that names another spec than the directory it sits in", async () => {
        // given
        const root = await repository()
        await store.write(root, 9, MANIFEST)

        // when
        const read = await store.read(root, 9)

        // then
        expect(read).toEqual({ ok: false, reason: expect.stringContaining("is for spec #4, not #9") })
    })
})
